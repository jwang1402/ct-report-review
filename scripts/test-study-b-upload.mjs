// Optional browser regression. Run with Playwright available or set PLAYWRIGHT_MODULE
// to its ESM entry point and CHROME_PATH to a Chromium executable.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {zipSync,strToU8} from 'fflate';
import {createServer} from 'vite';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const images={}, cases=[];
for(let i=1;i<=10;i++){
  const id='B'+String(i).padStart(2,'0'), scan=gzipSync('Synthetic scan '+id);
  images['images/'+id+'.nii.gz']=[scan,{level:0}];
  cases.push({case_id:id,draft:'Synthetic report '+id,size:scan.length,sha256:createHash('sha256').update(scan).digest('hex')});
}
const bundle=Buffer.from(zipSync({...images,'Study_B_admin_import.json':strToU8(JSON.stringify({cases}))}));
// Exercise the real editor, archive parser, uploader UI and persistence path, and
// replace the external Drive boundary. No browser request may leave localhost.
const mocks={
  driveUpload:`export const driveUploadConfigured=true;
    export const loadGoogle=async()=>{},authorizeDrive=async()=>{},disconnectDrive=()=>{};
    export const selectDriveFolder=async()=>({id:'test-folder',name:'Synthetic folder'});
    export const readDriveMetadata=()=>{},uploadDriveBlob=()=>{},verifyFolder=()=>{},shareUploadedFile=()=>{};`,
  privateDriveFolder:`export async function uploadPrivateFolder(packets){
    window.batchUploads++;
    return Object.fromEntries(packets.cases.map(c=>[c.case_id,'https://drive.google.com/file/d/test_img_'+c.case_id+'/view']));
  }`,
  publicDriveMedia:`export async function verifyPublicDriveCase(link,c){
    if(!link.endsWith('_'+c.case_id+'/view'))throw new Error('Wrong case');
    window.verifiedCases.push(c.case_id);
  }
  export const downloadPublicDriveCase=()=>{};`,
};
const server=await createServer({
  server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',
  define:{'import.meta.env.VITE_REVIEW_API_URL':JSON.stringify('/mock')},
  plugins:[{name:'synthetic-drive',enforce:'pre',transform(_code,id){
    const file=id.split('?')[0].split('/').pop().replace(/\.ts$/,'');
    if(id.includes('/src/services/')&&Object.hasOwn(mocks,file))return mocks[file];
  }}],
});
let browser;
try{
  await server.listen();
  const base='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
  for(const failFirst of [false,true]){
    const context=await browser.newContext(),page=await context.newPage();
    const writes=[],errors=[];
    let saved=[],version=0;
    page.setDefaultTimeout(12000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      sessionStorage.setItem('ct-review-session','test');
      window.batchUploads=0;window.verifiedCases=[];
    });
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==base)return route.abort();
      if(!url.pathname.startsWith('/mock/'))return route.continue();
      const path=url.pathname.slice(5);
      if(path==='/session')return route.fulfill({json:{username:'example',role:'admin'}});
      if(path==='/admin/study-b'){
        if(request.method()==='GET')return route.fulfill({json:{cases:saved,status:'draft',version}});
        const payload=request.postDataJSON();
        writes.push(payload);
        if(failFirst&&writes.length===1)return route.fulfill({status:503,json:{error:'Temporary synthetic error'}});
        assert.equal(payload.version,version);
        saved=payload.cases;
        return route.fulfill({json:{version:++version,status:'draft',cases:saved}});
      }
      if(path==='/blind/cases')return route.fulfill({json:{cases:[]}});
      return route.fulfill({json:{doctors:[],studies:[],ready:false}});
    });
    await page.goto(base+'/#/admin/upload?study=B');
    await page.getByLabel('Select Study B files').setInputFiles({name:'Study_B_Upload.zip',mimeType:'application/zip',buffer:bundle});
    const approved=page.getByRole('checkbox',{name:/approved for public sharing/i});
    await approved.check();
    assert.equal(writes.length,0);
    const advanced=page.locator('details').filter({has:page.getByText('Advanced import and CT links',{exact:true})});
    assert.equal(await advanced.count(),1);
    assert.equal(await advanced.getAttribute('open'),null);
    assert.equal(await page.getByLabel('CT file link').isVisible(),false);
    await page.getByText('0/10 cases uploaded · Not open to readers',{exact:true}).waitFor();
    const button=name=>page.getByRole('button',{name,exact:true});
    await button('Connect Google Drive').click();await button('Choose folder').click();
    await button('Upload Study B').click();
    if(failFirst){
      await button('Retry save').waitFor();
      assert.equal(saved.length,0);
      assert.equal(await page.getByText('Upload complete',{exact:true}).isVisible(),false);
      await button('Retry save').click();
    }
    await page.getByText('Upload complete',{exact:true}).first().waitFor();
    assert.equal(writes.length,failFirst?2:1);assert(writes.every(w=>w.freeze===false));
    if(failFirst)assert.deepEqual(writes[0],writes[1]);
    assert.equal(await page.evaluate(()=>window.batchUploads),1);
    assert.deepEqual(await page.evaluate(()=>window.verifiedCases),cases.map(c=>c.case_id));
    assert.deepEqual(saved.map(c=>[c.case_id,c.draft,c.drive_url]),cases.map(c=>[c.case_id,c.draft,'https://drive.google.com/file/d/test_img_'+c.case_id+'/view']));
    await page.reload();await page.getByText('Upload complete',{exact:true}).first().waitFor();
    await page.getByText('10/10 cases uploaded · Not open to readers',{exact:true}).waitFor();
    await page.getByRole('link',{name:'View cases'}).click();
    const inventory=page.getByRole('region',{name:'Study B case inventory'});
    await inventory.getByText('10 / 10 cases uploaded',{exact:true}).waitFor();
    await inventory.getByText('View saved cases (10)',{exact:true}).click();
    await inventory.getByRole('link',{name:/B05.*Uploaded/}).click();
    await page.waitForURL('**/#/admin/upload?study=B&case=B05');
    assert.equal(await page.getByRole('combobox',{name:/Examination/}).inputValue(),'B05');
    assert.equal(await page.getByRole('textbox',{name:/MORPH-CT draft/}).inputValue(),'Synthetic report B05');
    await page.goto(base+'/#/admin');
    await inventory.getByText('10 / 10 cases uploaded',{exact:true}).waitFor();
    await inventory.getByText('Not open to readers',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await context.close();
  }
  console.log('PASS: Study B auto-save, metadata-only retry, persisted upload counts, admin inventories and case deep link.');
}finally{await browser?.close();await server.close();}

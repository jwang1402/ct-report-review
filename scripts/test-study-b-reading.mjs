// Optional browser test with the generated voxel phantom, a local API fixture and no clinical data.
// Set PLAYWRIGHT_MODULE and CHROME_PATH if Playwright or its bundled browser is unavailable.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const qa=resolve('.qa');
mkdirSync(qa,{recursive:true});
execFileSync(process.execPath,[resolve('scripts/create-test-volume.cjs')],{cwd:qa});
const phantom=readFileSync(resolve(qa,'work/phantom/SYNTH001.nii.gz'));
const hash=createHash('sha256').update(phantom).digest('hex');
const source='FINDINGS\nThe synthetic volume contains a central low-density region and a posterior high-density structure.\n\nIMPRESSION\nGenerated imaging phantom for this demonstration.';
const edited='FINDINGS\nThe central region and posterior structure are visible.\n\nIMPRESSION\nSynthetic volume. Reviewed and confirmed.';
const ids=['B05','B02','B03','B07','B01','B09','B06','B04','B08','B10'];
const ordered=[...ids].sort();
const assignments=()=>ids.map(id=>({case_id:id,started:false,submitted:false}));
const casesByRole={junior:assignments(),senior:assignments()};
const recordsByRole={junior:new Map(),senior:new Map()};
const opens=[],images=[],errors=[];
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false},logLevel:'error',
  define:{'import.meta.env.VITE_REVIEW_API_URL':JSON.stringify('/mock'),'import.meta.env.VITE_DRIVE_API_KEY':JSON.stringify('')}});
let browser;
try{
  await server.listen();
  const base='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined,args:['--enable-unsafe-swiftshader']});
  const ctx=await browser.newContext({viewport:{width:1500,height:960}});
  const page=await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>dialog.accept());
  await ctx.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==base)return route.abort();
    if(!url.pathname.startsWith('/mock/'))return route.continue();
    const path=url.pathname.slice(5),json=body=>route.fulfill({json:body});
    if(path==='/public/crossover-readers'){
      const {cohort,name}=req.postDataJSON();
      assert(['junior','senior'].includes(cohort));
      return json({role:'doctor',cohort,display_name:name,token:'fixture-'+cohort});
    }
    const cohort=req.headers().authorization?.replace('Bearer fixture-','');
    if(!['junior','senior'].includes(cohort))return route.fulfill({status:401,json:{error:'Session required'}});
    const examIds=casesByRole[cohort],records=recordsByRole[cohort];
    if(path==='/session')return json({username:'reader-fixture',role:'doctor',cohort,display_name:'Demo reader'});
    if(path==='/study-b')return json({status:'ready',period:1,opens_at:null,cases:examIds});
    const [,id,action]=path.match(/^\/study-b\/cases\/(B\d\d)(?:\/(open|image))?$/)||[];
    const item=examIds.find(c=>c.case_id===id);
    if(!item)return route.fulfill({status:404,json:{error:'Unknown fixture route'}});
    if(action==='open'){
      opens.push(id);
      if(item.submitted||examIds.some(c=>c.case_id!==id&&c.started&&!c.submitted))
        return route.fulfill({status:409,json:{error:'Finish the current reading.'}});
      if(!item.started){
        item.started=true;
        const assisted=cohort==='junior'&&id==='B05';
        records.set(id,{case_id:id,period:1,condition:assisted?'with_ai':'without_ai',report:'',
          ...(assisted?{draft:source}:{}),version:0,started_at:'2026-11-24T10:00:00Z',findings:{},
          imaging:{drive_url:'https://drive.google.com/file/d/test_synthetic_'+id+'/view',sha256:hash,size:phantom.length}});
      }
      return json(records.get(id));
    }
    if(action==='image'){
      images.push(id);
      assert(item.started&&!item.submitted);
      return route.fulfill({contentType:'application/octet-stream',body:phantom});
    }
    assert.equal(req.method(),'PUT');
    const body=req.postDataJSON(),record=records.get(id);
    assert.equal(body.version,record.version);
    Object.assign(record,{report:body.report,findings:body.findings,version:record.version+1});
    item.submitted=body.submit;
    return json({version:record.version,submitted:item.submitted});
  });
  const button=name=>page.getByRole('button',{name,exact:true});
  const rail=page.getByRole('navigation',{name:'Study B cases'});
  const pick=id=>rail.getByRole('button',{name:new RegExp(id)});
  const original=page.getByRole('region',{name:'Original MORPH-CT draft'});
  const report=page.locator('#sb-report');
  const visible=loc=>loc.waitFor({state:'visible'});
  const landing=page.getByRole('heading',{name:'Study B workspace',exact:true});
  const selectCase=id=>page.getByRole('link',{name:'Select '+id,exact:true});
  const workspace=page.getByRole('link',{name:'Workspace',exact:true});
  const login=async cohort=>{
    await page.goto(base+'/#/'+cohort);
    await page.getByLabel('Name',{exact:true}).fill('Demo reader');
    await button('Continue').click();
  };
  await login('junior');
  await visible(landing);
  await visible(selectCase('B10'));
  const caseLinks=page.getByRole('link',{name:/^Select B\d\d$/});
  const listed=await caseLinks.evaluateAll(links=>links.map(l=>l.href.split('case=')[1]));
  assert.deepEqual(listed,ordered);
  assert.equal(await original.count(),0);
  await page.screenshot({path:resolve(qa,'study-b-workspace-landing-desktop.png')});
  await selectCase('B02').click();
  await visible(page.getByRole('heading',{name:'B02',exact:true}));
  assert.deepEqual(await rail.locator('button strong').allTextContents(),ordered);
  await pick('B05').click();
  await visible(button('Open CT'));
  assert.equal(opens.length,0);
  assert.equal(images.length,0);
  await button('Open CT').click();
  await visible(report);
  assert.equal(await report.inputValue(),'');
  assert.equal(await page.locator('.sb-toggle button[aria-pressed="true"]').count(),0);
  await button('Submit final reading').click();
  await visible(page.getByText('Enter a final report before submitting.'));
  assert.equal(await original.innerText(),source);
  assert.equal(await original.locator('textarea,input,[contenteditable=true]').count(),0);
  const selectedText=await original.evaluate(el=>{
    const selection=window.getSelection(),range=document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();selection.addRange(range);
    return selection.toString();
  });
  assert.equal(selectedText,source);
  await report.fill(selectedText);
  await report.fill(edited);
  await page.getByRole('group',{name:'Pleural effusion',exact:true}).getByRole('button',{name:'Present'}).click();
  await page.getByLabel('Pleural effusion side').selectOption('right');
  await pick('B03').click();
  await button('Resume B05').click();
  assert.equal(await report.inputValue(),edited);
  assert.equal(await page.getByLabel('Pleural effusion side').inputValue(),'right');
  assert.deepEqual(opens,['B05']);
  assert(images.every(id=>id==='B05'));
  await button('Save draft').click();
  await visible(page.getByText('Draft saved.',{exact:true}));
  await workspace.click();
  await visible(landing);
  await page.getByRole('link',{name:'Resume B05',exact:true}).click();
  await page.reload();
  await button('Resume reading').click();
  await visible(report);
  assert.deepEqual(opens,['B05','B05']);
  assert.equal(await report.inputValue(),edited);
  assert((await original.innerText()).includes('posterior high-density structure'));
  assert.equal(await page.getByLabel('Pleural effusion side').inputValue(),'right');

  await page.waitForFunction(()=>document.querySelector('input[aria-label="Axial slice"]:enabled'),null,{timeout:60000});
  const railBox=await rail.boundingBox(),ctBox=await page.locator('[aria-label="CT viewer"]').boundingBox();
  const reportBox=await report.boundingBox();
  assert(railBox.x+railBox.width<=ctBox.x+2&&ctBox.x+ctBox.width<=reportBox.x+2,'desktop panel order');
  await page.screenshot({path:resolve(qa,'study-b-assisted-workspace.png')});
  await page.setViewportSize({width:390,height:844});
  const mobile=page.getByRole('combobox',{name:'Select examination'});
  await visible(mobile);
  assert.deepEqual(await mobile.locator('option').evaluateAll(opts=>opts.map(o=>o.value)),ordered);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile reading form overflows viewport');
  await mobile.selectOption('B02');
  assert.deepEqual(opens,['B05','B05']);
  await button('Resume B05').click();
  assert.equal(await report.inputValue(),edited);
  await page.setViewportSize({width:1500,height:960});
  await button('Submit final reading').click();
  await visible(page.getByText('Record each finding as present or absent before submitting.'));
  await button('Mark remaining 17 absent').click();
  await button('Submit final reading').click();
  await visible(button('Open CT'));
  assert.deepEqual(opens,['B05','B05']);
  await pick('B02').click();
  await button('Open CT').click();
  await visible(report);
  assert.equal(await original.count(),0);
  assert.equal(await report.inputValue(),'');
  assert.deepEqual(opens,['B05','B05','B02']);
  await page.setViewportSize({width:390,height:844});
  await login('senior');
  await page.getByRole('combobox',{name:'Study',exact:true}).selectOption('study-b');
  await button('Open study').click();
  await visible(landing);
  await visible(selectCase('B01'));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile workspace overflows viewport');
  await page.screenshot({path:resolve(qa,'study-b-workspace-landing-mobile.png')});
  await selectCase('B01').click();
  await visible(mobile);
  assert.equal(await mobile.inputValue(),'B01');
  assert.deepEqual(opens,['B05','B05','B02']);
  await button('Open CT').click();
  await visible(report);
  assert.equal(await original.count(),0);
  assert.equal(await report.inputValue(),'');
  await workspace.click();
  await visible(landing);
  await page.getByRole('link',{name:'Resume B01',exact:true}).click();
  await button('Resume reading').click();
  await page.waitForFunction(()=>document.querySelector('input[aria-label="Axial slice"]:enabled'),null,{timeout:60000});
  assert.equal(await report.inputValue(),'');
  assert.deepEqual(errors,[]);
  console.log('PASS: both reader workspaces, ordered cases on desktop and mobile, explicit CT start, blank aided and unaided reports, selectable original, independent findings, saving, resumption and final submission.');
} finally {await browser?.close();await server.close();}

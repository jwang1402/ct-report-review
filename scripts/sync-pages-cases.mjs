import {readFile,mkdir,writeFile,stat,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {owner,repo,pagesMirrorBudgetBytes}=JSON.parse(await readFile(path.join(project,'github.config.json'),'utf8'));
if(!/^[\w.-]+$/.test(owner)||!/^[\w.-]+$/.test(repo))throw new Error('Invalid repository configuration.');
const output=path.resolve(project,process.argv[2]||'dist');
const api=`https://api.github.com/repos/${owner}/${repo}`;
const dataLimit=Number(pagesMirrorBudgetBytes)||800_000_000;
if(dataLimit<=0||dataLimit>900_000_000)throw new Error('Set pagesMirrorBudgetBytes between 1 and 900000000 for this Pages test deployment.');
const siteLimit=950_000_000;
const headers={Accept:'application/vnd.github+json',...(process.env.GITHUB_TOKEN?{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`}:{})};
async function request(url,binary=false){const response=await fetch(url,{headers:{...headers,Accept:binary?'application/octet-stream':headers.Accept},signal:AbortSignal.timeout(600_000)});if(!response.ok)throw new Error(`GitHub returned HTTP ${response.status}. Check Actions permissions and API limits.`);return response;}
async function directorySize(dir){let size=0;for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){if(entry.name==='data')continue;const p=path.join(dir,entry.name);size+=entry.isDirectory()?await directorySize(p):(await stat(p)).size;}return size;}
const appSize=await directorySize(output);
const releases=[];
for(let page=1;;page++){const rows=await(await request(`${api}/releases?per_page=100&page=${page}`)).json();releases.push(...rows);if(rows.length<100)break;}
const cases=[],warnings=[];let total=0;
for(const release of releases.filter(r=>!r.draft&&r.tag_name.startsWith('case-'))){
 try{
  const metadataAsset=release.assets.find(a=>a.name==='case.json'&&a.state==='uploaded');
  if(!metadataAsset)throw new Error('case.json missing');
  if(metadataAsset.size>5_000_000)throw new Error('case.json exceeds 5 MB');
  const bytes=new Uint8Array(await(await request(metadataAsset.url,true)).arrayBuffer());
  if(bytes.byteLength!==metadataAsset.size)throw new Error('Incomplete case.json download');
  const c=JSON.parse(new TextDecoder().decode(bytes));
  if(c.schema_version!=='1.0'||!c.case_id||!c.case_name||!['NIFTI','DICOM'].includes(c.imaging?.type)||!Array.isArray(c.reports)||!c.reports.length)throw new Error('Invalid case.json schema');
  const asset=release.assets.find(a=>a.name===c.imaging.asset_name&&a.state==='uploaded');
  if(!asset||asset.size!==c.imaging.size||asset.size<=0)throw new Error('Missing or mismatched imaging asset');
  if(asset.size>=2*1024**3)throw new Error('Original asset exceeds the 2 GiB prototype limit');
  const extension=c.imaging.type==='DICOM'?'.zip':asset.name.toLowerCase().endsWith('.gz')?'.nii.gz':'.nii';
  const revision=createHash('sha256').update(`${asset.id}:${asset.updated_at}:${asset.digest||''}`).digest('hex').slice(0,12);
  const relative_url=`data/cases/${release.id}/${revision}/imaging${extension}.bin`;
  total+=asset.size+metadataAsset.size;
  cases.push({...c,release_id:release.id,release_url:release.html_url,tag:release.tag_name,asset,relative_url,_metadata:bytes});
 }catch(e){warnings.push(`${release.tag_name}: ${e.message}`);}
}
if(total>dataLimit||total+appSize>siteLimit)throw new Error(`Pages test mirror is too large: ${(total/1e6).toFixed(1)} MB imaging, ${(appSize/1e6).toFixed(1)} MB application. Limit: ${dataLimit/1e6} MB imaging / 950 MB site. Remove cases from the test repository or reduce dataset size. The previous Pages deployment is preserved.`);
for(const c of cases){
 const target=path.resolve(output,c.relative_url);
 if(!target.startsWith(output+path.sep))throw new Error('Unsafe output path');
 await mkdir(path.dirname(target),{recursive:true});
 const response=await request(c.asset.url,true);let written=0;const hash=createHash('sha256');
 const measure=new Transform({transform(chunk,encoding,callback){written+=chunk.length;if(written>c.asset.size||written>dataLimit){callback(new Error('Imaging response exceeds declared size'));return;}hash.update(chunk);callback(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body),measure,createWriteStream(target));
 if(written!==c.asset.size)throw new Error(`Incomplete imaging download for ${c.case_id}`);
 const digest=hash.digest('hex');if(c.asset.digest&&c.asset.digest!==`sha256:${digest}`)throw new Error(`SHA-256 verification failed for ${c.case_id}`);
 c.imaging.sha256=digest;
 await writeFile(path.join(path.dirname(target),'case.json'),c._metadata);
 delete c._metadata;
 console.log(`Mirrored ${c.case_id}: ${written} bytes, SHA-256 verified`);
}
await mkdir(path.join(output,'data'),{recursive:true});
await writeFile(path.join(output,'data','index.json'),JSON.stringify({schema:'ct-pages-index-v1',synced_at:new Date().toISOString(),repository:`${owner}/${repo}`,imaging_bytes:total,cases,warnings},null,2));
console.log(`Ready: ${cases.length} cases, ${(total/1e6).toFixed(1)} MB. ${warnings.length} warning(s).`);

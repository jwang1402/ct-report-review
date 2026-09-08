import type {Case,CaseRelease} from '../../types';
import {guardSize} from './releaseAssets';
let cached: {cases:CaseRelease[];warnings:string[]}|undefined;
export function parseCase(value:unknown):Case{
 if(!value||typeof value!=='object')throw new Error('Invalid case.json: expected an object.');
 const c=value as Case;
 if(c.schema_version!=='1.0'||typeof c.case_id!=='string'||! /^[\w-]+$/.test(c.case_id)||typeof c.case_name!=='string'||!c.case_name.trim()||typeof c.description!=='string'||!Number.isFinite(Date.parse(c.created_at)))throw new Error('Invalid case.json: required case fields are missing.');
 if(!c.imaging||!['NIFTI','DICOM'].includes(c.imaging.type)||typeof c.imaging.asset_name!=='string'||typeof c.imaging.filename!=='string'||!Number.isFinite(c.imaging.size))throw new Error('Invalid imaging metadata.');
 guardSize(c.imaging.size);
 if(!Array.isArray(c.reports)||!c.reports.length||c.reports.some(r=>!r||typeof r.id!=='string'||! /^[\w-]+$/.test(r.id)||![r.model_name,r.report_name,r.report_text].every(x=>typeof x==='string'&&!!x.trim()))||new Set(c.reports.map(r=>r.id)).size!==c.reports.length)throw new Error('Invalid or duplicate model reports in case.json.');
 return c;
}
export async function listCases(refresh=false){
 if(cached&&!refresh)return cached;
 const base=new URL('./',document.baseURI);
 let response:Response;
 try{response=await fetch(new URL('data/index.json',base),{cache:'no-store'});}catch{throw new Error('Cannot load the synchronized case index. Check your network.');}
 if(!response.ok)throw new Error('Pages case synchronization is not ready. Wait for the deployment workflow, then refresh.');
 const index=await response.json();
 if(index.schema!=='ct-pages-index-v1'||!Array.isArray(index.cases))throw new Error('Invalid Pages case index. Run the synchronization workflow again.');
 const cases:CaseRelease[]=[];const warnings:string[]=Array.isArray(index.warnings)?index.warnings.filter((w:unknown)=>typeof w==='string'):[];
 for(const r of index.cases){try{
  const c=parseCase(r);
  if(!Number.isSafeInteger(r.release_id)||!r.asset||r.asset.size!==c.imaging.size)throw new Error('Invalid mirrored asset metadata');
  const url=mirrorUrl(r.relative_url,base);
  cases.push({...c,release_id:r.release_id,release_url:r.release_url,tag:r.tag,asset:{...r.asset,url}});
 }catch(e){warnings.push(`${r.case_id||'Case'}: ${e instanceof Error?e.message:'Invalid case'}`);}}
 cached={cases,warnings};return cached;
}
export function mirrorUrl(relative:string,base:URL){
 if(typeof relative!=='string'||!/^data\/cases\/\d+\/[a-f0-9]+\/imaging\.(nii(\.gz)?|zip)\.bin$/.test(relative))throw new Error('Unsafe imaging mirror path');
 const url=new URL(relative,base);if(url.origin!==base.origin||!url.pathname.startsWith(base.pathname))throw new Error('Imaging must load from the same Pages origin');return url.href;
}
export async function getCase(id:number){const {cases}=await listCases();const c=cases.find(c=>c.release_id===id);if(!c)throw new Error('Case release not found.');return c;}

import type {Case,CaseRelease,ReleaseAsset} from '../../types';
import {allPages} from './githubClient';
import {downloadAsset,guardSize} from './releaseAssets';
interface Release {id:number;tag_name:string;html_url:string;draft:boolean;assets:ReleaseAsset[]}
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
 const releases=await allPages<Release>('/releases');const cases:CaseRelease[]=[];const warnings:string[]=[];
 for(const r of releases.filter(r=>!r.draft&&r.tag_name.startsWith('case-'))){try{
  const meta=r.assets.find(a=>a.name==='case.json'&&a.state==='uploaded');if(!meta)throw new Error('case.json missing');if(meta.size>5*1024**2)throw new Error('case.json exceeds 5 MB');
  const c=parseCase(JSON.parse(await (await downloadAsset(meta)).text()));
  const asset=r.assets.find(a=>a.name===c.imaging.asset_name&&a.state==='uploaded');if(!asset)throw new Error('CT asset missing');if(asset.size!==c.imaging.size)throw new Error('CT asset size does not match case.json');
  cases.push({...c,release_id:r.id,release_url:r.html_url,tag:r.tag_name,asset});
 }catch(e){warnings.push(`${r.tag_name}: ${e instanceof Error?e.message:'Invalid case'}`);}}
 cached={cases,warnings};return cached;
}
export async function getCase(id:number){const {cases}=await listCases();const c=cases.find(c=>c.release_id===id);if(!c)throw new Error('Case release not found.');return c;}

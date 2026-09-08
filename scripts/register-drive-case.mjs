import fs from 'node:fs';
export function registration(body,title){
 if(typeof body!=='string'||body.length>60000)throw Error('Registration too large');
 const r=JSON.parse(body),c=r.case;
 const id=x=>typeof x==='string'&&/^[\w-]{10,200}$/.test(x);
 if(r.schema!=='ct-register-v1'||!c||c.schema_version!=='1.0'||typeof c.case_id!=='string'||! /^[\w-]+$/.test(c.case_id)||title!==`[CT-REGISTER] ${c.case_id}`||!id(c.file_id)||!id(r.metadata_file_id))throw Error('Invalid registration identifiers');
 if(typeof c.case_name!=='string'||!c.case_name.trim()||typeof c.description!=='string'||!Number.isFinite(Date.parse(c.created_at)))throw Error('Invalid case metadata');
 const a=c.imaging;
 if(!a||!['NIFTI','DICOM'].includes(a.type)||!Number.isSafeInteger(a.size)||a.size<=0||a.size>=2*1024**3||typeof a.filename!=='string'||typeof a.asset_name!=='string'||! /^[a-f0-9]{64}$/.test(a.sha256))throw Error('Invalid imaging metadata');
 if(!Array.isArray(c.reports)||!c.reports.length||new Set(c.reports.map(x=>x.id)).size!==c.reports.length||c.reports.some(x=>typeof x.id!=='string'||! /^[\w-]+$/.test(x.id)||![x.model_name,x.report_name,x.report_text].every(v=>typeof v==='string'&&v.trim())))throw Error('Invalid reports');
 return {...c,metadata_file_id:r.metadata_file_id};
}
if(process.env.CT_REGISTER_EVENT){
 const e=JSON.parse(fs.readFileSync(process.env.CT_REGISTER_EVENT,'utf8'));
 if(e.sender.login!==e.repository.owner.login||e.issue.user.login!==e.repository.owner.login)throw Error('Only repository owner can publish cases');
 const c=registration(e.issue.body,e.issue.title),file='public/drive-cases/index.json',index=JSON.parse(fs.readFileSync(file,'utf8'));
 const existing=index.cases.find(x=>x.case_id===c.case_id);
 if(existing&&existing.registration_issue!==e.issue.number)throw Error('Case ID already exists; use a new ID.');
 if(!existing)index.cases.push({...c,review_id:1_000_000_000_000+e.issue.number,registration_issue:e.issue.number});
 fs.writeFileSync(file,JSON.stringify(index,null,2)+'\n');
}

import fs from 'node:fs';
export function removalRequest(body,title){
 const r=JSON.parse(body);
 if(r.schema!=='ct-remove-v1'||typeof r.case_id!=='string'||! /^[\w-]+$/.test(r.case_id)||!Number.isSafeInteger(r.release_id)||r.release_id<=0||title!==`[CT-REMOVE] ${r.case_id}`)throw new Error('Invalid case removal request');
 return {case_id:r.case_id,release_id:r.release_id};
}
if(process.env.CT_REMOVE_EVENT){
 const event=JSON.parse(fs.readFileSync(process.env.CT_REMOVE_EVENT,'utf8'));
 if(event.sender.login!==event.repository.owner.login||event.issue.user.login!==event.repository.owner.login)throw new Error('Only the repository owner may remove a case');
 const item=removalRequest(event.issue.body,event.issue.title);
 const file='public/removed-cases.json';
 const data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{schema:'ct-removed-v1',cases:[]};
 if(!data.cases.some(x=>x.case_id===item.case_id&&x.release_id===item.release_id))data.cases.push(item);
 fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
}

import {blankCase,type CaseConfig,type CaseEntry} from './studyB';

export const caseIds=Array.from({length:10},(_,i)=>'B'+String(i+1).padStart(2,'0'));

function entries(input:unknown):CaseEntry[] {
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>64||input.some(x=>!x||typeof x.id!=='string'||typeof x.description!=='string'))
    throw new Error('Each reference finding or draft error must have an ID and a description.');
  return input.map(({id,description})=>({id,description}));
}

export function readConfiguration(text:string):CaseConfig[] {
  const data:unknown=JSON.parse(text.replace(/^\uFEFF/,''));
  const rows=Array.isArray(data)?data:data&&typeof data==='object'&&'cases' in data?data.cases:null;
  if(!Array.isArray(rows)||rows.length>10)throw new Error('Choose a JSON file containing up to ten Study B cases.');
  const seen=new Set<string>();
  return rows.map(r=>{
    if(!r||!caseIds.includes(r.case_id)||seen.has(r.case_id))throw new Error('Use each case ID B01 through B10 once.');
    seen.add(r.case_id);
    const row=blankCase(r.case_id);
    for(const field of ['drive_url','sha256','draft','reference'] as const) {
      if(r[field]!==undefined&&typeof r[field]!=='string')throw new Error('Invalid '+field+' for '+r.case_id+'.');
      row[field]=r[field]??'';
    }
    if(r.size!==undefined&&(!Number.isSafeInteger(r.size)||r.size<0))throw new Error('Invalid CT size for '+r.case_id+'.');
    row.size=r.size??0;
    row.reference_findings=entries(r.reference_findings);row.draft_errors=entries(r.draft_errors);
    return row;
  });
}

import {StudyError} from './admin-study.mjs';
import {hasHan} from './english-ui.mjs';
import {findings,isStudyACase} from './study-a.mjs';

const text=(v,max)=>typeof v==='string' && v.length<=max && !hasHan(v) && !v.includes('\0');
const sides=['','left','right','bilateral','midline','unspecified','not_applicable'];
const latest=`SELECT r.* FROM study_a_expert_references r
  WHERE NOT EXISTS(SELECT 1 FROM study_a_expert_references n WHERE n.case_id=r.case_id AND n.version>r.version)`;

export async function listReferences(db) {
  const {results}=await db.prepare(latest+' ORDER BY case_id').all();
  return {references:results.map(({findings_json,...rest})=>({...rest,findings:JSON.parse(findings_json)}))};
}

export async function saveReference(db,body) {
  const {case_id:id,version,expert,findings:items,notes}=body;
  if(!isStudyACase(id)||!Number.isSafeInteger(version)||version<0||!text(expert,160)||!expert.trim()||
      !text(notes,4000)||!items||typeof items!=='object'||Object.keys(items).length!==findings.length) {
    throw new StudyError(400,'Provide a Study A case, reference reviewer and a decision for each finding.');
  }
  const values={};
  for(const key of findings){
    const item=items[key];
    if(!item||!['present','absent','indeterminate'].includes(item.status)||!sides.includes(item.side)||
        (item.status!=='present' && item.side!==''))throw new StudyError(400,'Check each reference finding and its side.');
    values[key]={status:item.status,side:item.side};
  }
  const row=await db.prepare(`INSERT INTO study_a_expert_references(case_id,version,expert,findings_json,notes,recorded_at)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM study_a_reports WHERE case_id=?)
    AND COALESCE((SELECT MAX(version) FROM study_a_expert_references WHERE case_id=?),0)=?
    ON CONFLICT DO NOTHING RETURNING version`).bind(id,version+1,expert.trim(),JSON.stringify(values),notes.trim(),new Date().toISOString(),id,id,version).first();
  if(!row)throw new StudyError(409,'The case or its reference changed. Reload before saving.');
  return row;
}

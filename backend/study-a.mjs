import { StudyError } from './admin-study.mjs';
import { englishReport } from './english-report.mjs';
import { hasHan } from './english-ui.mjs';

export const isStudyACase = id => /^BR4shared-Case(?:0[1-9]|10)$/.test(id);
const findings = [
  'cardiomegaly','hiatal_hernia','pericardial_effusion','lymphadenopathy','lung_nodule','emphysema',
  'interlobular_septal_thickening','consolidation','atelectasis','lung_opacity','pulmonary_fibrotic_sequela',
  'bronchiectasis','pleural_effusion','mosaic_attenuation_pattern','arterial_wall_calcification',
  'peribronchial_thickening','medical_material','coronary_artery_wall_calcification'
];
const errorTypes = ['missed','unsupported','location','other'];
const rawChecklist='radbert-raw';
const activeChecklist="COALESCE((SELECT version FROM study_a_checklist_releases WHERE active=1),'radbert-raw')";

function readLabels(dbValue) {
  if (!dbValue) return null;
  const labels=JSON.parse(dbValue);
  return Object.keys(labels).length===findings.length && findings.every(f=>labels[f]===0 || labels[f]===1)
    ? labels : null;
}

function review(row) {
  if (row?.rating == null) return null;
  return {rating:row.rating, comment:row.comment, mode:row.mode, errors:JSON.parse(row.errors_json),
    confirmed:!!row.confirmed, version:row.version, updated_at:row.updated_at, checklist_version:row.checklist_version};
}

async function loadCase(db,id,user,digest) {
  const {results}=await db.prepare(`SELECT s.letter,s.model_name,p.report_text,
    COALESCE(v.revision,'initial') AS case_revision,${activeChecklist} AS active_checklist,
    r.rating,r.comment,r.mode,r.errors_json,r.confirmed,r.version,r.updated_at,r.checklist_version
    FROM study_a_reports s JOIN private_reports p USING(case_id,model_name)
    LEFT JOIN web_case_versions v ON v.case_id=s.case_id
    LEFT JOIN study_a_reviews r ON r.case_id=s.case_id AND r.model_name=s.model_name AND r.username=?
    WHERE s.case_id=? ORDER BY s.letter`).bind(user.username,id).all();
  if (results.length!==3) throw new StudyError(409,'The three Study A reports are not available for this case.');
  return Promise.all(results.map(async row=>{
    const text=englishReport(row.report_text);
    const hash=await digest(text.replace(/\r\n/g,'\n').trim());
    // Readers reopening a saved assessment continue to see the checklist they actually rated.
    const version=row.checklist_version??row.active_checklist;
    const record=await db.prepare(`SELECT f.labels_json,
      (SELECT json_group_object(o.finding,o.reviewed_value) FROM study_a_finding_overrides o
       WHERE o.version=? AND o.text_sha256=f.text_sha256) AS corrections
      FROM study_a_findings f WHERE f.text_sha256=?`).bind(version,hash).first();
    const labels=readLabels(record?.labels_json);
    const revision=row.active_checklist===rawChecklist?row.case_revision:row.case_revision+'|'+row.active_checklist;
    return {...row,text,hash,revision,checklist_version:version,findings:labels&&Object.assign(labels,JSON.parse(record.corrections))};
  }));
}

export async function studyACaseDetails(db,id,user,digest) {
  const rows=await loadCase(db,id,user,digest);
  return {protocol:'study-a',revision:rows[0].revision,reports:rows.map(r=>({
    letter:r.letter,text:r.text,findings:r.findings,
    ...(user.role==='admin'?{model_name:r.model_name}:{review:review(r)})
  }))};
}

export async function studyAProgress(db,user,cases) {
  if (!cases.some(r=>isStudyACase(r.case_id))) return cases;
  const doctor=user.role==='doctor';
  const counts=await db.prepare(`SELECT a.case_id,COUNT(*) AS expected,COUNT(r.version) AS submitted
    FROM assignments a JOIN study_a_reports s USING(case_id,model_name)
    LEFT JOIN study_a_reviews r USING(username,case_id,model_name)
    WHERE (? IS NULL OR a.username=?) GROUP BY a.case_id`)
    .bind(doctor?user.username:null,doctor?user.username:null).all();
  const byId=new Map(counts.results.map(r=>[r.case_id,r]));
  return cases.map(row=>{
    if (!isStudyACase(row.case_id)) return row;
    const total=byId.get(row.case_id);
    return {...row,protocol:'study-a',report_count:3,...(doctor&&{reviewed_count:total?.submitted??0}),
      scored:!!total && total.expected>=3 && total.submitted===total.expected};
  });
}

const isObject=v=>v!==null && typeof v==='object' && !Array.isArray(v);
const textOK=(v,limit)=>typeof v==='string' && v.length<=limit && !hasHan(v) && !v.includes('\0');

function validate(data) {
  if (!['A','B','C'].includes(data.letter) || typeof data.revision!=='string' || data.revision.length>100 ||
      !Number.isSafeInteger(data.version) || data.version<0 || !Number.isInteger(data.rating) || data.rating<1 || data.rating>5 ||
      !textOK(data.comment,10000) || !['no','yes'].includes(data.mode) || data.confirmed!==true ||
      !Array.isArray(data.errors) || data.errors.length>200 || (data.mode==='yes')!==(data.errors.length>0)) {
    throw new StudyError(400,'Choose the error status, rate the report, and confirm your review.');
  }
  return data.errors.map(e=>{
    if (!isObject(e) || (!findings.includes(e.finding) && e.finding!=='other') ||
        !errorTypes.includes(e.type) || typeof e.significant!=='boolean' || !textOK(e.other??'',240) ||
        (e.finding==='other')!==!!(e.other??'').trim() || !textOK(e.detail??'',1000)) {
      throw new StudyError(400,'Each error needs a finding, an error type, and a clinical significance choice.');
    }
    return {finding:e.finding,other:(e.other??'').trim(),type:e.type,significant:e.significant,detail:(e.detail??'').trim()};
  });
}

export async function saveStudyAReview(db,id,user,data,digest) {
  const errors=JSON.stringify(validate(data));
  const rows=await loadCase(db,id,user,digest);
  const source=rows.find(r=>r.letter===data.letter);
  if (source.revision!==data.revision || !source.text || !source.findings) {
    throw new StudyError(409,'The report or findings are unavailable or have changed. Reload the case.');
  }
  const identity=[user.username,id,source.model_name];
  const now=new Date().toISOString(), fields=[source.hash,data.rating,data.comment,data.mode,errors,now];
  // Check the shared report key, original text, assignment and editor revision in the write statement.
  const guard=`EXISTS(SELECT 1 FROM study_a_reports s JOIN assignments a USING(case_id,model_name)
    JOIN private_reports p USING(case_id,model_name) LEFT JOIN web_case_versions v ON v.case_id=s.case_id
    WHERE a.username=? AND s.case_id=? AND s.model_name=? AND s.letter=? AND p.report_text=?
      AND COALESCE(v.revision,'initial')=? AND ${activeChecklist}=?)`;
  const args=[...identity,data.letter,source.report_text,source.case_revision,source.active_checklist];
  let sql,params;
  if (!data.version) {
    sql=`INSERT INTO study_a_reviews(username,case_id,model_name,text_sha256,rating,comment,mode,errors_json,updated_at,confirmed,version,checklist_version)
      SELECT ?,?,?,?,?,?,?,?,?,1,1,? WHERE ${guard} ON CONFLICT(username,case_id,model_name) DO NOTHING RETURNING *`;
    params=[...identity,...fields,source.checklist_version,...args];
  } else {
    sql=`UPDATE study_a_reviews SET text_sha256=?,rating=?,comment=?,mode=?,errors_json=?,updated_at=?,version=version+1
      WHERE username=? AND case_id=? AND model_name=? AND version=? AND ${guard} RETURNING *`;
    params=[...fields,...identity,data.version,...args];
  }
  let saved=await db.prepare(sql).bind(...params).first();
  if (!saved) {
    // A lost response may be retried without adding another submission, error or version.
    saved=await db.prepare('SELECT * FROM study_a_reviews WHERE username=? AND case_id=? AND model_name=?')
      .bind(...identity).first();
    if (!saved || saved.version!==data.version+1 || saved.text_sha256!==source.hash || saved.checklist_version!==source.checklist_version ||
        saved.rating!==data.rating || saved.comment!==data.comment || saved.mode!==data.mode || saved.errors_json!==errors) {
      throw new StudyError(409,'This review has changed. Reload it before submitting.');
    }
  }
  return {ok:true,review:review(saved)};
}

export async function studyAResults(db,roster) {
  const [keyRows,ratings,enrolled]=await Promise.all([
    db.prepare('SELECT case_id,letter,model_name FROM study_a_reports ORDER BY case_id,letter').all(),
    db.prepare(`SELECT s.letter,r.* FROM study_a_reviews r JOIN study_a_reports s USING(case_id,model_name)
      ORDER BY r.case_id,r.username,s.letter`).all(),
    db.prepare(`SELECT DISTINCT a.username,s.case_id FROM assignments a JOIN study_a_reports s USING(case_id,model_name)
      ORDER BY a.username,s.case_id`).all()
  ]);
  const readers=roster.map(r=>({...r,case_ids:enrolled.results.filter(e=>e.username===r.username).map(e=>e.case_id)}))
    .filter(r=>r.case_ids.length);
  const names=new Map(readers.map(r=>[r.username,r.display_name]));
  return {assignments:keyRows.results,readers,results:ratings.results.map(r=>({
    case_id:r.case_id,username:r.username,display_name:names.get(r.username),letter:r.letter,model_name:r.model_name,
    protocol:'study-a',...review(r)
  }))};
}

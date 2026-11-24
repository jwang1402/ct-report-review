import {driveFileReference,driveImage,StudyError} from './admin-study.mjs';
import {findings as categories} from './study-a.mjs';
import {hasHan} from './english-ui.mjs';
import {summarizeStudyB} from './study-b-analysis.mjs';

const washoutSeconds = 28 * 24 * 60 * 60;
const casePattern = /^B(?:0[1-9]|10)$/;
const date = seconds => seconds == null ? null : new Date(seconds * 1000).toISOString();
const check = (ok,code,message) => { if (!ok) throw new StudyError(code,message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function textValue(raw,limit,required=false) {
  const value = raw ?? '';
  check(typeof value === 'string' && value.length <= limit && !value.includes('\0') && !hasHan(value) &&
    (!required || value.trim()),400,'Check the text fields and their lengths.');
  return value.trim();
}
function items(rows) {
  check(Array.isArray(rows) && rows.length<=64,400,'Provide a list of up to 64 items per case.');
  const seen = new Set();
  return rows.map(row=>{
    check(object(row) && typeof row.id === 'string' && /^[\w-]{1,60}$/.test(row.id) && !seen.has(row.id),400,'Each finding or draft error needs a unique ID.');
    seen.add(row.id);
    return {id:row.id,description:textValue(row.description,1000,true)};
  });
}
function randomOrder(cases) {
  const row = cases.map(c=>c.case_id);
  for(let i=row.length-1;i>0;i--){
    const range=i+1, cap=2**32 - 2**32 % range;
    const n=new Uint32Array(1);
    do { crypto.getRandomValues(n); } while(n[0]>=cap);
    const j=n[0]%range;
    [row[i],row[j]]=[row[j],row[i]];
  }
  return row;
}

async function getConfig(db) {
  const row=await db.prepare('SELECT * FROM study_b_cohort WHERE id=1').first();
  return {status:row.frozen?'frozen':'draft',version:row.version,cases:JSON.parse(row.cases_json),order:JSON.parse(row.order_json)};
}
async function adminConfig(db) {
  const {status,version,cases}=await getConfig(db);
  const {results}=await db.prepare('SELECT case_id,reference_json,version,locked FROM study_b_case_references').all();
  const references=new Map(results.map(r=>[r.case_id,r]));
  return {status,version,cases:cases.map(c=>{
    const r=references.get(c.case_id);
    return {...c,...(r?.reference_json?JSON.parse(r.reference_json):{}),
      reference_version:r?.version??0,reference_locked:Boolean(r?.locked)};
  })};
}
function referenceFields(c) {
  return {reference:textValue(c.reference,48000),reference_findings:items(c.reference_findings??[]),
    draft_errors:items(c.draft_errors??[])};
}
async function saveReference(db,data) {
  check(object(data) && casePattern.test(data.case_id) && Number.isSafeInteger(data.version) && data.version>=0 &&
    ['reference','reference_findings','draft_errors'].every(k=>Object.hasOwn(data,k)),400,'Supply the case, reference fields and saved reference version.');
  const config=await getConfig(db);
  check(config.status==='frozen',409,'Open the study before editing references separately.');
  check(config.cases.some(c=>c.case_id===data.case_id),404,'Unknown case.');
  const ref=JSON.stringify(referenceFields(data));
  const saved=data.version===0?
    await db.prepare('INSERT INTO study_b_case_references(case_id,reference_json,version) VALUES(?,?,1) ON CONFLICT(case_id) DO NOTHING RETURNING version')
      .bind(data.case_id,ref).first():
    await db.prepare('UPDATE study_b_case_references SET reference_json=?,version=version+1 WHERE case_id=? AND version=? AND locked=0 RETURNING version')
      .bind(ref,data.case_id,data.version).first();
  check(saved,409,'This reference has changed or has been used for assessment. Reload the case.');
  return adminConfig(db);
}
async function configure(db,data) {
  check(object(data) && Array.isArray(data.cases) && data.cases.length<=10 && Number.isInteger(data.version) &&
    typeof data.freeze==='boolean',400,'Supply the saved version, the case list, and the freeze option.');
  const freeze=data.freeze;
  check(!freeze || data.cases.length===10,400,'Freeze all ten Study B cases together.');
  const ids = new Set(), imageIds=new Set(), hashes=new Set();
  const aImages = await db.prepare("SELECT DISTINCT p.image_key FROM private_cases p JOIN study_a_reports s USING(case_id)").all();
  for(const row of aImages.results){
    const image=driveImage(row.image_key);
    if(image){imageIds.add(driveFileReference(image.drive_url).id);hashes.add(image.sha256);}
    else {
      const hash=row.image_key.match(/\/([a-f0-9]{64})(?:\/|$)/);
      if(hash)hashes.add(hash[1]);
    }
  }
  const cases=data.cases.map(c=>{
    check(object(c) && typeof c.case_id==='string' && casePattern.test(c.case_id) && !ids.has(c.case_id),400,'Use unique Study B identifiers B01 through B10.');
    ids.add(c.case_id);
    let url=textValue(c.drive_url,1500,freeze);
    if(url){
      const f=driveFileReference(url);
      check(!imageIds.has(f.id),400,'Study B requires a different CT file for every case, separate from Study A.');
      imageIds.add(f.id);
      const [,query] = f.reference.split('?');
      url='https://drive.google.com/file/d/'+f.id+'/view'+(query?'?'+query:'');
    }
    const sha=textValue(c.sha256,64,freeze), size=c.size ?? 0;
    if(sha){
      check(/^[a-f0-9]{64}$/.test(sha) && !hashes.has(sha),400,'Use a unique CT checksum, separate from Study A.');
      hashes.add(sha);
    }
    check(Number.isSafeInteger(size) && size>=0 && size<2**31 && (!freeze || size>2),400,'Provide the NIfTI file size in bytes.');
    return {case_id:c.case_id,drive_url:url,sha256:sha,size,draft:textValue(c.draft,48000,freeze),...referenceFields(c)};
  }).sort((a,b)=>a.case_id.localeCompare(b.case_id));
  const serialized=JSON.stringify(cases);
  check(new TextEncoder().encode(serialized).length<1500000,400,'The case manifest is too large.');
  const saved=await db.prepare('UPDATE study_b_cohort SET cases_json=?,order_json=?,version=version+1,frozen=? WHERE id=1 AND version=? AND frozen=0 RETURNING version')
    .bind(serialized,JSON.stringify(freeze?randomOrder(cases):[]),Number(freeze),data.version).first();
  check(saved,409,'The cohort changed or is frozen. Reload the setup.');
  return {status:freeze?'frozen':'draft',version:saved.version,cases};
}

function assignment(cohort, slot, ordered, id, period) {
  if(cohort==='senior') return 'without_ai';
  const i=ordered.indexOf(id);
  // Pair the first two schedules; alternate positions for the third. Across a trio
  // each case starts with AI for one or two readers and each reader has five of each.
  const withAi=[i<5,i>=5,i%2===0][(slot-1)%3];
  return (period===1?withAi:!withAi)?'with_ai':'without_ai';
}

async function readerState(db,user,now) {
  check(user.role==='doctor' && ['junior','senior'].includes(user.cohort),403,'Enter Study B through your reader link.');
  const config=await getConfig(db);
  const empty={period:1,opens_at:null,cases:[]};
  if(config.status!=='frozen') return {list:{...empty,status:'not_ready'}};
  const id=user.username;
  const existing=await db.prepare('SELECT cohort,slot FROM study_b_readers WHERE username=?').bind(id).first();
  const slot=existing?.slot;
  if(existing)check(existing.cohort===user.cohort,409,'This reading identity belongs to another reader group.');
  const rows=(await db.prepare('SELECT case_id,period,submitted_at FROM study_b_readings WHERE username=?').bind(id).all()).results;
  const p1=rows.filter(r=>r.period===1 && r.submitted_at!==null);
  let period=1, opens=null;
  if(p1.length===10){
    if(user.cohort==='senior') return {list:{...empty,status:'complete'}};
    period=2; opens=Math.max(...p1.map(r=>r.submitted_at))+washoutSeconds;
    if(now<opens) return {list:{...empty,status:'washout',period,opens_at:date(opens)}};
    if(!Number.isFinite(user.name_confirmed_at)||user.name_confirmed_at<opens)
      return {list:{...empty,status:'confirm_name',period,opens_at:date(opens)}};
  }
  const current=rows.filter(r=>r.period===period);
  if(current.filter(r=>r.submitted_at!==null).length===10) return {list:{...empty,status:'complete',period}};
  const ids=period===1?config.order:[...config.order].reverse();
  return {config,slot,list:{status:'ready',period,opens_at:date(opens),cases:ids.map(id=>{
    const r=current.find(row=>row.case_id===id);
    return {case_id:id,started:!!r,submitted:r?.submitted_at!=null};
  })}};
}
function allowed(state,caseId,period) {
  check(state.list.status==='ready' && state.list.period===period,409,'This reading period is unavailable. Return to the task list.');
  const task=state.list.cases.find(c=>c.case_id===caseId);
  check(task,404,'Unknown case.');
  check(!task.submitted,409,'This report has already been submitted.');
  return state.config.cases.find(c=>c.case_id===caseId);
}
export async function studyBImage(db,user,caseId,now) {
  const state=await readerState(db,user,now);
  const c=allowed(state,caseId,state.list.period);
  check(state.list.cases.some(task=>task.case_id===caseId && task.started),403,'Open your assigned reading before loading the CT.');
  return {drive_url:c.drive_url,size:c.size};
}
async function openCase(db,user,caseId,body,now) {
  const state=await readerState(db,user,now);
  const period=body?.period;
  const c=allowed(state,caseId,period);
  const active=state.list.cases.find(task=>task.started&&!task.submitted);
  check(!active||active.case_id===caseId,409,'Resume and submit the current reading before opening another CT.');
  let slot=state.slot;
  if(!slot){
    await db.prepare('INSERT INTO study_b_readers(username,cohort,slot) SELECT ?,?,COALESCE(MAX(slot),0)+1 FROM study_b_readers WHERE cohort=? ON CONFLICT(username) DO NOTHING')
      .bind(user.username,user.cohort,user.cohort).run();
    slot=(await db.prepare('SELECT slot FROM study_b_readers WHERE username=?').bind(user.username).first()).slot;
  }
  const condition=assignment(user.cohort,slot,state.config.order,caseId,period);
  // Both the read identity and the single ongoing timer are guarded by unique indexes.
  await db.prepare('INSERT INTO study_b_readings(username,case_id,period,arm,started_at,report) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING')
    .bind(user.username,caseId,period,condition,now,condition==='with_ai'?c.draft:'').run();
  const row=await db.prepare('SELECT * FROM study_b_readings WHERE username=? AND case_id=? AND period=?')
    .bind(user.username,caseId,period).first();
  check(row,409,'Resume and submit the current reading before opening another CT.');
  check(row.submitted_at==null,409,'This report has already been submitted.');
  return {case_id:caseId,period,condition,imaging:{drive_url:c.drive_url,sha256:c.sha256,size:c.size},started_at:date(row.started_at),
    version:row.version,report:row.report,findings:JSON.parse(row.findings_json),...(condition==='with_ai'?{draft:c.draft}:{})};
}
function validateFindings(values,final) {
  check(object(values) && Object.keys(values).every(k=>categories.includes(k)),400,'Invalid finding in the checklist.');
  const result={};
  for(const key of categories){
    const v=values[key];
    if(v===undefined&&!final)continue;
    check(object(v) && typeof v.present==='boolean' &&
      (v.present?['left','right','bilateral','unspecified','na'].includes(v.side):v.side==='na'),
      400,'Complete the present/absent and applicable laterality decisions.');
    result[key]={present:v.present,side:v.side};
  }
  return result;
}
async function saveCase(db,user,caseId,body,now) {
  check(object(body) && Number.isInteger(body.version) && body.version>=0 && [1,2].includes(body.period) &&
    typeof body.submit==='boolean',400,'Invalid report version, period or submission type.');
  const report=textValue(body.report,48000,body.submit);
  const labels=JSON.stringify(validateFindings(body.findings,body.submit));
  const key=[user.username,caseId,body.period];
  const state=await readerState(db,user,now);
  const existing=await db.prepare('SELECT report,findings_json,submitted_at,version FROM study_b_readings WHERE username=? AND case_id=? AND period=?')
    .bind(...key).first();
  const response=r=>({version:r.version,submitted:r.submitted_at!=null,submitted_at:date(r.submitted_at)});
  // A retry acknowledges only the same write and never returns previous-period content.
  if(existing && existing.version===body.version+1 && existing.report===report && existing.findings_json===labels &&
    (existing.submitted_at!==null)===body.submit)return response(existing);
  allowed(state,caseId,body.period);
  const updated=await db.prepare('UPDATE study_b_readings SET report=?,findings_json=?,submitted_at=?,version=version+1 WHERE username=? AND case_id=? AND period=? AND submitted_at IS NULL AND version=? RETURNING submitted_at,version')
    .bind(report,labels,body.submit?now:null,...key,body.version).first();
  check(updated,409,'This report was changed or has not been opened. Reload it.');
  return response(updated);
}

function parsedAssessment(r) {
  return r?.assessment_version==null?null:{version:r.assessment_version,errors:JSON.parse(r.errors_json),
    accepted_draft_errors:JSON.parse(r.accepted_json),assessor:r.assessor,assessed_at:date(r.assessed_at)};
}
async function results(db,selection) {
  const out=await db.prepare(`SELECT r.*,p.cohort,c.display_name,a.version AS assessment_version,a.errors_json,
    a.accepted_json,a.assessor,a.assessed_at FROM study_b_readings r JOIN study_b_readers p USING(username)
    LEFT JOIN crossover_readers c USING(username) LEFT JOIN study_b_assessments a USING(username,case_id,period)
    ORDER BY r.case_id,r.period,r.username`).all();
  const config=await adminConfig(db);
  const readings=out.results.map(r=>{
    const c=config.cases.find(item=>item.case_id===r.case_id);
    return {username:r.username,display_name:r.display_name,cohort:r.cohort,case_id:r.case_id,period:r.period,condition:r.arm,
      started_at:date(r.started_at),submitted_at:date(r.submitted_at),elapsed_seconds:r.submitted_at==null?null:r.submitted_at-r.started_at,
      report:r.report,findings:JSON.parse(r.findings_json),reference:c.reference,reference_findings:c.reference_findings,
      draft:c.draft,draft_errors:c.draft_errors,assessment:parsedAssessment(r)};
  });
  if(selection!==undefined){
    check(object(selection),400,'Specify three junior and two senior readers.');
    for(const [key,cohort,count] of [['juniors','junior',3],['seniors','senior',2]]){
      const ids=selection[key];
      check(Array.isArray(ids)&&ids.length===count&&new Set(ids).size===count&&
        ids.every(id=>typeof id==='string'&&readings.some(r=>r.username===id&&r.cohort===cohort)),400,'Select distinct Study B readers from the correct cohorts.');
    }
    return {analysis:summarizeStudyB(readings,config.cases,selection)};
  }
  return {cases:config.cases,readings,analysis:summarizeStudyB(readings,config.cases)};
}
async function assess(db,user,data,now) {
  check(object(data) && casePattern.test(data.case_id) && [1,2].includes(data.period) && typeof data.username==='string' &&
    Number.isInteger(data.version) && data.version>=0,400,'Invalid assessment.');
  const key=[data.username,data.case_id,data.period];
  const row=await db.prepare('SELECT arm FROM study_b_readings WHERE username=? AND case_id=? AND period=? AND submitted_at IS NOT NULL')
    .bind(...key).first();
  check(row,409,'Submit the independent reading before assessing it.');
  const c=(await adminConfig(db)).cases.find(c=>c.case_id===data.case_id);
  check(c?.reference.trim(),409,'Add the independent expert reference before assessing this case.');
  const expected=Object.hasOwn(data,'reference_version')?data.reference_version:0;
  check(c.reference_version===expected,409,'The reference has changed. Reload the assessment.');
  check(Array.isArray(data.errors) && data.errors.length<=180,400,'Provide a list of errors.');
  const errors=data.errors.map(e=>{
    check(object(e) && ['missed','unsupported','location','other'].includes(e.type) &&
      typeof e.significant==='boolean',400,'Each error needs a type and clinical importance.');
    const ref=e.reference_id??'';
    check((ref==='' && e.type!=='missed') || c.reference_findings.some(f=>f.id===ref),400,'Select the affected reference finding.');
    return {finding:textValue(e.finding,120,true),type:e.type,significant:e.significant,detail:textValue(e.detail,1000),reference_id:ref};
  });
  const accepted=data.accepted_draft_errors;
  check(Array.isArray(accepted) && new Set(accepted).size===accepted.length &&
    accepted.every(id=>row.arm==='with_ai' && c.draft_errors.some(e=>e.id===id)),400,'Select only draft errors available in this reading.');
  const params=[JSON.stringify(errors),JSON.stringify(accepted),user.username,now];
  const saved=data.version===0?
    await db.prepare(`INSERT INTO study_b_assessments(username,case_id,period,version,errors_json,accepted_json,assessor,assessed_at)
      SELECT ?,?,?,1,?,?,?,? WHERE COALESCE((SELECT version FROM study_b_case_references WHERE case_id=?),0)=?
      ON CONFLICT DO NOTHING RETURNING version`).bind(...key,...params,data.case_id,expected).first():
    await db.prepare('UPDATE study_b_assessments SET errors_json=?,accepted_json=?,assessor=?,assessed_at=?,version=version+1 WHERE username=? AND case_id=? AND period=? AND version=? RETURNING version').bind(...params,...key,data.version).first();
  check(saved,409,'The reference or assessment has changed. Reload the results.');
  return {version:saved.version};
}

export async function routeStudyB(path,request,user,db,{jsonBody,now}) {
  if(path==='/admin/study-b'||path.startsWith('/admin/study-b/')){
    check(user.role==='admin',403,'Administrator access required.');
    if(path==='/admin/study-b' && request.method==='GET')return adminConfig(db);
    if(path==='/admin/study-b' && request.method==='PUT')return configure(db,await jsonBody(request,1500000));
    if(path==='/admin/study-b/references' && request.method==='PUT')return saveReference(db,await jsonBody(request,1500000));
    if(path==='/admin/study-b/results' && request.method==='GET')return results(db);
    if(path==='/admin/study-b/analysis' && request.method==='POST')return results(db,await jsonBody(request,4096));
    if(path==='/admin/study-b/assessment' && request.method==='PUT')return assess(db,user,await jsonBody(request,220000),now);
    throw new StudyError(404,'Unknown Study B endpoint.');
  }
  if(path!=='/study-b'&&!path.startsWith('/study-b/'))return null;
  check(user.role==='doctor' && ['senior','junior'].includes(user.cohort),403,'Enter through a reader link.');
  if(path==='/study-b' && request.method==='GET')return (await readerState(db,user,now)).list;
  const match=/^\/study-b\/cases\/(B(?:0[1-9]|10))(\/open)?$/.exec(path);
  if(match?.[2] && request.method==='POST')return openCase(db,user,match[1],await jsonBody(request,1024),now);
  if(match && !match[2] && request.method==='PUT')return saveCase(db,user,match[1],await jsonBody(request,200000),now);
  throw new StudyError(404,'Unknown Study B endpoint.');
}

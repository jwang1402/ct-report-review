import {StudyError} from './admin-study.mjs';
import {hasHan} from './english-ui.mjs';

const uuid='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const secretPattern=new RegExp('^'+uuid+uuid+'$','i');
const publicView=user=>({role:'doctor',cohort:user.cohort,display_name:user.display_name});
function displayName(value) {
  const name=typeof value==='string'?value.normalize('NFC').trim().replace(/ +/g,' '):'';
  if(!name || name.length>100 || hasHan(name) || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name))
    throw new StudyError(400,'Enter a valid reader name.');
  return name;
}

export async function crossoverSession(db,tokenHash,now) {
  return db.prepare("SELECT r.username,'doctor' AS role,r.cohort,r.display_name,s.name_confirmed_at,s.expires "+
    "FROM crossover_sessions s JOIN crossover_readers r USING(username) WHERE s.token_hash=? AND s.expires>?")
    .bind(tokenHash,now).first();
}
export function visibleCrossover(user){return publicView(user);}

export async function enterCrossover(request,db,now,{jsonBody,digest}) {
  const {cohort,name:value,entry_key:key}=await jsonBody(request,2048);
  if(!['senior','junior'].includes(cohort)||typeof key!=='string'||!secretPattern.test(key))
    throw new StudyError(400,'Reopen your reader entry page.');
  const name=displayName(value), nameKey=name.toLowerCase(), hash=await digest('crossover-device:'+key);
  const bucket=await digest(JSON.stringify(['reader-entry',request.headers.get('CF-Connecting-IP')||'local',Math.floor(now/600)]));
  const {count}=await db.prepare('INSERT INTO login_attempts VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket).first();
  if(count>90)throw new StudyError(429,'Too many entries. Please try again in ten minutes.');
  const id='reader:'+crypto.randomUUID().replaceAll('-','');
  const token='readerx.'+crypto.randomUUID()+crypto.randomUUID(), tokenHash=await digest(token);
  const newReader=`NOT EXISTS (SELECT 1 FROM crossover_readers WHERE cohort=? AND name_key=?)
    AND NOT EXISTS (SELECT 1 FROM crossover_devices WHERE device_hash=?)`;
  // Resolve the name, bind the browser and pin this session to its reader in one transaction.
  // A same-cohort name takes precedence. An unknown spelling reuses the current browser binding.
  const statements=[
    db.prepare(`INSERT INTO accounts(username,role,password_hash,password_salt)
      SELECT ?,'doctor','crossover-reader','' WHERE `+newReader).bind(id,cohort,nameKey,hash),
    db.prepare(`INSERT INTO crossover_readers(username,cohort,display_name,name_key)
      SELECT ?,?,?,? WHERE `+newReader).bind(id,cohort,name,nameKey,cohort,nameKey,hash),
    db.prepare(`INSERT INTO crossover_devices(device_hash,username)
      SELECT ?,r.username FROM crossover_readers r WHERE r.cohort=? AND r.name_key=?
      AND NOT EXISTS (SELECT 1 FROM crossover_devices d JOIN crossover_readers owner USING(username)
        WHERE d.device_hash=? AND owner.cohort!=r.cohort)
      ON CONFLICT(device_hash) DO UPDATE SET username=excluded.username
      WHERE crossover_devices.username!=excluded.username`).bind(hash,cohort,nameKey,hash),
    db.prepare(`INSERT INTO crossover_sessions(token_hash,username,name_confirmed_at,expires)
      SELECT ?,r.username,?,? FROM crossover_devices d JOIN crossover_readers r USING(username)
      WHERE d.device_hash=? AND r.cohort=?`).bind(tokenHash,now,now+12*3600,hash,cohort),
    db.prepare(`DELETE FROM crossover_requests WHERE device_hash=?
      AND EXISTS (SELECT 1 FROM crossover_sessions WHERE token_hash=?)`).bind(hash,tokenHash)
  ];
  if(cohort==='senior')statements.push(db.prepare(`INSERT INTO assignments(username,case_id,letter,model_name,case_order)
    SELECT t.username,s.case_id,s.letter,s.model_name,s.case_order FROM crossover_sessions t
    CROSS JOIN shared_case_letters s JOIN private_cases c USING(case_id)
    WHERE t.token_hash=? AND s.case_id IN (SELECT case_id FROM study_a_reports)
    AND c.image_key GLOB 'blind/BR4shared/*' AND EXISTS(SELECT 1 FROM public_studies WHERE prefix='BR4shared' AND enabled=1)
    ON CONFLICT DO NOTHING`).bind(tokenHash));
  await db.batch(statements);
  const reader=await crossoverSession(db,tokenHash,now);
  if(!reader)throw new StudyError(403,'Use the link for your reader group.');
  return {token,...publicView(reader)};
}
export async function crossoverAccess(request,db,jsonBody){
  if(request.method==='GET'){
    const readers=await db.prepare('SELECT username,cohort,display_name FROM crossover_readers ORDER BY cohort,display_name').all();
    return {readers:readers.results,pending:[]};
  }
  const {username,action,name}=await jsonBody(request,2048);
  if(action!=='rename')throw new StudyError(400,'Choose a reader to rename.');
  const next=displayName(name);
  const saved=await db.prepare('UPDATE crossover_readers SET display_name=?,name_key=? WHERE username=? AND NOT EXISTS(SELECT 1 FROM crossover_readers r WHERE r.cohort=crossover_readers.cohort AND r.name_key=? AND r.username!=?) RETURNING username').bind(next,next.toLowerCase(),username,next.toLowerCase(),username).first();
  if(!saved)throw new StudyError(409,'Check the reader and choose a unique name.');
  return {ok:true};
}

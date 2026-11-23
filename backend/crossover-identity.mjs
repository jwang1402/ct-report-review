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
  const {cohort,name:value,entry_key:key,returning=false}=await jsonBody(request,2048);
  if(!['senior','junior'].includes(cohort)||typeof returning!=='boolean'||typeof key!=='string'||!secretPattern.test(key))
    throw new StudyError(400,'Reopen your reader entry page.');
  const name=displayName(value), nameKey=name.toLowerCase(), hash=await digest('crossover-device:'+key);
  const bucket=await digest(JSON.stringify(['reader-entry',request.headers.get('CF-Connecting-IP')||'local',Math.floor(now/600)]));
  const {count}=await db.prepare('INSERT INTO login_attempts VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket).first();
  if(count>90)throw new StudyError(429,'Too many entries. Please try again in ten minutes.');
  const lookup=()=>db.prepare('SELECT r.* FROM crossover_devices d JOIN crossover_readers r USING(username) WHERE d.device_hash=?').bind(hash).first();
  let reader=await lookup();
  if(!reader && !returning){
    const id='reader:'+hash.slice(0,32);
    const available='NOT EXISTS(SELECT 1 FROM crossover_readers WHERE cohort=? AND name_key=?) AND NOT EXISTS(SELECT 1 FROM crossover_requests WHERE device_hash=?) AND NOT EXISTS(SELECT 1 FROM crossover_devices WHERE device_hash=?)';
    await db.batch([
      db.prepare("INSERT INTO accounts(username,role,password_hash,password_salt) SELECT ?,'doctor','crossover-reader','' WHERE "+available+" ON CONFLICT DO NOTHING").bind(id,cohort,nameKey,hash,hash),
      db.prepare("INSERT INTO crossover_readers(username,cohort,display_name,name_key) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM accounts WHERE username=? AND password_hash='crossover-reader') AND "+available+" ON CONFLICT DO NOTHING")
        .bind(id,cohort,name,nameKey,id,cohort,nameKey,hash,hash),
      db.prepare("INSERT INTO crossover_devices(device_hash,username) SELECT ?,? WHERE EXISTS(SELECT 1 FROM crossover_readers WHERE username=? AND cohort=? AND name_key=?) ON CONFLICT DO NOTHING")
        .bind(hash,id,id,cohort,nameKey)
    ]);
    reader=await lookup();
  }
  if(!reader){
    await db.prepare('INSERT INTO crossover_requests(id,device_hash,cohort,requested_name,created_at) SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM crossover_devices WHERE device_hash=?) ON CONFLICT(device_hash) DO NOTHING')
      .bind(crypto.randomUUID(),hash,cohort,name,now,hash).run();
    const q=await db.prepare('SELECT id FROM crossover_requests WHERE device_hash=?').bind(hash).first();
    if(!q)throw new StudyError(409,'Device access changed. Enter your name again.');
    return {pending:true,request_code:q.id.slice(0,8)};
  }
  if(reader.cohort!==cohort)throw new StudyError(403,'Use the link for your reader group.');
  if(reader.name_key!==nameKey)throw new StudyError(409,'The name differs from the name saved for this reader. Check the spelling or contact your coordinator.');
  const token='readerx.'+crypto.randomUUID()+crypto.randomUUID(), tokenHash=await digest(token);
  const statements=[db.prepare('INSERT INTO crossover_sessions(token_hash,username,name_confirmed_at,expires) VALUES(?,?,?,?)')
    .bind(tokenHash,reader.username,now,now+12*3600)];
  if(cohort==='senior')statements.push(db.prepare("INSERT INTO assignments(username,case_id,letter,model_name,case_order) SELECT ?,s.case_id,s.letter,s.model_name,s.case_order FROM shared_case_letters s JOIN private_cases c USING(case_id) WHERE s.case_id IN (SELECT case_id FROM study_a_reports) AND c.image_key GLOB 'blind/BR4shared/*' AND EXISTS(SELECT 1 FROM public_studies WHERE prefix='BR4shared' AND enabled=1) ON CONFLICT DO NOTHING").bind(reader.username));
  await db.batch(statements);
  return {token,...publicView(reader)};
}
export async function crossoverAccess(request,db,jsonBody){
  if(request.method==='GET'){
    const [readers,pending]=await Promise.all([db.prepare('SELECT username,cohort,display_name FROM crossover_readers ORDER BY cohort,display_name').all(),
      db.prepare('SELECT id,cohort,requested_name,created_at FROM crossover_requests ORDER BY created_at').all()]);
    return {readers:readers.results,pending:pending.results};
  }
  const {id,username,action,name}=await jsonBody(request,2048);
  if(action==='rename'){
    const next=displayName(name);
    const saved=await db.prepare('UPDATE crossover_readers SET display_name=?,name_key=? WHERE username=? AND NOT EXISTS(SELECT 1 FROM crossover_readers r WHERE r.cohort=crossover_readers.cohort AND r.name_key=? AND r.username!=?) RETURNING username').bind(next,next.toLowerCase(),username,next.toLowerCase(),username).first();
    if(!saved)throw new StudyError(409,'Check the reader and choose a unique name.');
    return {ok:true};
  }
  if(action==='dismiss'){await db.prepare('DELETE FROM crossover_requests WHERE id=?').bind(id).run();return {ok:true};}
  if(action!=='link'||!username||!id)throw new StudyError(400,'Choose a request and reader.');
  const result=await db.batch([
    db.prepare('INSERT INTO crossover_devices(device_hash,username) SELECT q.device_hash,r.username FROM crossover_requests q JOIN crossover_readers r USING(cohort) WHERE q.id=? AND r.username=? ON CONFLICT DO NOTHING RETURNING username').bind(id,username),
    db.prepare('DELETE FROM crossover_requests WHERE id=? AND EXISTS(SELECT 1 FROM crossover_devices d WHERE d.device_hash=crossover_requests.device_hash AND d.username=?)').bind(id,username)]);
  if(!(result[0].meta?.changes || result[0].changes || result[0].results?.length))throw new StudyError(409,'Request unavailable or reader group mismatch.');
  return {ok:true};
}

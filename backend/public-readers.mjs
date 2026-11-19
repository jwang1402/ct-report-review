import {StudyError,driveImage} from './admin-study.mjs';

const prefixPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const uuid4='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const entryKey=new RegExp('^'+uuid4+uuid4+'$','i');
const guestLifetime=30*24*3600;
const studiesFrom=" FROM web_batches b LEFT JOIN public_studies p ON b.prefix=p.prefix "+
  "WHERE b.state='published' AND json_extract(b.manifest,'$.provider')='drive' ";

export async function listReaderStudies(db,admin) {
  const {results}=await db.prepare("SELECT b.prefix,json_array_length(b.manifest,'$.cases') AS case_count"+
    (admin?',COALESCE(p.enabled,0) AS enabled':'')+studiesFrom+(admin?'':' AND p.enabled=1')+' ORDER BY b.prefix').all();
  return {studies:admin?results.map(s=>({...s,enabled:!!s.enabled})):results};
}

function checkedPrefix(prefix) {
  if(typeof prefix!=='string'||!prefixPattern.test(prefix)) throw new StudyError(400,'Invalid study ID.');
  return prefix;
}

export async function publicStudyImages(db,prefix) {
  checkedPrefix(prefix);
  const study=await db.prepare("SELECT json_array_length(b.manifest,'$.cases') AS case_count"+studiesFrom+'AND b.prefix=?').bind(prefix).first();
  if(!study) throw new StudyError(404,'Published Drive study not found.');
  const {results}=await db.prepare('SELECT case_id,image_key,image_size FROM private_cases WHERE image_key GLOB ? ORDER BY case_id')
    .bind('blind/'+prefix+'/*').all();
  if(!results.length||results.length!==study.case_count) throw new StudyError(409,'Incomplete Drive study.');
  return {images:results.map(c=>{
    const image=driveImage(c.image_key);
    if(!image) throw new StudyError(409,'All cases must have a Drive file.');
    return {case_id:c.case_id,size:c.image_size,...image};
  })};
}

export async function setReaderAccess(db,{prefix,enabled}) {
  checkedPrefix(prefix);
  if(typeof enabled!=='boolean') throw new StudyError(400,'Choose whether to open the study to readers.');
  const study=await db.prepare('SELECT b.prefix'+studiesFrom+'AND b.prefix=?').bind(prefix).first();
  if(!study) throw new StudyError(404,'Published Drive study not found.');
  const changes=[db.prepare('INSERT INTO public_studies(prefix,enabled) VALUES(?,?) ON CONFLICT(prefix) DO UPDATE SET enabled=excluded.enabled').bind(prefix,Number(enabled))];
  if(!enabled) changes.push(db.prepare('UPDATE public_readers SET closed=1 WHERE prefix=? AND closed=0').bind(prefix));
  await db.batch(changes);
  return {prefix,enabled};
}

export async function guestSession(db,tokenHash,now) {
  return db.prepare("SELECT r.username,'doctor' AS role,r.display_name,r.prefix AS public_study,r.expires "+
    'FROM public_readers r JOIN public_studies p USING(prefix) WHERE r.token_hash=? AND r.expires>? AND r.closed=0 AND p.enabled=1')
    .bind(tokenHash,now).first();
}

export async function joinStudy(request,db,now,{jsonBody,digest}) {
  const {name:input,prefix,entry_key:key}=await jsonBody(request,4096);
  checkedPrefix(prefix);
  const name=typeof input==='string'?input.trim().normalize('NFC'):'';
  if(!name||name.length>100||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)) throw new StudyError(400,'Enter your name, up to 100 characters.');
  if(typeof key!=='string'||!entryKey.test(key)) throw new StudyError(400,'Please reopen the reader form.');
  const open=await db.prepare('SELECT 1 AS ok FROM public_studies WHERE prefix=? AND enabled=1').bind(prefix).first();
  if(!open) throw new StudyError(404,'This study is not open.');
  // The entry key is generated on the reader's device. A lost HTTP response can be retried
  // without starting a second reviewer. Names are never credentials or uniqueness keys.
  const token='reader.'+await digest(JSON.stringify([prefix,key]));
  const tokenHash=await digest(token);
  const username='reader:'+tokenHash.slice(0,32);
  const existing=await db.prepare('SELECT username FROM public_readers WHERE token_hash=?').bind(tokenHash).first();
  if(!existing){
    const ip=request.headers.get('CF-Connecting-IP')||'local';
    const bucket=await digest(JSON.stringify(['join-public',ip,Math.floor(now/600)]));
    const attempt=await db.prepare('INSERT INTO login_attempts(bucket,count) VALUES(?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket).first();
    if(attempt.count>60) throw new StudyError(429,'Too many registrations from this network. Please try again in 10 minutes.');
    const allowed=' WHERE EXISTS(SELECT 1 FROM public_studies WHERE prefix=? AND enabled=1)';
    await db.batch([
      db.prepare("INSERT INTO accounts(username,role,password_salt,password_hash) SELECT ?,'doctor','','public-reader'"+allowed+
        ' ON CONFLICT(username) DO NOTHING').bind(username,prefix),
      db.prepare('INSERT INTO public_readers(username,prefix,display_name,token_hash,expires) SELECT ?,?,?,?,?'+allowed+
        ' ON CONFLICT(username) DO NOTHING').bind(username,prefix,name,tokenHash,now+guestLifetime,prefix),
      db.prepare('INSERT INTO assignments(username,case_id,letter,model_name,case_order) '+
        'SELECT ?,s.case_id,s.letter,s.model_name,s.case_order FROM shared_case_letters s JOIN private_cases c USING(case_id) '+
        'WHERE c.image_key GLOB ? AND EXISTS(SELECT 1 FROM public_readers r JOIN public_studies p USING(prefix) '+
        'WHERE r.username=? AND r.closed=0 AND p.enabled=1) ON CONFLICT(username,case_id,letter) DO NOTHING')
        .bind(username,'blind/'+prefix+'/*',username)
    ]);
  }
  const user=await guestSession(db,tokenHash,now);
  if(!user) throw new StudyError(403,'This reader session ended. Start a new review.');
  if(user.display_name!==name) throw new StudyError(409,'This reader session was started under another name.');
  return {token,...user};
}

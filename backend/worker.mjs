import {adminStudy,driveImage,StudyError} from './admin-study.mjs';
import {englishReport} from './english-report.mjs';
import {manageReaders,readerRoster} from './admin-doctor.mjs';
import {hasHan,displayCaseName,displayReaderName,displayComment} from './english-ui.mjs';
import {guestSession,joinStudy,listReaderStudies,publicStudyImages,setReaderAccess} from './public-readers.mjs';
import {isStudyACase,studyACaseDetails,studyAProgress,saveStudyAReview,studyAResults} from './study-a.mjs';
const siteOrigin='https://jwang1402.github.io';
const origins = new Set([siteOrigin, 'http://127.0.0.1:5173', 'http://localhost:5173']);
const encoder = new TextEncoder();
const casePath = /^\/blind\/cases\/([A-Za-z0-9_-]{1,100})(?:\/(ratings|image|study-a-review))?$/;
const letters = ['A', 'B', 'C', 'D'];
const sessionSeconds = 12 * 60 * 60;

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
}

export async function digest(text) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: encoder.encode(salt), iterations: 100000, hash: 'SHA-256'
  }, key, 256));
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function jsonBody(request,maxBytes=100000) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'JSON required');
  const reader=request.body?.getReader();
  if (!reader) throw new HttpError(400,'Expected a JSON object.');
  const decoder=new TextDecoder();
  let size=0, text='';
  try {
    while (true) {
      const {done,value}=await reader.read();
      if (done) break;
      size+=value.byteLength;
      if (size>maxBytes) { await reader.cancel(); throw new HttpError(413,'Request too large'); }
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();
  } finally { reader.releaseLock(); }
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new HttpError(400, 'Invalid JSON object'); }
}

async function login(request, db, now) {
  const data = await jsonBody(request);
  if (typeof data.username !== 'string' || !data.username.trim() || data.username.length > 100
      || typeof data.password !== 'string' || !data.password || data.password.length > 200) {
    throw new HttpError(400, 'Enter your username and password.');
  }
  const username = data.username.trim();
  const window = Math.floor(now / 600);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  const bucket = await digest(JSON.stringify(['login', ip, username, window]));
  const failureBucket = await digest(JSON.stringify(['failures', ip, window]));
  const ipFailures = await db.prepare('SELECT count FROM login_attempts WHERE bucket=?').bind(failureBucket).first();
  if (ipFailures?.count >= 60) throw new HttpError(429, 'Too many attempts. Wait 10 minutes and try again.');
  const attempt = await db.prepare(
    'INSERT INTO login_attempts(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count'
  ).bind(bucket).first();
  if (attempt.count > 10) throw new HttpError(429, 'Too many attempts. Wait 10 minutes and try again.');
  const account = await db.prepare('SELECT * FROM accounts WHERE username=?').bind(username).first();
  const computed = await passwordHash(data.password, account?.password_salt || 'unavailable-account');
  if (!account || !equal(computed, account.password_hash)) {
    await db.prepare('INSERT INTO login_attempts(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1')
      .bind(failureBucket).run();
    throw new HttpError(401, 'Incorrect username or password.');
  }
  await db.prepare('DELETE FROM login_attempts WHERE bucket=?').bind(bucket).run();
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expires = now + sessionSeconds;
  // Changing account permissions or credentials invalidates previously issued sessions.
  await db.prepare('INSERT INTO account_sessions(token_hash,username,role,credential_stamp,expires) VALUES (?,?,?,?,?)')
    .bind(await digest(token), account.username, account.role, account.password_hash, expires).run();
  return {token, username: account.username, role: account.role, expires};
}

async function sessionFor(request, db, now) {
  const match = /^Bearer ([^\s]{1,200})$/.exec(request.headers.get('Authorization') || '');
  if (!match) throw new HttpError(401, 'Please sign in.');
  const tokenHash = await digest(match[1]);
  const user = match[1].startsWith('reader.') ? await guestSession(db,tokenHash,now) : await db.prepare(
    'SELECT a.username,a.role,s.expires FROM account_sessions s JOIN accounts a ON a.username=s.username ' +
    'AND a.role=s.role AND a.password_hash=s.credential_stamp WHERE s.token_hash=? AND s.expires>?'
  ).bind(tokenHash, now).first();
  if (!user) throw new HttpError(401, 'Your session expired. Please sign in again.');
  return {user, tokenHash};
}

function requireRole(user, role) {
  if (user.role !== role) throw new HttpError(403, 'Your account does not have access.');
}

async function caseList(db, user) {
  const doctor = user.role === 'doctor';
  const query = doctor
    ? db.prepare('SELECT c.case_id, c.case_id AS case_name, MIN(a.rating IS NOT NULL) AS scored ' +
        'FROM assignments a JOIN private_cases c USING(case_id) WHERE a.username=? ' +
        'GROUP BY c.case_id HAVING COUNT(*)=4 ORDER BY MIN(a.case_order),c.case_id').bind(user.username)
    : db.prepare('SELECT c.case_id,c.case_name,MIN(a.rating IS NOT NULL) ' +
        'AND COUNT(a.letter)=4*COUNT(DISTINCT a.username) AS scored FROM private_cases c ' +
        'LEFT JOIN assignments a USING(case_id) GROUP BY c.case_id ORDER BY c.case_id');
  const {results} = await query.all();
  const cases=results.map(row => ({...row, case_name:displayCaseName(row.case_name,row.case_id), scored: Boolean(row.scored)}));
  return {cases:await studyAProgress(db,user,cases)};
}

async function authorizedCase(db, user, id) {
  const columns = 'SELECT case_id,case_name,image_filename,image_key,image_size FROM private_cases WHERE case_id=?';
  const query = user.role === 'admin' ? db.prepare(columns).bind(id)
    : db.prepare(columns + ' AND (SELECT COUNT(*) FROM assignments WHERE username=? AND case_id=?)=4')
      .bind(id, user.username, id);
  const row = await query.first();
  if (!row) throw new HttpError(404, 'Case not found.');
  return row;
}

async function caseDetails(db, user, row) {
  const doctor = user.role === 'doctor';
  const drive=driveImage(row.image_key);
  const publicCT=drive && await publicStudyEnabled(db,row);
  const base={
    case_id:row.case_id,case_name:doctor?row.case_id:displayCaseName(row.case_name,row.case_id),
    imaging:{type:'NIFTI',filename:row.case_id+(row.image_filename.endsWith('.gz')?'.nii.gz':'.nii'),size:row.image_size,...drive},
    ...(publicCT && {public_ct:true})
  };
  if(isStudyACase(row.case_id))return {...base,...await studyACaseDetails(db,row.case_id,user,digest)};
  const query = doctor
    ? db.prepare("SELECT a.letter,r.report_text AS text,a.rating,a.comment,COALESCE(v.revision,'initial') AS revision " +
        'FROM assignments a JOIN private_reports r USING(case_id,model_name) LEFT JOIN web_case_versions v ON v.case_id=a.case_id ' +
        'WHERE a.username=? AND a.case_id=? ORDER BY a.letter').bind(user.username, row.case_id)
    : db.prepare('SELECT r.model_name,r.report_text AS text,s.letter FROM private_reports r '+
        'LEFT JOIN shared_case_letters s USING(case_id,model_name) WHERE r.case_id=? ORDER BY s.letter,r.model_name')
      .bind(row.case_id);
  const {results} = await query.all();
  return {
    ...base,
    reports: doctor ? results.map(({letter,text,rating,comment})=>({
      letter,text:englishReport(text),rating,comment:hasHan(comment)?null:comment
    })) : results.map(({letter,model_name,text})=>({
      ...(letter&&{letter}),model_name,text:englishReport(text)
    })),
    ...(doctor && {revision:results[0]?.revision ?? 'initial'})
  };
}

async function saveRatings(db, username, id, data) {
  if (Object.keys(data).some(k => !['ratings','revision'].includes(k)) || !Array.isArray(data.ratings) || data.ratings.length !== letters.length) {
    throw new HttpError(400, 'Submit the four reports for this case together.');
  }
  const revision = data.revision ?? 'initial';
  if (typeof revision !== 'string' || revision.length>100) throw new HttpError(400,'Invalid case revision');
  const byLetter = new Map();
  for (const entry of data.ratings) {
    if (!entry || Object.keys(entry).some(k => !['letter', 'rating', 'comment'].includes(k))
        || !letters.includes(entry.letter) || byLetter.has(entry.letter)
        || !Number.isInteger(entry.rating) || entry.rating < 1 || entry.rating > 5
        || (entry.comment!==null && (typeof entry.comment !== 'string' || entry.comment.length > 10000))) {
      throw new HttpError(400, 'Each report needs a unique letter and a score from 1 to 5.');
    }
    if(hasHan(entry.comment))throw new HttpError(400,`The comment for report ${entry.letter} contains unsupported characters. Edit or clear it to submit your ratings.`);
    byLetter.set(entry.letter,entry);
  }
  const stamp = new Date().toISOString();
  const originals=await db.prepare('SELECT report_text FROM private_reports WHERE case_id=?').bind(id).all();
  if(originals.results.length!==4 || originals.results.some(r=>!englishReport(r.report_text))) {
    throw new HttpError(409,'A report is unavailable. Contact the study coordinator before rating this case.');
  }
  // One transaction for the four reports. A retry with unchanged data preserves its timestamp.
  const writes=letters.map(letter => {
    const entry = byLetter.get(letter);
    return db.prepare('UPDATE assignments SET rating=?,comment=COALESCE(?,comment),updated_at=? ' +
      "WHERE username=? AND case_id=? AND letter=? AND (rating IS NOT ? OR comment<>COALESCE(?,comment)) " +
      "AND COALESCE((SELECT revision FROM web_case_versions WHERE case_id=?),'initial')=?")
      .bind(entry.rating,entry.comment,stamp,username,id,letter,entry.rating,entry.comment,id,revision);
  });
  await db.batch(writes);
  const current=await db.prepare("SELECT revision FROM web_case_versions WHERE case_id=?").bind(id).first();
  if ((current?.revision ?? 'initial')!==revision) throw new HttpError(409,'These reports changed. Reload the case and review the updated text before rating.');
}

function byteRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2])) throw new HttpError(416, 'Invalid byte range.');
  const first = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const last = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first > last || first >= size) {
    throw new HttpError(416, 'Invalid byte range.');
  }
  return {offset: first, length: last - first + 1};
}

async function publicStudyEnabled(db,row) {
  const result=await db.prepare('SELECT enabled FROM public_studies WHERE prefix=?').bind(row.image_key.split('/')[1]).first();
  return Boolean(result?.enabled);
}

const maxDriveRange=4*1024*1024;

async function driveMediaBytes(request,drive,key,range,totalSize) {
  // The file ID and optional resource key come solely from the stored, validated sharing link.
  const link=new URL(drive.drive_url);
  const fileId=link.pathname.split('/')[3];
  const resourceKey=link.searchParams.get('resourcekey');
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+fileId);
  url.search=new URLSearchParams({alt:'media',supportsAllDrives:'true'}).toString();
  const headers=new Headers({'X-Goog-Api-Key':key,'Accept-Encoding':'identity'});
  const origin=request.headers.get('Origin');
  const referer=request.headers.get('Referer');
  if(origin===siteOrigin && referer && URL.canParse(referer)){
    const ref=new URL(referer);
    if(ref.origin===origin && !ref.username && !ref.password){
      headers.set('Origin',origin);
      headers.set('Referer',ref.origin+'/');
    }
  }
  if(resourceKey) headers.set('X-Goog-Drive-Resource-Keys',fileId+'/'+resourceKey);
  const interval=range && range.offset+'-'+(range.offset+range.length-1);
  if(range) headers.set('Range','bytes='+interval);
  const expectedLength=range?.length??totalSize;
  const upstream=await fetch(url,{headers,method:'GET',cache:'no-store',redirect:'manual',signal:request.signal});
  if(upstream.status===403){
    await upstream.body?.cancel();
    throw new HttpError(403,'Google Drive denied access to this CT download.');
  }
  const contentLength=upstream.headers.get('Content-Length');
  const encoding=upstream.headers.get('Content-Encoding');
  const contentRange=upstream.headers.get('Content-Range');
  const invalid=new HttpError(502,'Google Drive did not return the requested CT data. Please retry.');
  if(upstream.status!==(range?206:200)||!upstream.body||contentRange!==(range?'bytes '+interval+'/'+totalSize:null)
      ||(contentLength!==null&&contentLength!==String(expectedLength))||(encoding&&encoding!=='identity')
      ||/text\/|application\/json/i.test(upstream.headers.get('Content-Type')||'')){
    await upstream.body?.cancel();
    throw invalid;
  }
  // Stream into one bounded range and verify its actual length before returning a successful response.
  const bytes=new Uint8Array(expectedLength);
  const reader=upstream.body.getReader();
  let offset=0;
  try {
    for(;;){
      const {value,done}=await reader.read();
      if(done) break;
      if(offset+value.byteLength>expectedLength){await reader.cancel(); throw invalid;}
      bytes.set(value,offset); offset+=value.byteLength;
    }
  } finally {reader.releaseLock();}
  if(offset!==expectedLength) throw invalid;
  return bytes;
}

async function imageResponse(request, env, row, headers) {
  const drive=driveImage(row.image_key);
  if(drive){
    if(!await publicStudyEnabled(env.DB,row)) throw new HttpError(409,'Open the authorized Google Drive link to download this image.');
    if(!env.DRIVE_MEDIA_KEY) throw new HttpError(503,'The CT download service has not been configured.');
  }else if (!env.IMAGES) throw new HttpError(503, 'Private image storage is unavailable.');
  const output = new Headers(headers);
  output.set('Content-Type', 'application/octet-stream');
  output.set('Accept-Ranges','bytes');
  output.set('Access-Control-Expose-Headers','Content-Range, Content-Length, Accept-Ranges');
  let range;
  const head = request.method === 'HEAD';
  try {
    range = byteRange(request.headers.get('Range'),row.image_size);
    if (drive && (!head||range) && (range?.length??row.image_size)>maxDriveRange) throw new HttpError(416,'Request a smaller byte range.');
  }
  catch {
    output.set('Content-Range','bytes */' + row.image_size);
    return new Response(null,{status:416,headers:output});
  }
  output.set('Content-Length',String(range?.length ?? row.image_size));
  if (range) output.set('Content-Range','bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + row.image_size);
  if(drive){
    const body=head?null:await driveMediaBytes(request,drive,env.DRIVE_MEDIA_KEY,range,row.image_size);
    return new Response(body,{status:range?206:200,headers:output});
  }
  const obj = head ? await env.IMAGES.head(row.image_key)
    : await env.IMAGES.get(row.image_key,range ? {range} : {});
  if (!obj || obj.size !== row.image_size) throw new HttpError(503,'Case image is unavailable or incomplete.');
  return new Response(head ? null : obj.body,{status:range ? 206 : 200,headers:output});
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = {'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'Origin, Authorization','X-Content-Type-Options':'nosniff'};
    if (origin && origins.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const reply = (data,status=200) => new Response(JSON.stringify(data),{status,headers});
    if (origin && !origins.has(origin)) return reply({error:'Origin not allowed'},403);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{
      ...headers,'Access-Control-Allow-Methods':'GET, HEAD, POST, PUT, DELETE, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, Range'
    }});
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const now = Math.floor(Date.now()/1000);
      if (path === '/health' && request.method === 'GET') return reply({ok:true});
      if (path === '/public/studies' && request.method === 'GET') return reply(await listReaderStudies(env.DB,false));
      if (path === '/public/readers' && request.method === 'POST') return reply(await joinStudy(request,env.DB,now,{jsonBody,digest}));
      if (path === '/login' && request.method === 'POST') return reply(await login(request,env.DB,now));
      const {user,tokenHash} = await sessionFor(request,env.DB,now);
      if (path === '/session' && request.method === 'GET') return reply({...user,display_name:displayReaderName(user.display_name,user.username)});
      if (path === '/logout' && request.method === 'POST') {
        const sql=user.public_study ? 'UPDATE public_readers SET closed=1 WHERE token_hash=?' : 'DELETE FROM account_sessions WHERE token_hash=?';
        await env.DB.prepare(sql).bind(tokenHash).run();
        return reply({ok:true});
      }
      if (path === '/blind/cases' && request.method === 'GET') return reply(await caseList(env.DB,user));
      const route = casePath.exec(path);
      if (route) {
        const [, id, action] = route;
        const item = await authorizedCase(env.DB,user,id);
        if (!action && request.method === 'GET') return reply(await caseDetails(env.DB,user,item));
        if (action === 'image' && ['GET','HEAD'].includes(request.method)) {
          return await imageResponse(request,env,item,headers);
        }
        if (action === 'ratings' && request.method === 'POST') {
          requireRole(user,'doctor');
          if(isStudyACase(id))throw new HttpError(409,'Study A now uses an individual report review. Reload your workspace.');
          await saveRatings(env.DB,user.username,id,await jsonBody(request));
          return reply({ok:true});
        }
        if (action==='study-a-review' && request.method==='PUT' && isStudyACase(id)){
          requireRole(user,'doctor');
          return reply(await saveStudyAReview(env.DB,id,user,await jsonBody(request),digest));
        }
      }
      if (path.startsWith('/admin/')) {
        requireRole(user,'admin');
        if(path==='/admin/study-a-results' && request.method==='GET'){
          const roster=await readerRoster(env.DB,digest,displayReaderName);
          return reply(await studyAResults(env.DB,roster));
        }
        if (path==='/admin/public-studies' && request.method==='GET') return reply(await listReaderStudies(env.DB,true));
        if (path==='/admin/public-studies' && request.method==='POST') return reply(await setReaderAccess(env.DB,await jsonBody(request,4096)));
        const imageList=/^\/admin\/public-studies\/([A-Za-z0-9_-]+)\/images$/.exec(path);
        if (imageList && request.method==='GET') return reply(await publicStudyImages(env.DB,imageList[1]));
        if (path==='/admin/storage' && request.method==='GET') return reply({ready:Boolean(env.IMAGES)});
        if ((path==='/admin/batches'||path.startsWith('/admin/batches/')) && request.method!=='GET' && !env.IMAGES) {
          throw new HttpError(503,'Activate private CT storage before uploading or publishing.');
        }
        const managed = await manageReaders(path,request,env.DB,{jsonBody,passwordHash,digest,HttpError});
        if (managed) return reply(managed,path==='/admin/doctors' ? 201 : 200);
        const study = await adminStudy(path,request,env,jsonBody);
        if (study) return reply(study);
        if (path === '/admin/results' && request.method === 'GET') {
          const {results} = await env.DB.prepare('SELECT a.case_id,a.username,r.display_name,a.letter,a.model_name,a.rating,a.comment,a.updated_at '+
            'FROM assignments a LEFT JOIN public_readers r USING(username) ORDER BY a.case_id,a.username,a.letter').all();
          const readers=await readerRoster(env.DB,digest,displayReaderName);
          return reply({readers,results:results.map(r=>({...r,display_name:displayReaderName(r.display_name,r.username),comment:displayComment(r.comment)}))});
        }
      }
      if (path === '/reviews' || path.startsWith('/reviews/')) {
        requireRole(user,'admin');
        if (path !== '/reviews' || request.method !== 'GET') throw new HttpError(405,'Historical reviews are read-only.');
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400,'Invalid cursor');
        const {results} = await env.DB.prepare('SELECT * FROM reviews WHERE id>? ORDER BY id LIMIT 500').bind(after).all();
        return reply({reviews:results.map(r => ({...r,reviewer:hasHan(r.reviewer)?'Legacy reader':r.reviewer,
          comment:displayComment(r.comment),case_id:hasHan(r.case_id)?'Case '+r.release_id:r.case_id,
          model_name:hasHan(r.model_name)?'Model':r.model_name,report_id:hasHan(r.report_id)?'Report':r.report_id,
          schema:'ct-review-v1',github_issue_number:1000000000000+r.id,url:''})),
          next:results.length === 500 ? results.at(-1).id : null});
      }
      throw new HttpError(404,'Not found');
    } catch (error) {
      return error instanceof HttpError || error instanceof StudyError ? reply({error:error.message},error.status)
        : reply({error:'Service temporarily unavailable. Please retry.'},503);
    }
  },
  async scheduled(event, env) {
    const now = Math.floor(Date.now()/1000);
    await env.DB.batch([env.DB.prepare('DELETE FROM account_sessions WHERE expires<?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),env.DB.prepare('DELETE FROM login_attempts'),
      env.DB.prepare('DELETE FROM accounts WHERE username IN (SELECT r.username FROM public_readers r WHERE (r.closed=1 OR r.expires<?) '+
        'AND NOT EXISTS(SELECT 1 FROM assignments a WHERE a.username=r.username AND a.rating IS NOT NULL) '+
        'AND NOT EXISTS(SELECT 1 FROM study_a_reviews s WHERE s.username=r.username) LIMIT 100)').bind(now)]);
  }
};

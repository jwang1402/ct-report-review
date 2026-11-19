import {adminStudy,driveImage,StudyError} from './admin-study.mjs';
import {manageReaders} from './admin-doctor.mjs';
const origins = new Set(['https://jwang1402.github.io', 'http://127.0.0.1:5173', 'http://localhost:5173']);
const encoder = new TextEncoder();
const casePath = /^\/blind\/cases\/([A-Za-z0-9_-]{1,100})(?:\/(ratings|image))?$/;
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
  const user = await db.prepare(
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
  return {cases: results.map(row => ({...row, scored: Boolean(row.scored)}))};
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
  const query = doctor
    ? db.prepare("SELECT a.letter,r.report_text AS text,a.rating,a.comment,COALESCE(v.revision,'initial') AS revision " +
        'FROM assignments a JOIN private_reports r USING(case_id,model_name) LEFT JOIN web_case_versions v ON v.case_id=a.case_id ' +
        'WHERE a.username=? AND a.case_id=? ORDER BY a.letter').bind(user.username, row.case_id)
    : db.prepare('SELECT model_name,report_text AS text FROM private_reports WHERE case_id=? ORDER BY model_name')
      .bind(row.case_id);
  const {results} = await query.all();
  return {
    case_id: row.case_id, case_name: doctor ? row.case_id : row.case_name,
    imaging: {type: 'NIFTI', filename: row.case_id + (row.image_filename.endsWith('.gz') ? '.nii.gz' : '.nii'), size: row.image_size,
      ...driveImage(row.image_key)},
    reports: doctor ? results.map(({revision,...report})=>report) : results,
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
        || typeof entry.comment !== 'string' || entry.comment.length > 10000) {
      throw new HttpError(400, 'Each report needs a unique letter and a score from 1 to 5.');
    }
    byLetter.set(entry.letter,entry);
  }
  const stamp = new Date().toISOString();
  // One transaction for the four reports. A retry with unchanged data preserves its timestamp.
  const writes=letters.map(letter => {
    const entry = byLetter.get(letter);
    return db.prepare('UPDATE assignments SET rating=?,comment=?,updated_at=? ' +
      "WHERE username=? AND case_id=? AND letter=? AND (rating IS NOT ? OR comment<>?) " +
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

async function imageResponse(request, bucket, row, headers) {
  if (driveImage(row.image_key)) throw new HttpError(409,'Open the authorized Google Drive link to download this image.');
  if (!bucket) throw new HttpError(503, 'Private image storage is unavailable.');
  const output = new Headers(headers);
  output.set('Content-Type', 'application/octet-stream');
  output.set('Accept-Ranges','bytes');
  let range;
  try { range = byteRange(request.headers.get('Range'),row.image_size); }
  catch {
    output.set('Content-Range','bytes */' + row.image_size);
    return new Response(null,{status:416,headers:output});
  }
  const head = request.method === 'HEAD';
  const obj = head ? await bucket.head(row.image_key)
    : await bucket.get(row.image_key,range ? {range} : {});
  if (!obj || obj.size !== row.image_size) throw new HttpError(503,'Case image is unavailable or incomplete.');
  output.set('Content-Length',String(range?.length ?? row.image_size));
  if (range) output.set('Content-Range','bytes ' + range.offset + '-' + (range.offset + range.length - 1) + '/' + row.image_size);
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
      ...headers,'Access-Control-Allow-Methods':'GET, HEAD, POST, PUT, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, Range'
    }});
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const now = Math.floor(Date.now()/1000);
      if (path === '/health' && request.method === 'GET') return reply({ok:true});
      if (path === '/login' && request.method === 'POST') return reply(await login(request,env.DB,now));
      const {user,tokenHash} = await sessionFor(request,env.DB,now);
      if (path === '/session' && request.method === 'GET') return reply(user);
      if (path === '/logout' && request.method === 'POST') {
        await env.DB.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(tokenHash).run();
        return reply({ok:true});
      }
      if (path === '/blind/cases' && request.method === 'GET') return reply(await caseList(env.DB,user));
      const route = casePath.exec(path);
      if (route) {
        const [, id, action] = route;
        const item = await authorizedCase(env.DB,user,id);
        if (!action && request.method === 'GET') return reply(await caseDetails(env.DB,user,item));
        if (action === 'image' && ['GET','HEAD'].includes(request.method)) {
          return await imageResponse(request,env.IMAGES,item,headers);
        }
        if (action === 'ratings' && request.method === 'POST') {
          requireRole(user,'doctor');
          await saveRatings(env.DB,user.username,id,await jsonBody(request));
          return reply({ok:true});
        }
      }
      if (path.startsWith('/admin/')) {
        requireRole(user,'admin');
        if (path==='/admin/storage' && request.method==='GET') return reply({ready:Boolean(env.IMAGES)});
        if ((path==='/admin/batches'||path.startsWith('/admin/batches/')) && request.method!=='GET' && !env.IMAGES) {
          throw new HttpError(503,'Activate private CT storage before uploading or publishing.');
        }
        const managed = await manageReaders(path,request,env.DB,{jsonBody,passwordHash,HttpError});
        if (managed) return reply(managed,path==='/admin/doctors' ? 201 : 200);
        const study = await adminStudy(path,request,env,jsonBody);
        if (study) return reply(study);
        if (path === '/admin/results' && request.method === 'GET') {
          const {results} = await env.DB.prepare('SELECT case_id,username,letter,model_name,rating,comment,updated_at FROM assignments ORDER BY case_id,username,letter').all();
          return reply({results});
        }
      }
      if (path === '/reviews' || path.startsWith('/reviews/')) {
        requireRole(user,'admin');
        if (path !== '/reviews' || request.method !== 'GET') throw new HttpError(405,'Historical reviews are read-only.');
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400,'Invalid cursor');
        const {results} = await env.DB.prepare('SELECT * FROM reviews WHERE id>? ORDER BY id LIMIT 500').bind(after).all();
        return reply({reviews:results.map(r => ({...r,schema:'ct-review-v1',github_issue_number:1000000000000+r.id,url:''})),
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
      env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),env.DB.prepare('DELETE FROM login_attempts')]);
  }
};

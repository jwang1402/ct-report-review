const origins = new Set(['https://jwang1402.github.io','http://127.0.0.1:5173']);
const site='https://jwang1402.github.io/ct-report-review/';
const enc=new TextEncoder();
export const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return Array.from(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:100000,hash:'SHA-256'},key,256)),b=>b.toString(16).padStart(2,'0')).join('');}
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;};
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
async function body(request){if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'JSON required');const text=await request.text();if(text.length>1200000)throw new HttpError(413,'Request too large');try{return JSON.parse(text);}catch{throw new HttpError(400,'Invalid JSON');}}
export function validateReview(r){if(!r||r.schema!=='ct-review-v1'||!Number.isSafeInteger(r.release_id)||r.release_id<=0||!['1','2','3','4','5'].includes(r.decision)||!['case_id','report_id','model_name','reviewer','comment','submission_id'].every(k=>typeof r[k]==='string')||!r.reviewer.trim()||r.reviewer.trim().length>100||r.comment.length>10000||!r.model_name.trim()||r.model_name.length>200||!/^[-\w]{1,100}$/.test(r.case_id)||!/^[-\w]{1,100}$/.test(r.report_id)||!/^[-\w]{16,100}$/.test(r.submission_id))throw new HttpError(400,'Enter your name and a findings quality rating from 1 to 5.');return {...r,reviewer:r.reviewer.trim()};}
const asReview=r=>({...r,schema:'ct-review-v1',github_issue_number:1000000000000+r.id,url:''});
async function knownReport(r){const responses=await Promise.all(['data/index.json','drive-cases/index.json','removed-cases.json'].map(p=>fetch(site+p,{cache:'no-store'})));if(responses.some(r=>!r.ok))throw new HttpError(503,'Case catalog is unavailable. Please retry.');const [pages,drive,removed]=await Promise.all(responses.map(r=>r.json()));const c=[...pages.cases,...drive.cases].find(c=>c.case_id===r.case_id&&(c.release_id||c.review_id)===r.release_id);if(!c||removed.cases.some(c=>c.case_id===r.case_id&&c.release_id===r.release_id)||!c.reports.some(p=>p.id===r.report_id&&p.model_name===r.model_name))throw new HttpError(400,'Case or report is no longer available. Refresh cases.');return c;}
export default {async fetch(request,env){
 const origin=request.headers.get('Origin');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if(origin&&origins.has(origin))headers['Access-Control-Allow-Origin']=origin;
 const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&!origins.has(origin))return reply({error:'Origin not allowed'},403);
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
 try{
  const path=new URL(request.url).pathname,now=Math.floor(Date.now()/1000);
  if(path==='/health'&&request.method==='GET')return reply({ok:true});
  if(path==='/login'&&request.method==='POST'){
   if(!env.PASSWORD_HASH||!env.PASSWORD_SALT)throw new HttpError(503,'Login is not configured.');
   const r=await body(request);if(typeof r.username!=='string'||typeof r.password!=='string'||r.password.length>200)throw new HttpError(400,'Invalid credentials');
   const bucket=await digest((request.headers.get('CF-Connecting-IP')||'local')+':'+Math.floor(now/600));
   const attempt=await env.DB.prepare('INSERT INTO login_attempts(bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket).first();
   if(attempt.count>10)throw new HttpError(429,'Too many attempts. Wait 10 minutes and try again.');
   const hash=await passwordHash(r.password,env.PASSWORD_SALT);
   if(r.username!==(env.LOGIN_USERNAME||'ctreport')||!equal(hash,env.PASSWORD_HASH))throw new HttpError(401,'Incorrect username or password.');
   const token=crypto.randomUUID()+crypto.randomUUID(),expires=now+12*3600;
   await env.DB.prepare('INSERT INTO sessions(token_hash,expires) VALUES (?,?)').bind(await digest(token),expires).run();
   return reply({token,expires});
  }
  const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
  if(!token||token.length>200)throw new HttpError(401,'Please sign in.');
  const hash=await digest(token),session=await env.DB.prepare('SELECT expires FROM sessions WHERE token_hash=? AND expires>?').bind(hash,now).first();
  if(!session)throw new HttpError(401,'Your session expired. Please sign in again.');
  if(path==='/session'&&request.method==='GET')return reply({username:env.LOGIN_USERNAME||'ctreport',expires:session.expires});
  if(path==='/logout'&&request.method==='POST'){await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();return reply({ok:true});}
  if(path==='/reviews'&&request.method==='GET'){
   const after=Number(new URL(request.url).searchParams.get('after')||0);if(!Number.isSafeInteger(after)||after<0)throw new HttpError(400,'Invalid cursor');
   const {results}=await env.DB.prepare('SELECT * FROM reviews WHERE id>? ORDER BY id LIMIT 500').bind(after).all();return reply({reviews:results.map(asReview),next:results.length===500?results.at(-1).id:null});
  }
  if(/^\/reviews\/[-\w]{16,100}\/update$/.test(path)&&request.method==='POST'){
   const r=validateReview(await body(request));
   if(r.submission_id!==path.split('/')[2])throw new HttpError(400,'Submission ID mismatch');
   const original=await env.DB.prepare('SELECT * FROM reviews WHERE submission_id=?').bind(r.submission_id).first();
   if(!original)throw new HttpError(404,'Review not found');
   if(['case_id','release_id','report_id','model_name'].some(k=>r[k]!==original[k]))throw new HttpError(400,'Cannot move a review to another report');
   if(['reviewer','decision','comment'].every(k=>r[k]===original[k]))return reply({review:asReview(original)});
   if(!r.previous||!['reviewer','decision','comment'].every(k=>typeof r.previous[k]==='string'))throw new HttpError(400,'Previous review is required');
   const saved=await env.DB.prepare('UPDATE reviews SET reviewer=?,decision=?,comment=? WHERE submission_id=? AND reviewer=? AND decision=? AND comment=? RETURNING *').bind(r.reviewer,r.decision,r.comment,r.submission_id,r.previous.reviewer,r.previous.decision,r.previous.comment).first();
   if(!saved)throw new HttpError(409,'This review was changed elsewhere. Cancel, refresh, and edit the latest result.');
   return reply({review:asReview(saved)});
  }
  if(/^\/reviews\/[-\w]{16,100}\/delete$/.test(path)&&request.method==='POST'){
   const id=path.split('/')[2],r=await body(request);
   if(!r.previous||!['reviewer','decision','comment'].every(k=>typeof r.previous[k]==='string'))throw new HttpError(400,'Previous review is required');
   const existing=await env.DB.prepare('SELECT * FROM reviews WHERE submission_id=?').bind(id).first();
   if(!existing)return reply({ok:true});
   const deleted=await env.DB.prepare('DELETE FROM reviews WHERE submission_id=? AND reviewer=? AND decision=? AND comment=? RETURNING submission_id').bind(id,r.previous.reviewer,r.previous.decision,r.previous.comment).first();
   if(!deleted)throw new HttpError(409,'This review changed elsewhere. Refresh before deleting.');
   return reply({ok:true});
  }
  if(path==='/reviews/batch'&&request.method==='POST'){
   const payload=await body(request);if(!Array.isArray(payload.reviews)||!payload.reviews.length||payload.reviews.length>100)throw new HttpError(400,'Invalid review batch');
   const rows=payload.reviews.map(validateReview),first=rows[0],c=await knownReport(first);
   if(new Set(rows.map(r=>r.submission_id)).size!==rows.length||new Set(rows.map(r=>r.report_id)).size!==rows.length||rows.some(r=>r.reviewer!==first.reviewer||r.case_id!==first.case_id||r.release_id!==first.release_id||!c.reports.some(p=>p.id===r.report_id&&p.model_name===r.model_name)))throw new HttpError(400,'Invalid report selection');
   const existing=(await env.DB.prepare('SELECT * FROM reviews WHERE case_id=? AND release_id=?').bind(first.case_id,first.release_id).all()).results;
   if(c.reports.some(p=>!rows.some(r=>r.report_id===p.id)&&!existing.some(r=>r.report_id===p.id&&r.reviewer===first.reviewer)))throw new HttpError(400,'Rate every report before submitting this case.');
   for(const r of rows){const old=await env.DB.prepare('SELECT * FROM reviews WHERE submission_id=?').bind(r.submission_id).first();if(old&&['case_id','release_id','report_id','model_name','reviewer','decision','comment'].some(k=>old[k]!==r[k]))throw new HttpError(409,'Submission already exists with different content');}
   await env.DB.batch(rows.map(r=>env.DB.prepare('INSERT INTO reviews(submission_id,case_id,release_id,report_id,model_name,reviewer,decision,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO NOTHING').bind(r.submission_id,r.case_id,r.release_id,r.report_id,r.model_name,r.reviewer,r.decision,r.comment,new Date().toISOString())));
   const saved=await Promise.all(rows.map(r=>env.DB.prepare('SELECT * FROM reviews WHERE submission_id=?').bind(r.submission_id).first()));return reply({reviews:saved.map(asReview)},201);
  }
  if(path==='/reviews'&&request.method==='POST'){
   const r=validateReview(await body(request));const c=await knownReport(r);
   if(c.reports.length>1)throw new HttpError(400,'Use case submission after rating every report.');
   await env.DB.prepare('INSERT INTO reviews(submission_id,case_id,release_id,report_id,model_name,reviewer,decision,comment,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(submission_id) DO NOTHING').bind(r.submission_id,r.case_id,r.release_id,r.report_id,r.model_name,r.reviewer,r.decision,r.comment,new Date().toISOString()).run();
   const saved=await env.DB.prepare('SELECT * FROM reviews WHERE submission_id=?').bind(r.submission_id).first();
   if(['case_id','release_id','report_id','model_name','reviewer','decision','comment'].some(k=>saved[k]!==r[k]))throw new HttpError(409,'This submission ID already has different content. Edit the review and retry.');
   return reply({review:asReview(saved)},201);
  }
  throw new HttpError(404,'Not found');
 }catch(e){return reply({error:e instanceof HttpError?e.message:'Service temporarily unavailable. Please retry.'},e instanceof HttpError?e.status:503);}
},async scheduled(event,env){await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(Math.floor(Date.now()/1000)),env.DB.prepare('DELETE FROM login_attempts')]);}};

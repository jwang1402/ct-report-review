import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{passwordHash} from './worker.mjs';
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));return {prepare(sql){const statement=db.prepare(sql);let args=[];return {bind(...a){args=a;return this;},async first(){return statement.get(...args)||null;},async all(){return {results:statement.all(...args)};},async run(){return statement.run(...args);}};},async batch(a){return Promise.all(a.map(x=>x.run()));}};}
const env={DB:database(),LOGIN_USERNAME:'admin',PASSWORD_SALT:'unit-test-salt',PASSWORD_HASH:await passwordHash('test-password','unit-test-salt')};
const call=(path,data,token,origin='https://jwang1402.github.io')=>worker.fetch(new Request('https://test.invalid'+path,{method:data?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
let token;
test('unauthenticated and forged sessions cannot read or write reviews',async()=>{assert.equal((await call('/reviews')).status,401);assert.equal((await call('/reviews',{},'fake')).status,401);assert.equal((await call('/session',null,'fake')).status,401);});
test('wrong password fails; correct password creates a server session',async()=>{assert.equal((await call('/login',{username:'admin',password:'wrong'})).status,401);const r=await call('/login',{username:'admin',password:'test-password'});assert.equal(r.status,200);token=(await r.json()).token;assert.equal((await call('/session',null,token)).status,200);});
test('CORS only allows configured websites',async()=>{assert.equal((await call('/session',null,token,'https://attacker.invalid')).status,403);});
test('name and partial acceptance comment are required',async()=>{assert.equal((await call('/reviews',{schema:'ct-review-v1'},token)).status,400);});
test('reviews persist and retry does not create duplicate submissions',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>Response.json(String(url).endsWith('removed-cases.json')?{cases:[]}:{cases:[{case_id:'sample',review_id:1,reports:[{id:'report',model_name:'Model'}]}]});
 try{const data={schema:'ct-review-v1',case_id:'sample',release_id:1,report_id:'report',model_name:'Model',reviewer:'Doctor Test',decision:'ACCEPT',comment:'Test only',submission_id:crypto.randomUUID()};assert.equal((await call('/reviews',data,token)).status,201);assert.equal((await call('/reviews',data,token)).status,201);const saved=await (await call('/reviews',null,token)).json();assert.equal(saved.reviews.length,1);assert.equal(saved.reviews[0].reviewer,'Doctor Test');assert.equal((await call('/reviews',{...data,comment:'Changed'},token)).status,409);}finally{globalThis.fetch=original;}
});
test('editing updates one record and rejects stale or unauthenticated changes',async()=>{
 const original=(await(await call('/reviews',null,token)).json()).reviews[0];
 const updated={...original,decision:'PARTIAL_ACCEPT',comment:'Revised feedback',previous:{reviewer:original.reviewer,decision:original.decision,comment:original.comment}};
 const path='/reviews/'+original.submission_id+'/update';
 assert.equal((await call(path,updated)).status,401);
 assert.equal((await call(path,{...updated,comment:''},token)).status,400);
 assert.equal((await call(path,updated,token)).status,200);
 assert.equal((await call(path,updated,token)).status,200);
 assert.equal((await call(path,{...updated,comment:'Stale overwrite'},token)).status,409);
 const rows=(await(await call('/reviews',null,token)).json()).reviews;
 assert.equal(rows.length,1);assert.equal(rows[0].decision,'PARTIAL_ACCEPT');assert.equal(rows[0].submission_id,original.submission_id);assert.equal(rows[0].created_at,original.created_at);
});
test('multi-report submissions require every report and preserve retry identity',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>Response.json(String(url).endsWith('removed-cases.json')?{cases:[]}:{cases:[{case_id:'multi',review_id:2,reports:[{id:'a',model_name:'A'},{id:'b',model_name:'B'}]}]});
 try{
 const a={schema:'ct-review-v1',case_id:'multi',release_id:2,report_id:'a',model_name:'A',reviewer:'Doctor',decision:'ACCEPT',comment:'',submission_id:crypto.randomUUID()},b={...a,report_id:'b',model_name:'B',submission_id:crypto.randomUUID()};
 assert.equal((await call('/reviews',a,token)).status,400);
 assert.equal((await call('/reviews/batch',{reviews:[a]},token)).status,400);
 assert.equal((await call('/reviews/batch',{reviews:[a,{...b,decision:'PARTIAL_ACCEPT'}]},token)).status,400);
 assert.equal((await call('/reviews/batch',{reviews:[a,a]},token)).status,400);
 assert.equal((await(await call('/reviews',null,token)).json()).reviews.filter(r=>r.case_id==='multi').length,0);
 assert.equal((await call('/reviews/batch',{reviews:[a,b]},token)).status,201);
 assert.equal((await call('/reviews/batch',{reviews:[a,b]},token)).status,201);
 assert.equal((await(await call('/reviews',null,token)).json()).reviews.filter(r=>r.case_id==='multi').length,2);
 }finally{globalThis.fetch=original;}
});
test('logout revokes the session at the server',async()=>{assert.equal((await call('/logout',{},token)).status,200);assert.equal((await call('/session',null,token)).status,401);});


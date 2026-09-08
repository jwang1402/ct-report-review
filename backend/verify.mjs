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
test('logout revokes the session at the server',async()=>{assert.equal((await call('/logout',{},token)).status,200);assert.equal((await call('/session',null,token)).status,401);});

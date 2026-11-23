import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{digest,passwordHash} from './worker.mjs';

test('reader sign-in resumes by cohort and name, then by browser, while preserving existing records and individual sessions',async t=>{
  const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
  sql.exec('PRAGMA foreign_keys=ON');sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  function stmt(s,args=[]){return {bind:(...a)=>stmt(s,a),first:()=>sql.prepare(s).get(...args),all:()=>({results:sql.prepare(s).all(...args)}),run:()=>sql.prepare(s).run(...args)};}
  const env={DB:{prepare:stmt,batch:async ss=>{sql.exec('BEGIN');try{const out=ss.map(s=>s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
  const call=(path,token,body)=>worker.fetch(new Request('https://test.invalid'+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),env);
  const key=()=>crypto.randomUUID()+crypto.randomUUID();
  const path='/public/crossover-readers',adminPath='/admin/crossover-access';
  const first={cohort:'junior',entry_key:key(),name:'Reader One'};
  const enter=async body=>{
    const res=await call(path,null,body);assert.equal(res.status,200);
    const data=await res.json();assert.ok(data.token);assert.ok(!('username' in data));assert.ok(!('request_code' in data));
    return data;
  };
  const identity=async token=>sql.prepare('SELECT username,name_confirmed_at FROM crossover_sessions WHERE token_hash=?').get(await digest(token));
  const res=await enter(first);
  const original=(await identity(res.token)).username;
  sql.prepare('INSERT INTO study_b_readers(username,cohort,slot) VALUES(?,?,?)').run(original,'junior',1);
  sql.prepare('INSERT INTO study_b_readings(username,case_id,period,arm,started_at,submitted_at,report) VALUES(?,?,?,?,?,?,?)')
    .run(original,'B01',1,'without_ai',1,2,'Saved reading');
  assert.equal((await call('/blind/cases',res.token)).status,403);
  assert.equal((await call(adminPath,res.token)).status,403);
  assert.equal((await call('/session',res.token)).status,200);
  assert.equal((await call('/logout',res.token,{})).status,200);
  assert.equal((await call('/session',res.token)).status,401);
  const device={...first,entry_key:key()};
  // A browser which previously showed a link code can use the same entry without administrator action.
  sql.prepare('INSERT INTO crossover_requests VALUES(?,?,?,?,?)').run(crypto.randomUUID(),await digest('crossover-device:'+device.entry_key),'junior',first.name,2);
  const second=await enter({...device,name:'  reader  ONE ',returning:true});
  assert.equal(second.display_name,first.name);
  assert.equal((await identity(second.token)).username,original);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM crossover_requests').get().n,0);
  const typo=await enter({...device,name:'Readr One'});
  assert.equal(typo.display_name,first.name);
  assert.equal((await identity(typo.token)).username,original);
  assert.ok((await identity(typo.token)).name_confirmed_at>2);
  assert.equal(sql.prepare('SELECT report FROM study_b_readings WHERE username=?').get((await identity(typo.token)).username).report,'Saved reading');
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM crossover_readers').get().n,1);
  const other=await enter({...first,entry_key:key(),name:'Reader Two'});
  const two=(await identity(other.token)).username;
  assert.notEqual(two,original);
  // Switching by a known name takes precedence over the browser fallback, without changing past sessions.
  const switched=await enter({...device,name:'Reader Two'});
  assert.equal((await identity(switched.token)).username,two);
  assert.equal((await identity(second.token)).username,original);
  assert.equal((await identity((await enter({...device,name:'Reader Tqo'})).token)).username,two);
  assert.equal((await identity((await enter({...first,name:'Reader Oen'})).token)).username,original);
  assert.equal((await call(path,null,{...first,cohort:'senior'})).status,403);
  const senior=await enter({...first,cohort:'senior',entry_key:key()});
  assert.equal(senior.cohort,'senior');
  assert.notEqual((await identity(senior.token)).username,original);
  assert.equal((await call(path,null,{...device,cohort:'senior',name:first.name})).status,403);
  const parallel=await Promise.all([key(),key()].map(entry_key=>enter({...first,entry_key,name:'Reader Three'})));
  assert.equal((await identity(parallel[0].token)).username,(await identity(parallel[1].token)).username);
  const twoNames=await Promise.all([first.name,'Reader Two'].map(name=>enter({...device,name})));
  assert.deepEqual(await Promise.all(twoNames.map(async r=>(await identity(r.token)).username)),[original,two]);
  assert.equal(sql.prepare('SELECT count(*) n FROM accounts').get().n,4);
  assert.equal(sql.prepare('SELECT count(*) n FROM crossover_readers').get().n,4);
  const salt=crypto.randomUUID(),password='private-test-pwd-123';
  sql.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('coordinator','admin',salt,await passwordHash(password,salt));
  const admin=(await (await call('/login',null,{username:'coordinator',password})).json()).token;
  const {pending,readers}=await (await call(adminPath,admin)).json();
  assert.deepEqual(pending,[]);
  const r=readers.find(row=>row.username===original);
  assert.equal((await call(adminPath,admin,{action:'rename',username:r.username,name:'Revised Name'})).status,200);
  assert.equal((await (await call('/session',second.token)).json()).display_name,'Revised Name');
  const patched=await enter({...first,entry_key:key(),name:'Revised Name'});
  assert.equal((await identity(patched.token)).username,original);
});

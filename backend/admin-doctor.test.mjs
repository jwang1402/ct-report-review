import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker, {passwordHash} from './worker.mjs';

test('administrator creates individual reader logins and assigns a released study without changing earlier scores', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  function statement(sql,args=[]) {
    return {bind:(...a)=>statement(sql,a),first:()=>sqlite.prepare(sql).get(...args)??null,
      all:()=>({results:sqlite.prepare(sql).all(...args)}),run:()=>sqlite.prepare(sql).run(...args)};
  }
  const env={DB:{prepare:statement}};
  const role='admin', salt=crypto.randomUUID(), pwd='synthetic-test-password';
  sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run('coord',role,salt,await passwordHash(pwd,salt));
  const call=(path,token,body)=>worker.fetch(new Request('https://fixture.invalid'+path,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json', ...(token&&{Authorization:'Bearer '+token})},
    body:body?JSON.stringify(body):undefined
  }),env);
  const signIn=async username=>(await (await call('/login',null,{username,password:pwd})).json()).token;
  const admin=await signIn('coord');
  const details={username:'dr1',password:pwd};
  assert.equal((await call('/admin/doctors',admin,details)).status,201);
  assert.equal((await call('/admin/doctors',admin,details)).status,409);
  const reader=await signIn('dr1');
  assert.equal((await call('/admin/doctors',reader,{...details,username:'dr2'})).status,403);
  assert.equal((await call('/admin/enrollment/studies',reader)).status,403);
  assert.deepEqual(await (await call('/admin/doctors',admin)).json(),{doctors:['dr1']});
  sqlite.prepare('INSERT INTO private_cases VALUES(?,?,?,?,?)').run('Demo-Case01','Case01','blind/Demo/Case01/hash.nii.gz','Case01.nii.gz',15);
  for(const letter of 'ABCD') {
    sqlite.prepare('INSERT INTO private_reports VALUES(?,?,?)').run('Demo-Case01','model-'+letter,'Example');
    sqlite.prepare('INSERT INTO shared_case_letters VALUES(?,?,?,?)').run('Demo-Case01',letter,'model-'+letter,1);
  }
  assert.deepEqual(await (await call('/admin/enrollment/studies',admin)).json(),{studies:[{prefix:'Demo',case_count:1}]});
  const enrollment={prefix:'Demo',username:'dr1'};
  assert.equal((await call('/admin/enrollment',admin,enrollment)).status,200);
  sqlite.exec("UPDATE assignments SET rating=5,comment='already scored' WHERE username='dr1'");
  await call('/admin/enrollment',admin,enrollment);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM assignments WHERE rating=5 AND comment='already scored'").get().n,4);
  assert.equal((await call('/admin/enrollment',reader,enrollment)).status,403);
  assert.equal((await call('/admin/enrollment',admin,{prefix:'Demo',username:'coord'})).status,404);
});

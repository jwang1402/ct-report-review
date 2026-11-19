import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import worker, {digest,passwordHash} from './worker.mjs';

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

test('an admin can delete a single named or public reader, including one without assignments',async t=>{
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  db.exec(readFileSync(new URL('./migrations/0006_preserve_rated_cases.sql',import.meta.url),'utf8'));
  function stmt(sql,args=[]){
    return {bind:(...values)=>stmt(sql,values),first:()=>db.prepare(sql).get(...args)??null,
      all:()=>({results:db.prepare(sql).all(...args)}),run:()=>db.prepare(sql).run(...args)};
  }
  const env={DB:{prepare:stmt}};
  const expires=Math.floor(Date.now()/1000)+1000;
  const guest='reader:'+ 'a'.repeat(32);
  for(const [username,role] of [['coordinator','admin'],['named','doctor'],['unassigned','doctor'],[guest,'doctor']]){
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(username,role,'salt-'+username,'synthetic');
  }
  for(const [token,username,role] of [['admin-token','coordinator','admin'],['named-token','named','doctor']]){
    db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').run(await digest(token),username,role,'synthetic',expires);
  }
  db.exec("INSERT INTO web_batches VALUES('batch','Study','{}','published'); INSERT INTO public_studies VALUES('Study',1);");
  db.prepare("INSERT INTO public_readers(username,prefix,display_name,token_hash,expires) VALUES(?,'Study','Example',?,?)")
    .run(guest,await digest('reader.test'),expires);
  db.exec("INSERT INTO private_cases VALUES('C1','C1','blind/Study/C1/example','C1.nii.gz',64);");
  for(const l of 'ABCD'){
    db.prepare("INSERT INTO private_reports VALUES('C1',?,'Report')").run('model-'+l);
    db.prepare("INSERT INTO shared_case_letters VALUES('C1',?,?,1)").run(l,'model-'+l);
    for(const user of [guest,'named'])db.prepare("INSERT INTO assignments(username,case_id,letter,model_name,case_order,rating) VALUES(?,'C1',?,?,1,?)")
      .run(user,l,'model-'+l,user===guest?5:null);
  }
  const call=(path,token,version)=>worker.fetch(new Request('https://fixture.invalid'+path,{
    method:version===undefined?'GET':'DELETE',headers:{'Content-Type':'application/json',...(token&&{Authorization:'Bearer '+token})},
    ...(version!==undefined&&{body:JSON.stringify({version})})
  }),env);
  const roster=async()=>(await(await call('/admin/results','admin-token')).json()).readers;
  const readers=await roster();
  assert.equal(readers.length,3);
  const version=id=>readers.find(r=>r.username===id).version;
  const remove=(id,token,rev)=>call('/admin/doctors/'+encodeURIComponent(id),token,rev);
  assert.equal((await remove('coordinator','admin-token',version('named'))).status,404);
  assert.equal((await remove(guest,'named-token',version(guest))).status,403);
  assert.equal((await remove('named',null,version('named'))).status,401);
  assert.equal((await remove('named','admin-token','0'.repeat(64))).status,409);
  assert.equal((await call('/session','reader.test')).status,200);
  assert.equal((await remove(guest,'admin-token',version(guest))).status,200);
  assert.equal((await call('/session','reader.test')).status,401);
  assert.equal((await remove(guest,'admin-token',version(guest))).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM public_readers').get().n,0);
  let output=await(await call('/admin/results','admin-token')).json();
  assert.deepEqual(output.results.map(r=>r.username),Array(4).fill('named'));
  assert.equal(output.results.every(r=>r.rating===null),true);
  const editor=await(await call('/admin/cases/C1/editor','admin-token')).json();
  assert.equal(editor.reports.length,4);
  assert.equal(editor.locked,true);
  assert.equal((await remove('named','admin-token',version('named'))).status,200);
  assert.equal((await call('/session','named-token')).status,401);
  output=await(await call('/admin/results','admin-token')).json();
  assert.deepEqual(output.results,[]);
  assert.deepEqual(output.readers.map(r=>r.username),['unassigned']);
  assert.equal((await remove('unassigned','admin-token',version('unassigned'))).status,200);
  assert.deepEqual(await roster(),[]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM private_cases').get().n,1);
});

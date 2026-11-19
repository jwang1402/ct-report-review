import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{digest,passwordHash} from './worker.mjs';

const sqlFile = name => readFileSync(new URL(name,import.meta.url),'utf8');
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(sqlFile('./schema.sql'));
  const DB = {
    prepare(sql) {
      const stmt=db.prepare(sql);
      let args=[];
      return {bind(...a){args=a;return this;},async first(){return stmt.get(...args)||null;},
        async all(){return {results:stmt.all(...args)};},async run(){return stmt.run(...args);}};
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const results = await Promise.all(statements.map(statement => statement.run()));
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return {db,env:{DB}};
}
function call(env,path,data,token,origin='https://jwang1402.github.io') {
  return worker.fetch(new Request('https://example.test'+path,{method:data?'POST':'GET',
    headers:{Origin:origin,'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},
    ...(data?{body:JSON.stringify(data)}:{})}),env);
}

test('historic records survive the migrations, including free-text reviewer and legacy decisions',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(sqlFile('./schema.sql').split('-- Existing shared sessions')[0].replace("'1','2','3','4','5',",''));
  db.exec("INSERT INTO reviews VALUES (7,'legacy-submission','sample',1,'report','Model','Prior reviewer','ACCEPT','','2026-09-01')");
  db.exec(sqlFile('./migrations/0001_findings_rating.sql'));
  db.exec(sqlFile('./migrations/0002_private_reader_study.sql'));
  db.exec(sqlFile('./migrations/0003_shared_case_letters.sql'));
  assert.deepEqual({...db.prepare('SELECT id,reviewer,decision FROM reviews').get()},{id:7,reviewer:'Prior reviewer',decision:'ACCEPT'});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,0);
  db.close();
});

test('migration does not give old sessions or the shared password access to the private study',async()=>{
  const {db,env}=fixture();
  const salt='test-legacy-salt';
  Object.assign(env,{LOGIN_USERNAME:'shared',PASSWORD_SALT:salt,PASSWORD_HASH:await passwordHash('shared-only',salt)});
  db.prepare('INSERT INTO sessions VALUES(?,?)').run(await digest('old-session'),Math.floor(Date.now()/1000)+3600);
  assert.equal((await call(env,'/session',null,'old-session')).status,401);
  assert.equal((await call(env,'/login',{username:'shared',password:'shared-only'})).status,401);
  assert.equal((await call(env,'/reviews')).status,401);
  db.close();
});

test('provisioned admin can read but cannot modify the historical review archive',async()=>{
  const {db,env}=fixture();
  const salt='test-salt';
  db.prepare('INSERT INTO accounts(username,role,password_hash,password_salt) VALUES(?,?,?,?)')
    .run('coordinator','admin',await passwordHash('testing-password',salt),salt);
  db.exec("INSERT INTO reviews VALUES(1,'historic-id','sample',83,'report','Model','Old reader','4','','2026-09-01')");
  const auth=await call(env,'/login',{username:'coordinator',password:'testing-password'});
  const {token,role}=await auth.json();
  assert.equal(role,'admin');
  assert.equal((await (await call(env,'/reviews',null,token)).json()).reviews[0].reviewer,'Old reader');
  for(const path of ['/reviews','/reviews/batch','/reviews/historic-id/delete','/reviews/historic-id/update']) {
    assert.equal((await call(env,path,{},token)).status,405);
  }
  assert.equal(db.prepare('SELECT decision FROM reviews').get().decision,'4');
  assert.equal((await call(env,'/session',null,token,'https://other.invalid')).status,403);
  assert.equal((await call(env,'/logout',{},token)).status,200);
  assert.equal((await call(env,'/session',null,token)).status,401);
  db.close();
});

test('permissions and credential changes invalidate an issued session',async()=>{
  const {db,env}=fixture();
  const salt='test-salt';
  db.prepare('INSERT INTO accounts(username,role,password_hash,password_salt) VALUES(?,?,?,?)')
    .run('user','doctor',await passwordHash('old-password',salt),salt);
  const {token}=await (await call(env,'/login',{username:'user',password:'old-password'})).json();
  assert.equal((await call(env,'/reviews',null,token)).status,403);
  db.exec("UPDATE accounts SET role='admin' WHERE username='user'");
  assert.equal((await call(env,'/admin/results',null,token)).status,401);
  const current=await (await call(env,'/login',{username:'user',password:'old-password'})).json();
  db.prepare('UPDATE accounts SET password_hash=? WHERE username=?').run(await passwordHash('new-password',salt),'user');
  assert.equal((await call(env,'/session',null,current.token)).status,401);
  db.close();
});

test('doctors sharing a network can sign in independently, with per-user and network failure limits', async t => {
  const {db, env} = fixture();
  t.after(() => db.close());
  const salt = 'test-network';
  const hash = await passwordHash('sample-password', salt);
  const create = db.prepare('INSERT INTO accounts VALUES(?,?,?,?)');
  for (let i = 1; i <= 12; i++) {
    const username = 'doctor-' + i;
    create.run(username, 'doctor', salt, hash);
    assert.equal((await call(env, '/login', {username, password: 'sample-password'})).status, 200);
  }
  for (let i = 0; i < 10; i++) {
    assert.equal((await call(env, '/login', {username:'doctor-1', password:'wrong'})).status, 401);
  }
  assert.equal((await call(env, '/login', {username:'doctor-1', password:'sample-password'})).status, 429);
  assert.equal((await call(env, '/login', {username:'doctor-12', password:'sample-password'})).status, 200);
  for (let i = 0; i < 50; i++) {
    assert.equal((await call(env, '/login', {username:'other-' + i, password:'wrong'})).status, 401);
  }
  assert.equal((await call(env, '/login', {username:'doctor-12', password:'sample-password'})).status, 429);
});

test('adding a third doctor shares the same case and report order, and preserves independent ratings', async t => {
  const {db, env} = fixture();
  t.after(() => db.close());
  const letters = ['A', 'B', 'C', 'D'];
  const models = ['One', 'Two', 'Three', 'Four'];
  const id = 'Research01';
  async function newUser(username, role) {
    const salt = crypto.randomUUID();
    db.prepare('INSERT INTO accounts VALUES(?,?,?,?)')
      .run(username, role, salt, await passwordHash('sample-password', salt));
    if (role === 'doctor') {
      db.prepare('INSERT INTO assignments(username,case_id,letter,model_name,case_order) ' +
        'SELECT ?,case_id,letter,model_name,case_order FROM shared_case_letters').run(username);
    }
    const response = await call(env, '/login', {username, password: 'sample-password'});
    assert.equal(response.status, 200);
    return (await response.json()).token;
  }
  async function submit(token, rating) {
    const ratings = letters.map(letter => ({letter, rating, comment: ''}));
    assert.equal((await call(env, '/blind/cases/' + id + '/ratings', {ratings}, token)).status, 200);
  }
  async function isComplete(token) {
    const response = await call(env, '/blind/cases', null, token);
    return (await response.json()).cases.find(item => item.case_id === id).scored;
  }
  const caseIds = ['Research02', id];
  for (const [index, caseId] of caseIds.entries()) {
    db.prepare('INSERT INTO private_cases VALUES(?,?,?,?,?)').run(caseId, 'Example', caseId, caseId + '.nii.gz', 200);
    for (const [i, model] of models.entries()) {
      db.prepare('INSERT INTO private_reports VALUES(?,?,?)').run(caseId, model, 'Example report ' + i);
      db.prepare('INSERT INTO shared_case_letters VALUES(?,?,?,?)').run(caseId, letters[(i + index) % 4], model, index + 1);
    }
  }
  const admin = await newUser('coordinator', 'admin');
  const first = await newUser('doctor-one', 'doctor');
  const second = await newUser('doctor-two', 'doctor');
  await submit(first, 2);
  assert.equal(await isComplete(admin), false);
  await submit(second, 5);
  assert.equal(await isComplete(admin), true);

  const third = await newUser('doctor-three', 'doctor');
  assert.equal(await isComplete(admin), false);
  assert.equal(await isComplete(first), true);
  assert.equal(await isComplete(third), false);
  const thirdForm = await (await call(env, '/blind/cases/' + id, null, third)).json();
  assert.deepEqual(thirdForm.reports.map(report => report.rating), [null, null, null, null]);
  for (const token of [first, second, third]) {
    const list = await (await call(env, '/blind/cases', null, token)).json();
    assert.deepEqual(list.cases.map(c => c.case_id), caseIds);
    const form = await (await call(env, '/blind/cases/' + id, null, token)).json();
    assert.deepEqual(form.reports.map(r => [r.letter, r.text]), thirdForm.reports.map(r => [r.letter, r.text]));
  }
  assert.throws(() => db.prepare('UPDATE assignments SET case_order=3 WHERE username=? AND case_id=?').run('doctor-one', id),
    /shared case order/);
  await submit(third, 4);
  assert.equal(await isComplete(admin), true);
  const {results} = await (await call(env, '/admin/results', null, admin)).json();
  assert.equal(results.length, 24);
  assert.equal(results.filter(row => row.case_id===id).length, 12);
  for (const [name, score] of [['doctor-one', 2], ['doctor-two', 5], ['doctor-three', 4]]) {
    const userResults = results.filter(row => row.username === name && row.case_id === id);
    assert.deepEqual(userResults.map(row => row.rating), [score, score, score, score]);
    assert.equal(userResults.find(row => row.model_name === 'One').letter, 'B');
  }
});

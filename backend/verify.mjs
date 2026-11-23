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

test('Study B serves CT metadata only for the current reader after opening the assigned examination',async t=>{
  const {env,db}=fixture();t.after(()=>db.close());
  const cases=Array.from({length:10},(_,i)=>({case_id:'B'+String(i+1).padStart(2,'0'),
    drive_url:'https://drive.google.com/file/d/syntheticFileForCase'+i+'/view',sha256:String(i).repeat(64),size:2048,
    draft:'Private AI draft.',reference:'Independent reference.',reference_findings:[],draft_errors:[]}));
  db.prepare('UPDATE study_b_cohort SET cases_json=?,order_json=?,frozen=1 WHERE id=1').run(JSON.stringify(cases),JSON.stringify(cases.map(c=>c.case_id)));
  const join=async name=>(await (await call(env,'/public/crossover-readers',{name,cohort:'senior',entry_key:crypto.randomUUID()+crypto.randomUUID()})).json()).token;
  const first=await join('Senior One'),second=await join('Senior Two');
  const path='/study-b/cases/B01';
  const head=token=>worker.fetch(new Request('https://example.test'+path+'/image',{method:'HEAD',headers:{Authorization:'Bearer '+token,Range:'bytes=0-15'}}),{...env,DRIVE_MEDIA_KEY:'fixture-only'});
  assert.equal((await head(first)).status,403);
  const visit=await (await call(env,path+'/open',{period:1},first)).json();
  assert.equal(visit.condition,'without_ai');assert.equal(visit.report,'');
  assert.ok(!JSON.stringify(visit).includes('Private AI draft'));assert.ok(!JSON.stringify(visit).includes('Independent reference'));
  const image=await head(first);assert.equal(image.status,206);assert.equal(image.headers.get('Content-Range'),'bytes 0-15/2048');
  assert.equal((await head(second)).status,403);
});

test('Study A retains the original key and scores, binds 18 findings to the displayed report, and saves one blinded review at a time',async t=>{
  const {db,env}=fixture();
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON');
  const id='BR4shared-Case01', url='/blind/cases/'+id, users=['reader-one','reader-two','coordinator'];
  const models=['M3D-LaMed-Phi-3-4B','BTB3D-16','MORPH-CT','CT-CHAT-8B'];
  const labels=Object.fromEntries(('cardiomegaly hiatal_hernia pericardial_effusion lymphadenopathy lung_nodule emphysema '+
    'interlobular_septal_thickening consolidation atelectasis lung_opacity pulmonary_fibrotic_sequela bronchiectasis '+
    'pleural_effusion mosaic_attenuation_pattern arterial_wall_calcification peribronchial_thickening medical_material coronary_artery_wall_calcification').split(' ').map(k=>[k,0]));
  const sql=(q,...args)=>db.prepare(q).run(...args);
  for (const u of users){
    const role=u==='coordinator'?'admin':'doctor';
    sql('INSERT INTO accounts VALUES(?,?,?,?)',u,role,'salt','hash');
    sql('INSERT INTO account_sessions VALUES(?,?,?,?,?)',await digest(u),u,role,'hash',2**31-1);
  }
  sql('INSERT INTO private_cases VALUES(?,?,?,?,?)',id,'Study case','fixture','image.nii.gz',42);
  for(const [i,m] of models.entries()){
    const letter='ABCD'[i], text='Original report '+i;
    sql('INSERT INTO private_reports VALUES(?,?,?)',id,m,text);
    sql('INSERT INTO shared_case_letters VALUES(?,?,?,?)',id,letter,m,1);
    for(const u of users.slice(0,2))sql('INSERT INTO assignments(username,case_id,letter,model_name,case_order,rating) VALUES(?,?,?,?,?,?)',u,id,letter,m,1,4);
    if(i!==2)sql('INSERT INTO study_a_findings VALUES(?,?)',await digest(text),JSON.stringify({...labels,pleural_effusion:i%2}));
  }
  const get=async(path,u)=>await (await call(env,path,null,u)).json();
  const send=(body,u='reader-one')=>worker.fetch(new Request('https://example.test'+url+'/study-a-review',{
    method:'PUT',headers:{Authorization:'Bearer '+u,'Content-Type':'application/json'},body:JSON.stringify(body)
  }),env);
  const r=await get(url,'reader-one');
  const referencePath='/admin/study-a-references';
  const ref={case_id:id,version:0,expert:'Independent expert',notes:'Private reference.',
    findings:Object.fromEntries(Object.keys(labels).map(k=>[k,{status:'absent',side:''}]))};
  const writeRef=(data,u)=>worker.fetch(new Request('https://example.test'+referencePath,{
    method:'PUT',headers:{Authorization:'Bearer '+u,'Content-Type':'application/json'},body:JSON.stringify(data)
  }),env);
  assert.equal((await call(env,referencePath,null,'reader-one')).status,403);
  assert.equal((await writeRef(ref,'reader-two')).status,403);
  assert.equal((await writeRef(ref,'coordinator')).status,200);
  assert.equal((await writeRef(ref,'coordinator')).status,409);
  assert.equal((await writeRef({...ref,version:1,findings:{}},'coordinator')).status,400);
  assert.equal((await get(referencePath,'coordinator')).references[0].version,1);
  assert.ok(!JSON.stringify(await get(url,'reader-one')).includes(ref.notes));
  assert.equal(r.protocol,'study-a');
  assert.deepEqual(r.reports.map(x=>x.letter+x.text.slice(-1)),['A1','B2','C3']);
  assert.ok(r.reports.every(x=>x.review===null));
  assert.equal(r.reports[0].findings.pleural_effusion,1);
  assert.equal(r.reports[1].findings,null);
  assert.ok(models.every(m=>!JSON.stringify(r).includes(m)));
  const body={letter:'A',revision:'initial',version:0,rating:3,comment:'',mode:'yes',confirmed:true,
    errors:[{finding:'other',other:'Hilar mass',type:'missed',significant:true,detail:'On the left'}]};
  assert.equal((await call(env,'/admin/study-a-results',null,'reader-one')).status,403);
  assert.equal((await send(body,'coordinator')).status,403);
  for (const change of [{confirmed:false},{mode:'no'},{rating:0},{letter:'D'},{errors:[{...body.errors[0],other:''}]}]) {
    assert.equal((await send({...body,...change})).status,400);
  }
  assert.equal((await send({...body,letter:'B'})).status,409);
  assert.equal((await send({...body,revision:'stale'})).status,409);
  const {review:first}=await (await send(body)).json();
  assert.equal(first.version,1);
  assert.deepEqual(first.errors,body.errors);
  assert.deepEqual((await (await send(body)).json()).review,first);
  assert.equal((await send({...body,rating:4})).status,409);
  assert.deepEqual((await get(url,'reader-two')).reports.map(x=>x.review),[null,null,null]);
  assert.equal((await get('/blind/cases','reader-one')).cases[0].reviewed_count,1);
  assert.equal((await get('/blind/cases','reader-two')).cases[0].reviewed_count,0);
  const updated=await (await send({...body,version:1,mode:'no',errors:[],rating:5})).json();
  assert.equal(updated.review.version,2);
  assert.equal(updated.review.mode,'no');
  const admin=await get('/admin/study-a-results','coordinator');
  assert.deepEqual(admin.assignments.map(x=>x.model_name),models.slice(1));
  assert.equal(admin.results.length,1);
  assert.equal(admin.results[0].model_name,models[1]);
  assert.deepEqual(admin.readers[0].case_ids,[id]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM assignments WHERE rating=4').get().n,8);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM previously_rated_cases').get().n,1);
  assert.equal((await call(env,url+'/ratings','unused','reader-one')).status,409);

  const release='synthetic-reviewed-1', hash=await digest('Original report 1');
  const stage=(value=1)=>sql('INSERT INTO study_a_finding_overrides(version,text_sha256,finding,raw_value,reviewed_value) VALUES(?,?,?,?,?)',
    release,hash,'pleural_effusion',value,1-value);
  sql('INSERT INTO study_a_checklist_releases(version) VALUES(?)',release);
  assert.throws(()=>stage(0),/matching original finding/);
  stage();
  assert.equal((await get(url,'reader-two')).reports[0].findings.pleural_effusion,1);
  // Publish between server-side read validation and the actual write.
  const prepare=env.DB.prepare;
  env.DB.prepare=query=>{
    if (query.startsWith('INSERT INTO study_a_reviews')) {
      sql('UPDATE study_a_checklist_releases SET active=1 WHERE version=?',release);
      env.DB.prepare=prepare;
    }
    return prepare(query);
  };
  assert.equal((await send(body,'reader-two')).status,409);
  const fresh=await get(url,'reader-two'), existing=await get(url,'reader-one');
  assert.notEqual(fresh.revision,r.revision);
  assert.equal(fresh.reports[0].findings.pleural_effusion,0);
  assert.equal(fresh.reports[2].findings.pleural_effusion,1);
  assert.equal(fresh.reports[1].findings,null);
  assert.ok(models.every(m=>!JSON.stringify(fresh).includes(m)));
  assert.deepEqual(existing.reports[0].findings,r.reports[0].findings);
  assert.equal(existing.reports[0].review.checklist_version,'radbert-raw');
  assert.equal((await send(body,'reader-two')).status,409);
  const freshSave=await (await send({...body,revision:fresh.revision},'reader-two')).json();
  assert.equal(freshSave.review.checklist_version,release);
  const edited=await (await send({...body,revision:existing.revision,version:2})).json();
  assert.equal(edited.review.checklist_version,'radbert-raw');
  const keys=(await get('/admin/study-a-results','coordinator')).results.map(x=>x.checklist_version);
  assert.deepEqual(keys.sort(),['radbert-raw',release].sort());
  assert.equal(db.prepare("SELECT json_extract(labels_json,'$.pleural_effusion') AS original FROM study_a_findings WHERE text_sha256=?").get(hash).original,1);
  sql('UPDATE study_a_checklist_releases SET active=0 WHERE version=?',release);
  assert.equal((await get(url,'reader-two')).reports[0].findings.pleural_effusion,0);
  assert.throws(()=>sql('DELETE FROM study_a_finding_overrides WHERE version=?',release),/immutable/);
  assert.throws(()=>sql('UPDATE study_a_checklist_releases SET published=0 WHERE version=?',release),/immutable/);
  assert.throws(()=>stage(),/Expected a draft/);
});

test('versioning migration assigns historical ratings the original checklist',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE study_a_reviews(username TEXT); CREATE TABLE study_a_findings(text_sha256 TEXT PRIMARY KEY,labels_json TEXT);');
    db.exec("INSERT INTO study_a_reviews VALUES('historical-reader')");
    db.exec(sqlFile('./migrations/0008_study_a_reviewed_findings.sql'));
    assert.equal(db.prepare('SELECT checklist_version FROM study_a_reviews').get().checklist_version,'radbert-raw');
  } finally { db.close(); }
});

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

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import worker, { passwordHash } from './worker.mjs';

function d1(sqlite) {
  function statement(sql, args) {
    return {
      bind: (...values) => statement(sql, values),
      first: () => sqlite.prepare(sql).get(...args) ?? null,
      all: () => ({ results: sqlite.prepare(sql).all(...args) }),
      run: () => sqlite.prepare(sql).run(...args)
    };
  }
  return {
    prepare: sql => statement(sql, []),
    batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(item => item.run());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

test('physicians rate the same four anonymous reports independently and the administrator recovers the correct models', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const bytes = new Uint8Array([13, 19, 23, 29]);
  const env = {
    DB: d1(sqlite),
    IMAGES: { get: async key => key === 'fixture-image' ? { size: bytes.length, body: bytes } : null }
  };
  const execute = (sql, ...args) => sqlite.prepare(sql).run(...args);
  for (const [username, role] of [['doctor-one', 'doctor'], ['doctor-two', 'doctor'], ['coordinator', 'admin']]) {
    const salt = crypto.randomUUID();
    execute('INSERT INTO accounts(username,role,password_salt,password_hash) VALUES(?,?,?,?)',
      username, role, salt, await passwordHash('test-password', salt));
  }
  execute('INSERT INTO private_cases VALUES(?,?,?,?,?)', 'Demo01', 'Private case caption', 'fixture-image', 'Demo01.nii.gz', bytes.length);
  execute('INSERT INTO private_cases VALUES(?,?,?,?,?)', 'Unassigned', 'Unassigned scan', 'unassigned-image', 'Unassigned.nii.gz', bytes.length);
  const models = ['Model One', 'Model Two', 'Model Three', 'Model Four'];
  const letters = ['A', 'B', 'C', 'D'];
  for (const [index, model] of models.entries()) {
    execute('INSERT INTO private_reports VALUES(?,?,?)', 'Demo01', model, 'Example report ' + index);
    execute('INSERT INTO shared_case_letters(case_id,letter,model_name,case_order) VALUES(?,?,?,?)',
      'Demo01', letters[index], model, 1);
  }
  for (const [index, model] of models.entries()) {
    for (const doctor of ['doctor-one', 'doctor-two']) {
      execute('INSERT INTO assignments(username,case_id,letter,model_name,case_order) VALUES(?,?,?,?,?)',
        doctor, 'Demo01', letters[index], model, 1);
    }
  }
  const call = (path, token, body) => worker.fetch(new Request('https://example.invalid' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body ? JSON.stringify(body) : undefined
  }), env);
  const signin = async username => {
    const response = await call('/login', null, { username, password: 'test-password' });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  };
  const first = await signin('doctor-one'), second = await signin('doctor-two'), admin = await signin('coordinator');
  assert.equal((await call('/admin/storage', null)).status, 401);
  assert.equal((await call('/admin/storage', first)).status, 403);
  assert.deepEqual(await (await call('/admin/storage', admin)).json(), {ready:true});
  const configuredStorage=env.IMAGES;
  delete env.IMAGES;
  assert.deepEqual(await (await call('/admin/storage', admin)).json(), {ready:false});
  assert.equal((await call('/admin/batches', admin, {})).status, 503);
  env.IMAGES=configuredStorage;
  const detail = token => call('/blind/cases/Demo01', token).then(response => response.json());
  const formOne = await detail(first), formTwo = await detail(second);
  assert.deepEqual(formOne.reports.map(r => r.letter), letters);
  assert.deepEqual(Object.keys(formOne.reports[0]).sort(), ['comment', 'letter', 'rating', 'text']);
  assert.equal(formOne.case_name, 'Demo01');
  assert.deepEqual(formOne.reports, formTwo.reports);
  assert.ok(models.every(name => !JSON.stringify(formOne).includes(name)));
  for (const token of [first, second]) {
    assert.equal((await call('/admin/results', token)).status, 403);
    assert.equal((await call('/reviews', token)).status, 403);
    assert.deepEqual((await (await call('/blind/cases', token)).json()).cases.map(row => row.case_id), ['Demo01']);
    assert.equal((await call('/blind/cases/Unassigned', token)).status, 404);
    assert.equal((await call('/blind/cases/Unassigned/image', token)).status, 404);
  }
  assert.equal((await call('/blind/cases/Demo01/image', null)).status, 401);
  const image = await call('/blind/cases/Demo01/image', first);
  assert.deepEqual(new Uint8Array(await image.arrayBuffer()), bytes);
  assert.match(image.headers.get('Cache-Control'), /no-store/);

  const ratings = letters.map((letter, index) => ({ letter, rating: index + 1, comment: 'first reader ' + letter }));
  assert.equal((await call('/blind/cases/Demo01/ratings', first, { ratings })).status, 200);
  assert.equal((await call('/blind/cases/Demo01/ratings', first, { ratings })).status, 200);
  assert.equal((await detail(first)).reports[0].comment, 'first reader A');
  assert.ok((await detail(second)).reports.every(row => row.rating === null && row.comment === ''));
  assert.equal((await (await call('/blind/cases', second)).json()).cases[0].scored, false);
  const adminCompletion = async () => (await (await call('/blind/cases', admin)).json()).cases.map(row => row.scored);
  assert.deepEqual(await adminCompletion(), [false, false]);
  const ownRatings = letters.map(letter => ({ letter, rating: 5, comment: 'second reader ' + letter }));
  assert.equal((await call('/blind/cases/Demo01/ratings', second, { ratings: ownRatings })).status, 200);
  assert.equal((await detail(first)).reports[1].rating, 2);
  assert.deepEqual(await adminCompletion(), [true, false]);
  assert.equal((await detail(admin)).reports.length, 4);
  const { results } = await (await call('/admin/results', admin)).json();
  assert.equal(results.length, 8);
  const sameModel = results.filter(row => row.model_name === models[0]).sort((a, b) => a.username.localeCompare(b.username));
  assert.deepEqual(sameModel.map(r => [r.username, r.letter, r.rating]), [['doctor-one', 'A', 1], ['doctor-two', 'A', 5]]);
});

test('name-only readers are isolated, even with identical names, and only see an explicitly opened Drive study', async t => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  // Applying the additive migration a second time preserves all existing data.
  sqlite.exec(readFileSync(new URL('./migrations/0005_public_reader_access.sql',import.meta.url),'utf8'));
  const env={DB:d1(sqlite)};
  const api=async(path,body,token)=>worker.fetch(new Request('https://fixture.invalid'+path,{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token&&{Authorization:'Bearer '+token})},
    ...(body&&{body:JSON.stringify(body)})
  }),env);
  sqlite.prepare("INSERT INTO accounts VALUES('coord','admin',?,?)").run('salt',await passwordHash('sample-password','salt'));
  const admin=(await (await api('/login',{username:'coord',password:'sample-password'})).json()).token;
  const sample={case_id:'Case01',case_name:'Private source name',size:321,sha256:'f'.repeat(64),
    drive_url:'https://drive.google.com/file/d/fixture_AABBCC/view',reports:[...'ABCD'].map((letter,i)=>({
      letter,model_name:'opaque-'+i,text:'Text for report '+letter
    }))};
  const packet={prefix:'PrivateStudy',doctors:[],cases:[sample]};
  assert.equal((await api('/admin/drive-studies',packet,admin)).status,200);
  const publicList=async()=>(await api('/public/studies')).json();
  assert.deepEqual(await publicList(),{studies:[]});
  const prefix='OpenStudy';
  const admission={name:'Dr Wang',prefix,entry_key:crypto.randomUUID()+crypto.randomUUID()};
  assert.equal((await api('/public/readers',{...admission,prefix:packet.prefix})).status,404);
  const opened={...packet,prefix,public_access:true};
  assert.equal((await api('/admin/drive-studies',opened,admin)).status,200);
  assert.deepEqual(await publicList(),{studies:[{prefix,case_count:1}]});
  assert.equal((await api('/admin/public-studies/'+prefix+'/images')).status,401);
  const {images}=await (await api('/admin/public-studies/'+prefix+'/images',null,admin)).json();
  assert.deepEqual(images,[{case_id:prefix+'-Case01',size:321,drive_url:sample.drive_url,sha256:sample.sha256}]);
  assert.equal((await api('/public/readers',{...admission,entry_key:'guess'})).status,400);
  assert.equal((await api('/public/readers',{...admission,name:'王医生'})).status,400);
  const first=await (await api('/public/readers',admission)).json();
  assert.equal(first.display_name,admission.name);
  assert.equal(first.public_study,prefix);
  assert.ok(first.token?.length>40);
  const retry=await (await api('/public/readers',admission)).json();
  assert.equal(retry.token,first.token);
  assert.equal((await api('/public/readers',{...admission,name:'Different name'})).status,409);
  const second=await (await api('/public/readers',{...admission,entry_key:crypto.randomUUID()+crypto.randomUUID()})).json();
  assert.notEqual(second.username,first.username);
  assert.notEqual(second.token,first.token);
  assert.deepEqual(await (await api('/admin/doctors',null,admin)).json(),{doctors:[]});
  assert.equal((await api('/admin/results',null,second.token)).status,403);
  assert.equal((await api('/admin/public-studies',{prefix,enabled:true},second.token)).status,403);
  const path='/blind/cases/'+prefix+'-Case01';
  const adminCase=await (await api(path,null,admin)).json();
  assert.equal(adminCase.public_ct,true);
  assert.deepEqual(adminCase.reports.map(r=>[r.letter,r.model_name]),sample.reports.map(r=>[r.letter,r.model_name]));
  assert.equal((await (await api('/blind/cases/PrivateStudy-Case01',null,admin)).json()).public_ct,undefined);
  assert.equal((await api('/blind/cases/PrivateStudy-Case01',null,first.token)).status,404);
  const report=await (await api(path,null,first.token)).json();
  assert.deepEqual(report.reports.map(r=>r.letter),[...'ABCD']);
  assert.equal(JSON.stringify(report).includes('opaque-'),false);
  const answers={revision:report.revision,ratings:[...'ABCD'].map(letter=>({letter,rating:5,comment:'first reader only'}))};
  assert.equal((await api(path+'/ratings',answers,first.token)).status,200);
  const other=await (await api(path,null,second.token)).json();
  assert.ok(other.reports.every(r=>r.rating===null&&r.comment===''));
  const adminRows=(await (await api('/admin/results',null,admin)).json()).results;
  assert.equal(new Set(adminRows.map(r=>r.username)).size,2);
  assert.ok(adminRows.every(r=>r.display_name===admission.name));
  sqlite.prepare("UPDATE assignments SET comment=? WHERE username=? AND letter='A'").run('先前的评语',first.username);
  const own=(await (await api(path,null,first.token)).json()).reports;
  assert.equal(own[0].comment,null);
  assert.equal((await api(path+'/ratings',{...answers,ratings:own.map(({letter,rating,comment})=>({letter,rating,comment}))},first.token)).status,200);
  assert.equal(sqlite.prepare("SELECT comment FROM assignments WHERE username=? AND letter='A'").get(first.username).comment,'先前的评语');
  assert.equal((await api(path+'/ratings',{...answers,ratings:answers.ratings.map(r=>({...r,comment:'新增评语'}))},first.token)).status,400);
  sqlite.prepare('UPDATE public_readers SET display_name=? WHERE username=?').run('旧姓名',second.username);
  const existingIdentity=await (await api('/session',null,second.token)).json();
  assert.match(existingIdentity.display_name,/^Reader [a-f0-9]{8}$/);
  assert.doesNotMatch(JSON.stringify(await (await api('/admin/results',null,admin)).json()),/\p{Script=Han}/u);
  assert.equal((await api('/logout',{},first.token)).status,200);
  assert.equal((await api('/public/readers',admission)).status,403);
  assert.equal((await api(path,null,first.token)).status,401);
  assert.equal((await api('/admin/public-studies',{prefix,enabled:false},admin)).status,200);
  assert.equal((await api(path,null,second.token)).status,401);
  assert.deepEqual(await publicList(),{studies:[]});
  assert.equal((await api('/admin/drive-studies',opened,admin)).status,200);
  assert.deepEqual(await publicList(),{studies:[]});
  assert.equal((await api('/admin/public-studies',{prefix,enabled:true},admin)).status,200);
  assert.equal((await api(path,null,second.token)).status,401);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM assignments WHERE rating=5').get().n,4);
});

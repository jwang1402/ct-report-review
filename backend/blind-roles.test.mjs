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

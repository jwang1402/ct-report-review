const usernamePattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const prefixPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

// Both the command-line and browser imports use blind/<study>/<case>/... object keys.
async function publishedStudies(db) {
  const {results} = await db.prepare(`
    SELECT substr(c.image_key,7,instr(substr(c.image_key,7),'/')-1) AS prefix,
           COUNT(DISTINCT c.case_id) AS case_count
    FROM private_cases c LEFT JOIN shared_case_letters s ON c.case_id=s.case_id
    WHERE c.image_key GLOB 'blind/*/*/*'
    GROUP BY prefix
    HAVING COUNT(s.letter) = 4 * COUNT(DISTINCT c.case_id)
    ORDER BY prefix`).all();
  return results;
}

// The Worker checks the administrator role before dispatching any of these routes.
export async function manageReaders(path, request, db, {jsonBody, passwordHash, HttpError}) {
  if (path === '/admin/doctors' && request.method === 'POST') {
    const {username, password} = await jsonBody(request);
    if (typeof username !== 'string' || !usernamePattern.test(username) ||
        typeof password !== 'string' || password.length < 12 || password.length > 200) {
      throw new HttpError(400, 'Use a valid reader username and a 12–200 character password.');
    }
    const salt = crypto.randomUUID();
    const hash = await passwordHash(password, salt);
    const row = await db.prepare(`
      INSERT INTO accounts(username,role,password_salt,password_hash)
      VALUES(?,'doctor',?,?) ON CONFLICT(username) DO NOTHING RETURNING username
    `).bind(username,salt,hash).first();
    if (!row) throw new HttpError(409, 'This username is already in use.');
    return {username};
  }
  if (path === '/admin/enrollment/studies' && request.method === 'GET') {
    return {studies: await publishedStudies(db)};
  }
  if (path === '/admin/enrollment' && request.method === 'POST') {
    const {prefix, username} = await jsonBody(request);
    if (typeof prefix !== 'string' || !prefixPattern.test(prefix) ||
        typeof username !== 'string' || !usernamePattern.test(username)) {
      throw new HttpError(400,'Choose a reader and a published study.');
    }
    const account = await db.prepare("SELECT username FROM accounts WHERE username=? AND role='doctor'").bind(username).first();
    if (!account) throw new HttpError(404,'Reader not found.');
    const study = (await publishedStudies(db)).find(row=>row.prefix===prefix);
    if (!study) throw new HttpError(404,'Published study not found.');
    const keys = 'blind/' + prefix + '/*';
    await db.prepare(`
      INSERT INTO assignments(username,case_id,letter,model_name,case_order)
      SELECT ?,s.case_id,s.letter,s.model_name,s.case_order
      FROM shared_case_letters s JOIN private_cases c ON s.case_id=c.case_id
      WHERE c.image_key GLOB ?
      ON CONFLICT(username,case_id,letter) DO NOTHING
    `).bind(username,keys).run();
    return {username,prefix,case_count:study.case_count};
  }
  return null;
}

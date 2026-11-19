import {englishReport} from './english-report.mjs';
import {displayCaseName,hasHan} from './english-ui.mjs';

const PART_BYTES = 8 * 1024 * 1024;
const letters = ['A','B','C','D'];
const prefixPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const aliasPattern = /^Case[0-9]{2,4}$/;

export class StudyError extends Error {
  constructor(status,message) { super(message); this.status = status; }
}
function check(ok,status,message) {
  if (!ok) throw new StudyError(status,message);
}
function validString(s,max) {
  return typeof s==='string' && s.length<=max && s.trim().length>0 && !s.includes('\0');
}

function validateReports(reports) {
  check(Array.isArray(reports) && reports.length===4,400,'Each case requires four reports.');
  const sorted = reports.map(r => {
    check(r && letters.includes(r.letter) && validString(r.model_name,100) && validString(r.text,48000),
      400,'Each report needs a letter, a model and text.');
    const text=englishReport(r.text);
    check(text&&!hasHan(r.model_name),400,'Provide the original English report text and a model name in English.');
    return {letter:r.letter,model_name:r.model_name.trim(),text};
  }).sort((a,b)=>a.letter.localeCompare(b.letter));
  const models = new Set(sorted.map(r=>r.model_name.toLowerCase()));
  check(sorted.every((r,i)=>r.letter===letters[i]) && models.size===4,400,'Each letter and model must occur once per case.');
  check(!sorted.some(r=>[...models].some(m=>m.length>=3 && r.text.toLowerCase().includes(m))),
    400,'Remove model names from the blinded report body.');
  return sorted;
}

const displayNames = new Map(Object.entries({morph:'MORPH-CT',m3d:'M3D-LaMed-Phi-3-4B',btb:'BTB3D-16',ctchat:'CT-CHAT-8B'}));

function driveFileReference(value) {
  const invalid='Use the Google Drive sharing link for an individual file.';
  check(validString(value,2048),400,invalid);
  let url;
  try { url=new URL(value); } catch { throw new StudyError(400,invalid); }
  check(url.origin==='https://drive.google.com' && !url.username && !url.password,400,invalid);
  const filePath=/^\/file\/d\/([A-Za-z0-9_-]{10,200})(?:\/view)?\/?$/.exec(url.pathname);
  const id=filePath?.[1] ?? (url.pathname==='/open' && url.searchParams.getAll('id').length===1 ? url.searchParams.get('id') : '');
  check(/^[A-Za-z0-9_-]{10,200}$/.test(id),400,invalid);
  const keys=url.searchParams.getAll('resourcekey');
  check(!keys.length || (keys.length===1 && /^[A-Za-z0-9_-]{1,200}$/.test(keys[0])),400,invalid);
  return {id, reference:id+(keys.length?'?resourcekey='+keys[0]:'')};
}

export function driveImage(key) {
  const match=/^blind\/[A-Za-z0-9_-]+\/Case\d+\/drive\/([a-f0-9]{64})\/([A-Za-z0-9_-]{10,200})(\?resourcekey=[A-Za-z0-9_-]{1,200})?$/.exec(key);
  if (!match) return null;
  return {sha256:match[1],drive_url:'https://drive.google.com/file/d/'+match[2]+'/view'+(match[3]??'')};
}

function normalize(data,drive) {
  check(typeof data.prefix==='string' && prefixPattern.test(data.prefix),400,'Invalid study prefix.');
  check(Array.isArray(data.cases) && data.cases.length>0 && data.cases.length<=100,400,'Provide between 1 and 100 cases.');
  const ids = new Set();
  const linkedFiles = new Set();
  let modelSet;
  const cases = data.cases.map(c=>{
    check(c && typeof c.case_id==='string' && aliasPattern.test(c.case_id) && validString(c.case_name,120) && !hasHan(c.case_name) && !ids.has(c.case_id),
      400,'Cases need distinct CaseNN aliases and a display name in English.');
    check(Number.isSafeInteger(c.size) && c.size>2 && c.size < 2*1024**3 && typeof c.sha256==='string' && /^[a-f0-9]{64}$/.test(c.sha256),
      400,'Invalid NIfTI size or SHA-256.');
    const reports=validateReports(Array.isArray(c.reports) ? c.reports.map(r=>({...r,model_name:displayNames.get(r?.model_name)??r?.model_name})) : c.reports);
    const names=JSON.stringify(reports.map(r=>r.model_name).sort());
    check(modelSet===undefined || modelSet===names,400,'Use the same four models across the study.');
    modelSet=names;
    ids.add(c.case_id);
    const row={case_id:c.case_id,case_name:c.case_name.trim(),size:c.size,sha256:c.sha256,reports};
    if (drive) {
      const file=driveFileReference(c.drive_url);
      check(!linkedFiles.has(file.id),400,'Each case must link to a different CT file.');
      linkedFiles.add(file.id);
      row.drive_ref=file.reference;
    }
    if (c.part_sha256!==undefined) {
      check(Array.isArray(c.part_sha256) && c.part_sha256.length===chunks(c) &&
        c.part_sha256.every(h=>typeof h==='string' && /^[a-f0-9]{64}$/.test(h)),400,'Invalid image part checksums.');
      if (chunks(c)===1) check(c.part_sha256[0]===c.sha256,400,'Image checksum must match its single part.');
      row.part_sha256=c.part_sha256;
    }
    return row;
  });
  return {prefix:data.prefix,cases,...(drive && {provider:'drive'})};
}

const imageKey=(batch,c)=>'blind/'+batch.prefix+'/'+c.case_id+'/web-'+batch.batch_id+'/'+c.sha256+'.nii.gz';
const chunks=c=>Math.ceil(c.size/PART_BYTES);
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const dbrow=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const write=(db,sql,...args)=>db.prepare(sql).bind(...args).run();

async function createBatch(db,manifest) {
  const json=JSON.stringify(manifest);
  const id=crypto.randomUUID();
  const existing = await dbrow(db,'SELECT * FROM web_batches WHERE prefix=?',manifest.prefix);
  if (!existing) {
    const before = await dbrow(db,'SELECT 1 FROM private_cases WHERE image_key GLOB ? LIMIT 1','blind/'+manifest.prefix+'/*');
    check(!before,409,'This prefix already contains a study. Choose a new prefix or edit its cases.');
    await db.batch([
      db.prepare('INSERT INTO web_batches(batch_id,prefix,manifest) VALUES (?,?,?) ON CONFLICT(prefix) DO NOTHING')
        .bind(id,manifest.prefix,json),
      ...(manifest.provider==='drive' ? [] : [
        db.prepare("INSERT INTO web_uploads(batch_id,case_id) SELECT batch_id,c.value->>'case_id' FROM web_batches,json_each(manifest,'$.cases') c WHERE batch_id=?").bind(id)
      ])
    ]);
  }
  const row=existing || await dbrow(db,'SELECT * FROM web_batches WHERE prefix=?',manifest.prefix);
  if (row?.manifest!==json) {
    // Pending uploads from the bilingual release carry the translation in their saved manifest.
    const previous=row && JSON.parse(row.manifest);
    for (const c of previous?.cases??[]) for (const r of c.reports) r.text=englishReport(r.text);
    check(JSON.stringify(previous)===json,409,'This prefix already has a different packet. Use the original packet to resume, or choose a new prefix.');
  }
  return row;
}

async function status(db,batch) {
  const rows=await all(db,`SELECT u.case_id,u.ready,p.part FROM web_uploads u LEFT JOIN web_parts p
    USING(batch_id,case_id) WHERE u.batch_id=? AND (p.etag IS NULL OR p.etag<>'') ORDER BY u.case_id,p.part`,batch.batch_id);
  const lookup=new Map(rows.map(r=>[r.case_id,Boolean(r.ready)]));
  const images=JSON.parse(batch.manifest).cases.map(c=>({case_id:c.case_id,ready:lookup.get(c.case_id)??false,
    parts:rows.filter(r=>r.case_id===c.case_id && r.part!=null).map(r=>r.part)}));
  return {batch_id:batch.batch_id,state:batch.state,part_size:PART_BYTES,images};
}

async function getUpload(db,bucket,batch,c) {
  const row=await dbrow(db,'SELECT upload_id,ready FROM web_uploads WHERE batch_id=? AND case_id=?',batch.batch_id,c.case_id);
  if (row.ready || row.upload_id) return row;
  const upload=await bucket.createMultipartUpload(imageKey(batch,c),{httpMetadata:{contentType:'application/gzip'}});
  try {
    await write(db,'UPDATE web_uploads SET upload_id=? WHERE batch_id=? AND case_id=? AND upload_id IS NULL AND ready=0',
      upload.uploadId,batch.batch_id,c.case_id);
  } catch (e) { await upload.abort().catch(()=>{}); throw e; }
  const active=await dbrow(db,'SELECT upload_id,ready FROM web_uploads WHERE batch_id=? AND case_id=?',batch.batch_id,c.case_id);
  if (active.upload_id!==upload.uploadId) await upload.abort().catch(()=>{});
  return active;
}

// Bound memory to a single part even when a browser/proxy omits Content-Length.
async function readPart(request,n) {
  const len=request.headers.get('Content-Length');
  check(request.body && (len===null || Number(len)===n),400,'Incorrect part size.');
  const reader=request.body.getReader();
  const bytes=new Uint8Array(n);
  let used=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if (done) break;
      if (used+value.length>n) { await reader.cancel(); throw new StudyError(400,'Part too large.'); }
      bytes.set(value,used); used+=value.length;
    }
  } finally {reader.releaseLock();}
  check(used===n,400,'Incomplete image part.');
  return bytes;
}
async function resetParts(db,batch,alias,uploadId) {
  await db.batch([
    db.prepare(`DELETE FROM web_parts WHERE batch_id=? AND case_id=? AND EXISTS
      (SELECT 1 FROM web_uploads WHERE batch_id=? AND case_id=? AND upload_id=? AND ready=0)`)
      .bind(batch,alias,batch,alias,uploadId),
    db.prepare('UPDATE web_uploads SET upload_id=NULL WHERE batch_id=? AND case_id=? AND upload_id=? AND ready=0')
      .bind(batch,alias,uploadId)
  ]);
}
function expired(error){return /NoSuchUpload|10024|specified multipart upload does not exist/i.test(String(error));}

async function putPart(request,db,bucket,batch,c,part) {
  check(Number.isSafeInteger(part) && part>=1 && part<=chunks(c),400,'Invalid part number.');
  const n=Math.min(c.size-(part-1)*PART_BYTES,PART_BYTES);
  const bytes=await readPart(request,n);
  check(part!==1 || (bytes[0]===31 && bytes[1]===139),400,'Expected a gzip-compressed NIfTI image.');
  const sha=hex(await crypto.subtle.digest('SHA-256',bytes));
  if (c.part_sha256) check(sha===c.part_sha256[part-1],422,'Image part checksum mismatch. Select the verified file.');
  const active=await getUpload(db,bucket,batch,c);
  const args=[batch.batch_id,c.case_id,part];
  const saved=await dbrow(db,'SELECT etag,sha256 FROM web_parts WHERE batch_id=? AND case_id=? AND part=?',...args);
  if (saved) {
    check(saved.sha256===sha,409,'Part content differs from the existing upload.');
    if (saved.etag) return {ok:true};
  }
  check(!active.ready && batch.state==='draft',409,'Image already complete.');
  // Reserve the content hash first: concurrent retries can only write identical bytes.
  await write(db,'INSERT INTO web_parts(batch_id,case_id,part,etag,sha256) VALUES(?,?,?,\'\',?) ON CONFLICT DO NOTHING',...args,sha);
  const claim=await dbrow(db,'SELECT sha256 FROM web_parts WHERE batch_id=? AND case_id=? AND part=?',...args);
  check(claim?.sha256===sha,409,'A different part was already submitted.');
  let uploaded;
  try {uploaded=await bucket.resumeMultipartUpload(imageKey(batch,c),active.upload_id).uploadPart(part,bytes);}
  catch (error) {
    if (!expired(error)) throw error;
    const now=await dbrow(db,'SELECT ready FROM web_uploads WHERE batch_id=? AND case_id=?',batch.batch_id,c.case_id);
    if (now?.ready) return {ok:true};
    await resetParts(db,batch.batch_id,c.case_id,active.upload_id);
    throw new StudyError(409,'The multipart upload expired. Select the same packet to resume.');
  }
  await write(db,`UPDATE web_parts SET etag=? WHERE batch_id=? AND case_id=? AND part=? AND sha256=?
    AND EXISTS(SELECT 1 FROM web_uploads WHERE batch_id=? AND case_id=? AND upload_id=?)`,
    uploaded.etag,...args,sha,batch.batch_id,c.case_id,active.upload_id);
  return {ok:true};
}

async function completeImage(db,bucket,batch,c) {
  const args=[batch.batch_id,c.case_id];
  const row=await dbrow(db,'SELECT upload_id,ready FROM web_uploads WHERE batch_id=? AND case_id=?',...args);
  if (row.ready) return {ok:true};
  check(row.upload_id,409,'Upload the image parts first.');
  const key=imageKey(batch,c);
  // Complete may already have succeeded at R2 if a previous request disconnected before the D1 update.
  let object=await bucket.head(key);
  if (!object) {
    const parts=await all(db,"SELECT part AS partNumber,etag,sha256 FROM web_parts WHERE batch_id=? AND case_id=? AND etag<>'' ORDER BY part",...args);
    check(parts.length===chunks(c),409,'Some image parts are still missing.');
    if (c.part_sha256) check(parts.every((p,i)=>p.partNumber===i+1 && p.sha256===c.part_sha256[i]),409,'Image parts do not match the frozen import.');
    try {await bucket.resumeMultipartUpload(key,row.upload_id).complete(parts.map(({partNumber,etag})=>({partNumber,etag})));}
    catch (e) {
      if (!(await bucket.head(key))) {
        if (!expired(e)) throw e;
        await resetParts(db,...args,row.upload_id);
        throw new StudyError(409,'The multipart upload expired. Select the same packet to resume.');
      }
    }
    object=await bucket.head(key);
  }
  check(object,503,'Image verification is temporarily unavailable.');
  // Browser packets bind every 8 MiB part to the verified image archive. For manifests
  // with only a whole-file hash, stream the completed object into the native digest.
  let matches=object.size===c.size;
  if (matches && !c.part_sha256) {
    const stored=await bucket.get(key);
    check(stored?.body,503,'Image verification is temporarily unavailable.');
    const digest=new crypto.DigestStream('SHA-256');
    await stored.body.pipeTo(digest);
    matches=hex(await digest.digest)===c.sha256;
  }
  if (!matches) {
    await bucket.delete(key);
    await resetParts(db,...args,row.upload_id);
    throw new StudyError(422,'Image checksum mismatch. Select the verified packet and retry this image.');
  }
  await write(db,'UPDATE web_uploads SET ready=1 WHERE batch_id=? AND case_id=? AND upload_id=?',...args,row.upload_id);
  return {ok:true};
}

async function checkReaders(db,users) {
  check(Array.isArray(users) && users.length<=500 && users.every(u=>typeof u==='string' && /^[a-z0-9][a-z0-9_-]{0,39}$/.test(u))
    && new Set(users).size===users.length,400,'Choose valid, distinct doctor accounts.');
  const usersJson=JSON.stringify(users);
  const listed=await dbrow(db,"SELECT COUNT(*) AS n FROM accounts WHERE role='doctor' AND username IN (SELECT value FROM json_each(?))",usersJson);
  check(listed.n===users.length,400,'One or more selected doctor accounts are unavailable.');
  return users;
}

async function publish(db,batch,users) {
  const usersJson=JSON.stringify(users);
  const missing=await dbrow(db,'SELECT COUNT(*) AS n FROM web_uploads WHERE batch_id=? AND ready=0',batch.batch_id);
  check(!missing.n,409,'Complete and verify all images before publishing.');
  const occupied=await dbrow(db,`SELECT 1 FROM web_batches WHERE batch_id=? AND state='draft'
    AND EXISTS(SELECT 1 FROM private_cases WHERE image_key GLOB ?)`,batch.batch_id,'blind/'+batch.prefix+'/*');
  check(!occupied,409,'This prefix was filled by another import. Use a new study prefix.');
  const caseId="(b.prefix||'-'||(c.value->>'case_id'))";
  const src=" FROM web_batches b, json_each(b.manifest,'$.cases') c";
  const reports=src+", json_each(c.value,'$.reports') r";
  const guard=" WHERE b.batch_id=? AND b.state='draft'";
  const key=JSON.parse(batch.manifest).provider==='drive'
    ? "('blind/'||b.prefix||'/'||(c.value->>'case_id')||'/drive/'||(c.value->>'sha256')||'/'||(c.value->>'drive_ref'))"
    : "('blind/'||b.prefix||'/'||(c.value->>'case_id')||'/web-'||b.batch_id||'/'||(c.value->>'sha256')||'.nii.gz')";
  const sql=[
    'INSERT INTO private_cases(case_id,case_name,image_key,image_filename,image_size) SELECT '+caseId+
      ",c.value->>'case_name',"+key+",(c.value->>'case_id')||'.nii.gz',c.value->>'size'"+src+guard,
    'INSERT INTO private_reports(case_id,model_name,report_text) SELECT '+caseId+",r.value->>'model_name',r.value->>'text'"+reports+guard,
    'INSERT INTO shared_case_letters(case_id,letter,model_name,case_order) SELECT '+caseId+",r.value->>'letter',r.value->>'model_name',CAST(c.key AS INTEGER)+1"+reports+guard,
  ];
  const statements=sql.map(s=>db.prepare(s).bind(batch.batch_id));
  statements.push(db.prepare('INSERT INTO assignments(username,case_id,letter,model_name,case_order) SELECT '+
    "(SELECT username FROM accounts WHERE role='doctor' AND username=d.value),"+caseId+
    ",r.value->>'letter',r.value->>'model_name',CAST(c.key AS INTEGER)+1"+reports+', json_each(?) d'+guard).bind(usersJson,batch.batch_id));
  statements.push(db.prepare("UPDATE web_batches SET state='published' WHERE batch_id=? AND state='draft'").bind(batch.batch_id));
  try {await db.batch(statements);}
  catch(e) {
    if (/constraint|unique/i.test(String(e))) throw new StudyError(409,'A case ID or assignment conflicts with existing data. No cases published from this request.');
    throw e;
  }
  if (users.length) {
    const coverage=await dbrow(db,'SELECT COUNT(*) AS n FROM assignments a JOIN private_cases p USING(case_id) '+
      'WHERE p.image_key GLOB ? AND a.username IN (SELECT value FROM json_each(?))','blind/'+batch.prefix+'/*',usersJson);
    check(coverage.n===JSON.parse(batch.manifest).cases.length*4*users.length,409,
      'Study already published with a different set of readers. Use reader enrollment to add doctors.');
  }
  return {ok:true};
}

async function editor(db,id) {
  const rows=await all(db,`SELECT c.case_id,c.case_name,s.letter,r.model_name,r.report_text AS text,
    COALESCE(v.revision,'initial') AS revision,
    (EXISTS(SELECT 1 FROM assignments a WHERE a.case_id=c.case_id AND a.rating IS NOT NULL)
      OR EXISTS(SELECT 1 FROM previously_rated_cases p WHERE p.case_id=c.case_id)) AS locked
    FROM private_cases c JOIN shared_case_letters s USING(case_id) JOIN private_reports r USING(case_id,model_name)
    LEFT JOIN web_case_versions v USING(case_id) WHERE c.case_id=? ORDER BY s.letter`,id);
  check(rows.length===4,404,'No shared study reports found for this case.');
  const {case_id,case_name,revision,locked}=rows[0];
  return {case_id,case_name:displayCaseName(case_name,case_id),revision,locked:!!locked,
    reports:rows.map(({letter,model_name,text})=>({letter,model_name,text:englishReport(text)}))};
}
async function saveEdit(db,id,data) {
  const current=await editor(db,id);
  check(!current.locked,409,'Ratings have already been submitted for this case.');
  check(data.revision===current.revision,409,'The report set changed. Reload before editing.');
  check(validString(data.case_name,120)&&!hasHan(data.case_name),400,'Enter a case display name in English.');
  const name=data.case_name.trim();
  const reports=validateReports(data.reports);
  check(reports.every((r,i)=>r.model_name===current.reports[i].model_name && r.letter===current.reports[i].letter),
    400,'Model names and the frozen letter mapping must remain the same.');
  const edited=reports.filter((r,i)=>r.text!==current.reports[i].text);
  if (name===current.case_name && !edited.length) return current;
  const rev=crypto.randomUUID();
  const version=" AND EXISTS(SELECT 1 FROM web_case_versions WHERE case_id=? AND revision=?)";
  const changed=await db.batch([
    db.prepare(`INSERT INTO web_case_versions(case_id,revision) SELECT ?,?
      WHERE NOT EXISTS(SELECT 1 FROM assignments WHERE case_id=? AND rating IS NOT NULL)
      AND NOT EXISTS(SELECT 1 FROM previously_rated_cases WHERE case_id=?)
      AND COALESCE((SELECT revision FROM web_case_versions WHERE case_id=?),'initial')=?
      ON CONFLICT(case_id) DO UPDATE SET revision=excluded.revision`).bind(id,rev,id,id,id,current.revision),
    ...(name===current.case_name?[]:[db.prepare('UPDATE private_cases SET case_name=? WHERE case_id=?'+version).bind(name,id,id,rev)]),
    ...edited.map(r=>db.prepare('UPDATE private_reports SET report_text=? WHERE case_id=? AND model_name=?'+version).bind(r.text,id,r.model_name,id,rev))
  ]);
  check((changed[0]?.meta?.changes ?? changed[0]?.changes)>0,409,'The case changed or a physician submitted ratings. Reload before editing.');
  return editor(db,id);
}
export async function adminStudy(path,request,env,jsonBody) {
  const db=env.DB, method=request.method;
  if (path==='/admin/doctors' && method==='GET') {
    return {doctors:(await all(db,"SELECT username FROM accounts WHERE role='doctor' AND username NOT IN (SELECT username FROM public_readers) ORDER BY username")).map(r=>r.username)};
  }
  const edit=/^\/admin\/cases\/([A-Za-z0-9_-]{1,100})\/editor$/.exec(path);
  if (edit && method==='GET') return editor(db,edit[1]);
  if (edit && method==='POST') return saveEdit(db,edit[1],await jsonBody(request,1024*1024));
  if (path==='/admin/drive-studies' && method==='POST') {
    const data=await jsonBody(request,1024*1024);
    check(data.public_access===undefined || typeof data.public_access==='boolean',400,'Choose whether to open the study to readers.');
    const manifest=normalize(data,true);
    const readers=await checkReaders(db,data.doctors);
    const batch=await createBatch(db,manifest);
    await publish(db,batch,readers);
    if(data.public_access===true) {
      await db.prepare('INSERT INTO public_studies(prefix,enabled) VALUES(?,1) ON CONFLICT(prefix) DO NOTHING').bind(batch.prefix).run();
    }
    return {ok:true,state:'published',existing:batch.state==='published'};
  }
  if (path==='/admin/batches' && method==='POST') {
    const batch=await createBatch(db,normalize(await jsonBody(request,1024*1024),false));
    return status(db,batch);
  }
  const match=/^\/admin\/batches\/([a-f0-9-]{36})(?:\/(publish)|\/images\/(Case[0-9]{2,4})\/(complete|parts\/([1-9][0-9]{0,4})))?$/.exec(path);
  if (!match) return null;
  const [,id,publishing,alias,action,part]=match;
  const batch=await dbrow(db,'SELECT * FROM web_batches WHERE batch_id=?',id);
  check(batch,404,'Unknown study batch.');
  check(JSON.parse(batch.manifest).provider!=='drive',409,'Use the Drive study endpoint for linked images.');
  if (!publishing && !alias && method==='GET') return status(db,batch);
  if (publishing && method==='POST') {
    const data=await jsonBody(request);
    return publish(db,batch,await checkReaders(db,data.doctors));
  }
  if (alias) {
    const c=JSON.parse(batch.manifest).cases.find(item=>item.case_id===alias);
    check(c,404,'Unknown image in this batch.');
    check(env.IMAGES,503,'Private image storage is unavailable.');
    if (action==='complete' && method==='POST') return completeImage(db,env.IMAGES,batch,c);
    if (part && method==='PUT') return putPart(request,db,env.IMAGES,batch,c,Number(part));
  }
  return null;
}

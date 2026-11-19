import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import worker,{digest,passwordHash} from './worker.mjs';

function database(sqlite) {
  function statement(sql,params) {
    const query=()=>sqlite.prepare(sql);
    return {bind:(...args)=>statement(sql,args),first:()=>query().get(...params),
      all:()=>({results:query().all(...params)}),run:()=>query().run(...params)};
  }
  return {prepare:sql=>statement(sql,[]),batch:items=>{
    sqlite.exec('BEGIN');
    try { const result=items.map(q=>q.run());sqlite.exec('COMMIT');return result; }
    catch(e){sqlite.exec('ROLLBACK');throw e;}
  }};
}

test('linked Drive CTs publish without R2 and expose the file link and digest only to assigned readers',async t=>{
  const sqlite=new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const env={DB:database(sqlite)};
  for(const [username,role] of [['a','admin'],['b','doctor'],['c','doctor']]){
    sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(username,role,'salt','stamp');
    sqlite.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').run(await digest(username),username,role,'stamp',20000000000);
  }
  async function call(path,user,data){
    const response=await worker.fetch(new Request('https://example.invalid'+path,{
      method:data?'POST':'GET',headers:{Authorization:'Bearer '+user,'Content-Type':'application/json'},
      body:data?JSON.stringify(data):undefined}),env);
    return {status:response.status,body:await response.json()};
  }
  const reports=[...'ABCD'].map((letter,i)=>({letter,model_name:['morph','m3d','btb','ctchat'][i],text:'report '+i}));
  const scan={case_id:'Case01',case_name:'First scan',sha256:'a'.repeat(64),size:500,reports,
    drive_url:'https://drive.google.com/open?id=private_file_01&resourcekey=0-safe&usp=sharing'};
  const study={prefix:'Drive',cases:[scan],doctors:['b']};
  const endpoint='/admin/drive-studies';
  const caseUrl='/blind/cases/Drive-Case01';
  assert.equal((await call(endpoint,'b',study)).status,403);
  for(const drive_url of ['https://drive.google.com.example.com/file/d/private_file_01/view',
    'https://bad@drive.google.com/open?id=private_file_01','https://drive.google.com/drive/folders/private_file_01']){
    assert.equal((await call(endpoint,'a',{...study,cases:[{...scan,drive_url}]})).status,400);
  }
  assert.equal((await call(endpoint,'a',{...study,cases:[scan,{...scan,case_id:'Case02'}]})).status,400);
  assert.equal((await call(endpoint,'a',{...study,doctors:['unknown']})).status,400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM web_batches').get().n,0);
  assert.equal((await call(caseUrl,'b')).status,404);
  for(let i=0;i<2;i++){
    const saved=await call(endpoint,'a',study);
    assert.equal(saved.status,200,saved.body.error);
    assert.equal(saved.body.state,'published');
    assert.equal(saved.body.existing,i!==0);
  }
  const oldBatch=JSON.parse(sqlite.prepare('SELECT manifest FROM web_batches WHERE prefix=?').get(study.prefix).manifest);
  for(const c of oldBatch.cases) for(const r of c.reports) r.text='中文参考译文\n示例\n\n英文原文\n'+r.text;
  sqlite.prepare('UPDATE web_batches SET manifest=? WHERE prefix=?').run(JSON.stringify(oldBatch),study.prefix);
  const resumed=await call(endpoint,'a',study);
  assert.equal(resumed.status,200,resumed.body.error);assert.equal(resumed.body.existing,true);
  assert.equal((await call(caseUrl,'c')).status,404);
  assert.equal((await call(caseUrl+'/image','c')).status,404);
  const {body}=await call(caseUrl,'b');
  assert.equal(body.imaging.drive_url,'https://drive.google.com/file/d/private_file_01/view?resourcekey=0-safe');
  assert.equal(body.imaging.sha256,scan.sha256);
  assert.equal(body.imaging.size,500);
  assert.ok(body.reports.every(report=>!Object.hasOwn(report,'model_name')));
  assert.equal((await call(caseUrl+'/image','b')).status,409);
  assert.equal((await call(endpoint,'a',{...study,cases:[{...scan,drive_url:scan.drive_url.replace('file_01','file_02')}]})).status,409);
  assert.equal((await call('/admin/enrollment','a',{username:'c',prefix:study.prefix})).status,200);
  const scores=reports.map(r=>({letter:r.letter,rating:4,comment:''}));
  assert.equal((await call(caseUrl+'/ratings','b',{revision:body.revision,ratings:scores})).status,200);
  const other=(await call(caseUrl,'c')).body;
  assert.equal(other.imaging.drive_url,body.imaging.drive_url);
  assert.ok(other.reports.every(report=>report.rating===null));
  assert.equal((await call('/admin/cases/Drive-Case01/editor','a')).body.locked,true);
});
test('Drive fallback relays only matching, bounded bytes of an assigned, publicly enabled case',async t=>{
  const sqlite=new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const env={DB:database(sqlite),DRIVE_MEDIA_KEY:'test-only-drive-key'};
  for(const name of ['assigned','unassigned']){
    sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(name,'doctor','fixture','stamp');
    sqlite.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').run(await digest(name),name,'doctor','stamp',20000000000);
  }
  const id='Review-Case01',fileId='public_file_01',size=5*1024*1024;
  sqlite.exec("INSERT INTO web_batches VALUES('batch','Review','{}','published'); INSERT INTO public_studies VALUES('Review',1)");
  const imageKey='blind/Review/Case01/drive/'+'a'.repeat(64)+'/'+fileId+'?resourcekey=0-safe';
  sqlite.prepare('INSERT INTO private_cases VALUES(?,?,?,?,?)').run(id,'Test',imageKey,'scan.nii.gz',size);
  for(const letter of 'ABCD'){
    sqlite.prepare('INSERT INTO private_reports VALUES(?,?,?)').run(id,letter,'English test');
    sqlite.prepare('INSERT INTO assignments(username,case_id,letter,model_name,case_order) VALUES(?,?,?,?,?)').run('assigned',id,letter,letter,1);
  }
  const origin='https://jwang1402.github.io';
  const call=(token,range,method='GET',source={Origin:origin,Referer:origin+'/ct-report-review/?local=private'})=>worker.fetch(new Request('https://fixture.invalid/blind/cases/'+id+'/image',{
    method,headers:{...source,...(token&&{Authorization:'Bearer '+token}),...(range&&{Range:range})}
  }),env);
  const bytes=new Uint8Array([31,139]);
  let upstream;
  const relay=t.mock.method(globalThis,'fetch',async(input,init)=>{
    const url=new URL(input);
    assert.equal(url.origin,'https://www.googleapis.com');
    assert.equal(url.pathname,'/drive/v3/files/'+fileId);
    assert.equal(url.searchParams.get('alt'),'media');
    assert.equal(url.searchParams.has('access_token'),false);
    assert.equal(init.redirect,'manual');
    assert.equal(init.cache,'no-store');
    assert.equal(init.headers.get('X-Goog-Api-Key'),env.DRIVE_MEDIA_KEY);
    assert.equal(init.headers.get('X-Goog-Drive-Resource-Keys'),fileId+'/0-safe');
    assert.equal(init.headers.get('Authorization'),null);
    assert.equal(init.headers.get('Cookie'),null);
    return upstream;
  });
  assert.equal((await call(null,'bytes=0-1')).status,401);
  assert.equal((await call('unassigned','bytes=0-1')).status,404);
  for(const range of [undefined,'bytes=0-4194304','bytes=0-0,2-2']){
    const invalid=await call('assigned',range);
    assert.equal(invalid.status,416);
    assert.equal(invalid.headers.get('Content-Range'),'bytes */'+size);
  }
  assert.equal(relay.mock.callCount(),0);
  const interval='bytes 300-301/'+size;
  const part=(body=bytes,headers={},status=206)=>new Response(body,{status,headers:{'Content-Range':interval,...headers}});
  upstream=part();
  const valid=await call('assigned','bytes=300-301');
  assert.equal(valid.status,206);
  assert.deepEqual(new Uint8Array(await valid.arrayBuffer()),bytes);
  assert.equal(valid.headers.get('Content-Range'),interval);
  assert.equal(valid.headers.get('Content-Length'),'2');
  assert.equal(valid.headers.get('Access-Control-Allow-Origin'),origin);
  assert.match(valid.headers.get('Access-Control-Expose-Headers'),/Content-Range/);
  assert.match(valid.headers.get('Cache-Control'),/no-store/);
  assert.equal(valid.headers.get('X-Goog-Api-Key'),null);
  assert.equal(relay.mock.calls[0].arguments[1].headers.get('Range'),'bytes=300-301');
  const forwarded=()=>relay.mock.calls.at(-1).arguments[1].headers;
  assert.equal(forwarded().get('Origin'),origin);
  assert.equal(forwarded().get('Referer'),origin+'/');
  for(const source of [{Origin:origin},{Referer:origin+'/'},{Origin:origin,Referer:'https://elsewhere.invalid/'},{Origin:origin,Referer:'not a URL'},
    {Origin:'http://localhost:5173',Referer:'http://localhost:5173/'},{}]){
    upstream=part(); assert.equal((await call('assigned','bytes=300-301','GET',source)).status,206);
    assert.equal(forwarded().get('Origin'),null);
    assert.equal(forwarded().get('Referer'),null);
  }
  upstream=new Response('private diagnostic test-only-drive-key',{status:403});
  const forbidden=await call('assigned','bytes=300-301');
  assert.equal(forbidden.status,403);
  assert.deepEqual(await forbidden.json(),{error:'Google Drive denied access to this CT download.'});
  for(const bad of [new Response(bytes,{status:200}),part(bytes,{'Content-Range':'bytes 0-1/'+size}),
    part(bytes,{'Content-Range':'bytes 300-301/'+(size+1)}),part(bytes,{'Content-Length':'9'}),part(new Uint8Array(1)),
    part(new Uint8Array(3)),part(bytes,{'Content-Encoding':'gzip'}),part(bytes,{'Content-Type':'application/json'}),
    new Response(null,{status:302,headers:{Location:'https://other.invalid/private'}})]){
    upstream=bad;
    const result=await call('assigned','bytes=300-301');
    assert.equal(result.status,502);
    assert.doesNotMatch(await result.text(),/0-safe|test-only-drive-key|other.invalid/);
  }
  sqlite.prepare('UPDATE private_cases SET image_size=2 WHERE case_id=?').run(id);
  upstream=new Response(bytes,{headers:{'Content-Length':'2'}});
  const small=await call('assigned');
  assert.equal(small.status,200);
  assert.deepEqual(new Uint8Array(await small.arrayBuffer()),bytes);
  const before=relay.mock.callCount();
  delete env.DRIVE_MEDIA_KEY;
  assert.equal((await call('assigned','bytes=0-1')).status,503);
  sqlite.exec("UPDATE public_studies SET enabled=0 WHERE prefix='Review'");
  assert.equal((await call('assigned','bytes=0-1')).status,409);
  assert.equal(relay.mock.callCount(),before);
});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function storage(){
  const uploads=new Map(), objects=new Map();
  return {
    async head(key){return objects.has(key)?{size:objects.get(key).length}:null;},
    async get(key){
      const bytes=objects.get(key);
      return bytes?{size:bytes.length,body:new Blob([bytes]).stream()}:null;
    },
    async delete(key){objects.delete(key);},
    async createMultipartUpload(key){
      const id=crypto.randomUUID();uploads.set(id,new Map());
      return this.resumeMultipartUpload(key,id);
    },
    resumeMultipartUpload(key,id){
      return {uploadId:id,abort:async()=>uploads.delete(id),
        uploadPart:async(n,bytes)=>{
          const parts=uploads.get(id);
          if (!parts) throw Error('NoSuchUpload');
          parts.set(n,Buffer.from(bytes));return {partNumber:n,etag:hash(bytes)};
        },
        complete:async(items)=>{
          const parts=uploads.get(id);
          if (!parts) throw Error('NoSuchUpload');
          const data=items.map(({partNumber,etag})=>{const bytes=parts.get(partNumber);assert.equal(hash(bytes),etag);return bytes;});
          objects.set(key,Buffer.concat(data));uploads.delete(id);
        }};
    }
  };
}

test('admin uploads verified chunks, publishes atomically, edits before rating and enrolls readers on the shared key',async t=>{
  // The real Worker supplies a native streaming DigestStream; Node uses an incremental equivalent.
  const old=crypto.DigestStream;
  crypto.DigestStream=class extends WritableStream {
    constructor(){const h=createHash('sha256');let done;const p=new Promise(r=>done=r);
      super({write(chunk){h.update(chunk);},close(){done(h.digest());}});this.digest=p;}
  };
  t.after(()=>{if(old)crypto.DigestStream=old;else delete crypto.DigestStream;});
  const sqlite=new DatabaseSync(':memory:'); t.after(()=>sqlite.close());
  sqlite.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const env={DB:database(sqlite),IMAGES:storage()};
  const call=async(path,token,method='GET',data)=>{
    const binary=data instanceof Uint8Array;
    const response=await worker.fetch(new Request('https://unit.invalid'+path,{method,
      headers:{Authorization:'Bearer '+token,'Content-Type':binary?'application/octet-stream':'application/json'},
      body:data===undefined?undefined:binary?data:JSON.stringify(data)}),env);
    return {code:response.status,...(response.headers.get('Content-Type')?.startsWith('application/json')?await response.json():{})};
  };
  for (const [name,role] of [['a','admin'],['b','doctor'],['c','doctor']]){
    const salt='fixture', pass=await passwordHash('unused-test-password',salt);
    sqlite.prepare('INSERT INTO accounts VALUES(?,?,?,?)').run(name,role,salt,pass);
    sqlite.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').run(await digest(name),name,role,pass,20000000000);
  }
  const bytes=Buffer.alloc(8*1024**2+7,141);
  bytes[0]=0x1f;bytes[1]=0x8b;
  const reports='ABCD'.split('').map((letter,i)=>({letter,model_name:['morph','m3d','btb','ctchat'][i],text:'sample report '+i}));
  const manifest={prefix:'Test',cases:[{case_id:'Case01',case_name:'Admin display',size:bytes.length,sha256:hash(bytes),reports}]};
  const start=await call('/admin/batches','a','POST',manifest);
  assert.equal(start.code,200,start.error); const base='/admin/batches/'+start.batch_id;
  assert.equal(start.images.length,1);
  assert.equal((await call('/admin/batches','b','POST',manifest)).code,403);
  assert.equal((await call('/admin/batches','a','POST',manifest)).batch_id,start.batch_id);
  const conflicting=structuredClone(manifest);conflicting.cases[0].reports[0].text+=' edited';
  assert.equal((await call('/admin/batches','a','POST',conflicting)).code,409);
  assert.deepEqual((await call('/blind/cases','a')).cases,[]);
  assert.equal((await call(base+'/publish','a','POST',{doctors:['b']})).code,409);
  const image=base+'/images/Case01';
  assert.equal((await call(image+'/parts/1','a','PUT',bytes.subarray(0,3))).code,400);
  assert.equal((await call(image+'/parts/1','b','PUT',bytes.subarray(0,start.part_size))).code,403);
  assert.equal((await call(image+'/parts/1','a','PUT',bytes.subarray(0,start.part_size))).code,200);
  assert.equal((await call(image+'/parts/1','a','PUT',bytes.subarray(0,start.part_size))).code,200);
  assert.deepEqual((await call(base,'a')).images[0].parts,[1]);
  assert.equal((await call(image+'/complete','a','POST')).code,409);
  assert.equal((await call(image+'/parts/2','a','PUT',Buffer.alloc(7,0))).code,200);
  assert.equal((await call(image+'/complete','a','POST')).code,422);
  assert.deepEqual((await call(base,'a')).images[0].parts,[]);
  for (const n of [2,1]) {
    const res=await call(image+'/parts/'+n,'a','PUT',bytes.subarray((n-1)*start.part_size,n*start.part_size));
    assert.equal(res.code,200,res.error);
  }
  for (let i=0;i<2;i++) assert.equal((await call(image+'/complete','a','POST')).code,200);
  assert.equal((await call(base,'a')).images[0].ready,true);
  assert.equal((await call(base+'/publish','a','POST',{doctors:['unknown']})).code,400);
  assert.deepEqual((await call('/blind/cases','a')).cases,[]);
  for (let i=0;i<2;i++){
    const res=await call(base+'/publish','a','POST',{doctors:['b']});assert.equal(res.code,200,res.error);
  }
  const detail='/blind/cases/Test-Case01';
  const before=await call(detail,'b'); assert.equal(before.reports[0].text,'sample report 0');
  const oldText='中文参考译文\r\n测试\r\n\r\n英文原文\r\nsample report 1';
  sqlite.prepare('UPDATE private_reports SET report_text=? WHERE case_id=? AND model_name=?').run(oldText,'Test-Case01','M3D-LaMed-Phi-3-4B');
  sqlite.prepare('UPDATE private_cases SET case_name=? WHERE case_id=?').run('测试','Test-Case01');
  for (const role of ['a','b']) assert.equal((await call(detail,role)).reports[1].text,'sample report 1');
  const edit='/admin/cases/Test-Case01/editor';
  assert.equal((await call(edit,'b')).code,403);
  const dto=await call(edit,'a');
  assert.equal(dto.reports[0].model_name,'MORPH-CT');
  assert.equal(dto.reports[1].text,'sample report 1');
  assert.equal(dto.case_name,'Test-Case01');
  const changes={reports:dto.reports,case_name:dto.case_name,revision:dto.revision};
  changes.reports[0].text='revised report';
  const applied=await call(edit,'a','POST',changes);
  assert.equal(applied.code,200,applied.error);
  assert.equal(sqlite.prepare('SELECT report_text FROM private_reports WHERE case_id=? AND model_name=?').get('Test-Case01','M3D-LaMed-Phi-3-4B').report_text,oldText);
  assert.equal(sqlite.prepare('SELECT case_name FROM private_cases WHERE case_id=?').get('Test-Case01').case_name,'测试');
  assert.notEqual(applied.revision,before.revision);
  assert.equal((await call(edit,'a','POST',changes)).code,409);
  const form={ratings:reports.map(r=>({letter:r.letter,rating:4,comment:''})),revision:before.revision};
  assert.equal((await call(detail+'/ratings','b','POST',form)).code,409);
  const fresh=await call(detail,'b');
  assert.equal(fresh.case_name,'Test-Case01');assert.equal(fresh.reports[0].text,'revised report');
  assert.ok(fresh.reports.every(r=>r.rating===null && !Object.hasOwn(r,'model_name')));
  form.revision=fresh.revision;
  assert.equal((await call(detail+'/ratings','b','POST',form)).code,200);
  assert.equal((await call(edit,'a')).locked,true);
  assert.equal((await call(edit,'a','POST',{...changes,revision:fresh.revision})).code,409);
  assert.equal((await call('/admin/enrollment','a','POST',{prefix:'Test',username:'c'})).code,200);
  const other=await call(detail,'c');
  assert.deepEqual(other.reports.map(r=>r.text),fresh.reports.map(r=>r.text));
  assert.ok(other.reports.every(r=>r.rating===null));
  assert.equal((await call('/admin/results','b')).code,403);
  // The standard browser importer freezes each source-part digest so completion
  // can authenticate the composed image without a full-volume read in the Worker.
  const second=structuredClone(manifest);second.prefix='PartHashed';
  const p1=bytes.subarray(0,start.part_size), p2=bytes.subarray(start.part_size);
  second.cases[0].part_sha256=[hash(p1),hash(p2)];
  const next=await call('/admin/batches','a','POST',second);
  assert.equal(next.code,200,next.error);
  const img='/admin/batches/'+next.batch_id+'/images/Case01';
  assert.equal((await call(img+'/parts/2','a','PUT',Buffer.alloc(7))).code,422);
  assert.equal((await call(img+'/parts/1','a','PUT',p1)).code,200);
  assert.equal((await call(img+'/parts/2','a','PUT',p2)).code,200);
  const saveGet=env.IMAGES.get;
  env.IMAGES.get=async()=>{throw Error('Should only check metadata and part hashes');};
  assert.equal((await call(img+'/complete','a','POST')).code,200);
  env.IMAGES.get=saveGet;

});

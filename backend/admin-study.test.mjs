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
  const edit='/admin/cases/Test-Case01/editor';
  assert.equal((await call(edit,'b')).code,403);
  const dto=await call(edit,'a');
  assert.equal(dto.reports[0].model_name,'MORPH-CT');
  const changes={reports:dto.reports,case_name:'New display',revision:dto.revision};
  changes.reports[0].text='revised report';
  const applied=await call(edit,'a','POST',changes);
  assert.equal(applied.code,200,applied.error);
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

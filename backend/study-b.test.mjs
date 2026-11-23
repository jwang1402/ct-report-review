import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {routeStudyB,studyBImage} from './study-b.mjs';
import {findings} from './study-a.mjs';
import {summarizeStudyB} from './study-b-analysis.mjs';

function fixture(t) {
  const sql=new DatabaseSync(':memory:');
  t.after(()=>sql.close());
  sql.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
  const db={prepare(query){const stmt=sql.prepare(query);let bindings=[];
    return {bind(...a){bindings=a;return this;},async first(){return stmt.get(...bindings)??null;},
      async all(){return {results:stmt.all(...bindings)};},async run(){return stmt.run(...bindings);}};}};
  const path='/study-b', adminPath='/admin/study-b';
  const admin={username:'administrator',role:'admin'};
  const cases=Array.from({length:10},(_,i)=>({case_id:'B'+String(i+1).padStart(2,'0'),size:4096+i,
    sha256:(i+1).toString(16).padStart(64,'0'),drive_url:'https://drive.google.com/file/d/SyntheticDrive'+i+'/view?resourcekey=demo',
    draft:'Synthetic draft '+i,reference:'Independent assessment '+i,reference_findings:[{id:'n',description:'Synthetic finding'}],
    draft_errors:[{id:'d',description:'Draft finding unsupported'}]}));
  let now=100000;
  const user=(id,cohort)=>{
    sql.prepare("INSERT INTO accounts VALUES(?,'doctor','','')").run(id);
    return {username:id,cohort,role:'doctor',name_confirmed_at:now};
  };
  const call=(actor,method,url,data)=>routeStudyB(url,{method},actor,db,{now,jsonBody:async()=>data});
  const configure=(version,freeze,data=cases)=>call(admin,'PUT',adminPath,{version,freeze,cases:data});
  const fail=(work,status)=>assert.rejects(work,e=>e.status===status);
  const answers=Object.fromEntries(findings.map(k=>[k,{present:false,side:'na'}]));
  return {sql,db,path,adminPath,admin,cases,user,call,configure,fail,answers,clock:n=>{now=n;}};
}

test('private cohort draft and atomic freeze; duplicate CT files and checksums rejected',async t=>{
  const {cases,path,adminPath,db,sql,user,call,fail,configure}=fixture(t),u=user('read','junior');
  assert.equal((await call(u,'GET',path)).status,'not_ready');
  await fail(call(u,'GET',adminPath),403);
  assert.equal(await routeStudyB('/other',{method:'GET'},u,db,{}),null);
  await fail(configure(0,true,cases.slice(1)),400);
  assert.equal((await configure(0,false,[{case_id:'B01'}])).version,1);
  await fail(configure(0,true),409);
  await fail(configure(1,true,cases.map((c,i)=>i===1?{...c,drive_url:cases[0].drive_url.split('?')[0]}:c)),400);
  await fail(configure(1,true,cases.map((c,i)=>i===1?{...c,sha256:cases[0].sha256}:c)),400);
  sql.prepare('INSERT INTO private_cases VALUES(?,?,?,?,?)').run('BR4shared-Case01','Case 01','blind/BR4shared/Case01/drive/'+cases[0].sha256+'/AnOriginalStudyFile','demo.nii.gz',4096);
  sql.prepare('INSERT INTO private_reports VALUES(?,?,?)').run('BR4shared-Case01','MORPH-CT','demo');
  sql.prepare('INSERT INTO shared_case_letters VALUES(?,?,?,?)').run('BR4shared-Case01','A','MORPH-CT',1);
  await fail(configure(1,true),400);
  const modified=cases.map((c,i)=>i===0?{...c,sha256:'e'.repeat(64)}:c);
  await configure(1,true,modified);
  await fail(configure(2,false,modified),409);
});

test('descriptive analysis pairs case/reader, accounts for draft error opportunities and zero denominators',()=>{
  const cases=[{case_id:'B01'},{case_id:'B02'}];
  const rows=[];
  for(const username of ['j1','j2','j3','s1','s2']){
    const junior=username.startsWith('j');
    for(const condition of junior?['with_ai','without_ai']:['without_ai']){
      const ai=condition==='with_ai', decisions=Object.fromEntries(findings.map(f=>[f,{present:false,side:'na'}]));
      decisions.lung_nodule={present:true,side:ai||username!=='j3'?'left':'right'};
      decisions.cardiomegaly={present:!ai&&username==='j3',side:'na'};
      const errors=ai?[{type:'missed',reference_id:'key',significant:true}]:[];
      rows.push({username,case_id:'B01',cohort:junior?'junior':'senior',period:ai?1:(junior?2:1),condition,
        submitted_at:'time',elapsed_seconds:ai?60:120,findings:decisions,reference_findings:[{id:'key'}],draft_errors:[{id:'d1'},{id:'d2'}],
        assessment:{errors,accepted_draft_errors:ai?['d1']:[]}});
    }
  }
  rows.push({...rows[0],case_id:'B02',assessment:null}); // no matching read
  const a=summarizeStudyB(rows,cases);
  assert.equal(a.efficiency.complete_reader_case_pairs,3);
  assert.equal(a.efficiency.change_in_medians_percent,-50);assert.equal(a.efficiency.median_with_minus_without_minutes,-1);
  assert.equal(a.agreement.paired_cases_with_all_three_juniors,1);
  assert.equal(a.agreement.per_finding.lung_nodule.with_ai.fleiss_kappa,null);
  assert.equal(a.agreement.per_finding.cardiomegaly.without_ai.unanimous_fraction,0);
  assert.equal(a.agreement.pooled_case_finding.without_ai.unanimous,17);
  assert.equal(a.agreement.laterality_all_six_reads_positive_and_side_specified.without_ai.pairwise_agreement,1/3);
  assert.equal(a.junior_with_ai_vs_senior_without.cases_with_all_five_assessments,1);
  assert.equal(a.paired_junior_errors.with_ai.draft_error_opportunities,6);
  assert.equal(a.paired_junior_errors.with_ai.accepted_fraction,0.5);
  assert.equal(a.paired_junior_errors.without_ai.accepted_fraction,null);
  assert.equal(a.junior_with_ai_vs_senior_without.junior.significant_errors_per_report,1);
  assert.equal(a.junior_with_ai_vs_senior_without.senior.missed_fraction,0);
  const extraJunior={...rows[0],username:'extra'};
  const incomplete=summarizeStudyB([...rows,{...extraJunior,submitted_at:null}],cases);
  assert.equal(incomplete.agreement.paired_cases_with_all_three_juniors,1);
  const withExtra=[...rows,extraJunior];
  assert.equal(summarizeStudyB(withExtra,cases).roster.selection_required,true);
  const selected=summarizeStudyB(withExtra,cases,{juniors:['j1','j2','j3'],seniors:['s1','s2']});
  assert.deepEqual(selected.efficiency,a.efficiency);
  assert.deepEqual(selected.agreement,a.agreement);
  assert.deepEqual(selected.paired_junior_errors,a.paired_junior_errors);
  assert.deepEqual(selected.junior_with_ai_vs_senior_without,a.junior_with_ai_vs_senior_without);
});

test('three junior schedules are balanced, first opening starts timer, draft and final writes are versioned; second period enforces name re-entry and flips exposure',async t=>{
  const {db,sql,cases,path,adminPath,admin,call,user,fail,clock,answers,configure}=fixture(t);
  await configure(0,true);
  const assignments=new Map();
  const first=user('j1','junior'), second=user('j2','junior'), third=user('j3','junior'), senior=user('s1','senior');
  const visitor=user('inactive','junior');
  await call(visitor,'GET',path);
  assert.equal(sql.prepare('SELECT count(*) n FROM study_b_readers').get().n,0);
  let timedId;
  for(const u of [first,second,third,senior]){
    const list=await call(u,'GET',path);assert.equal(list.status,'ready');
    const arms={};
    await fail(studyBImage(db,u,'B01',100000),403);
    for(const [idx,c] of list.cases.entries()){
      const url=path+'/cases/'+c.case_id;
      const r=await call(u,'POST',url+'/open',{period:1});
      arms[c.case_id]=r.condition;
      assert.equal(r.report,r.condition==='with_ai'?cases.find(row=>row.case_id===c.case_id).draft:'');
      assert.equal(Object.hasOwn(r,'draft'),r.condition==='with_ai');
      assert.ok(!Object.hasOwn(r,'reference')&&!Object.hasOwn(r,'draft_errors'));
      let version=0;
      if(idx===0&&u===first){
        timedId=c.case_id;clock(100100);
        await fail(call(u,'POST',path+'/cases/'+list.cases[1].case_id+'/open',{period:1}),409);
        const draft={period:1,version,report:'My independent report.',findings:{},submit:false};
        assert.equal((await call(first,'PUT',url,draft)).version,1);
        const re=await call(first,'POST',url+'/open',{period:1});
        assert.equal(re.report,draft.report);assert.equal(re.started_at,new Date(100000000).toISOString());
        await fail(call(first,'PUT',url,{...draft,report:'Different stale text'}),409);
        await fail(call(first,'PUT',url,{...draft,version:1,submit:true}),400);version=1;
      }
      const final={period:1,version,report:'First-period findings.',findings:answers,submit:true};
      const result=await call(u,'PUT',url,final);assert.ok(result.submitted);
      assert.deepEqual(await call(u,'PUT',url,final),result);
    }
    assignments.set(u,arms);
    assert.equal(Object.values(arms).filter(a=>a==='with_ai').length,u===senior?0:5);
  }
  for(const c of cases){
    const counts=[first,second,third].filter(u=>assignments.get(u)[c.case_id]==='with_ai').length;
    assert.ok(counts===1 || counts===2);
  }
  const without=Object.keys(assignments.get(first)).find(id=>assignments.get(first)[id]==='without_ai');
  const url=path+'/cases/'+without;
  assert.equal((await call(first,'GET',path)).status,'washout');
  await fail(call(first,'POST',url+'/open',{period:2}),409);
  const last=100100+28*86400;
  clock(last-1);assert.equal((await call(first,'GET',path)).status,'washout');
  clock(last);assert.equal((await call(first,'GET',path)).status,'confirm_name');
  first.name_confirmed_at=last;
  const list=await call(first,'GET',path);
  assert.equal(list.period,2);assert.ok(list.cases.every(c=>!c.started&&!c.submitted));
  await fail(call(first,'POST',url+'/open',{period:1}),409);
  for(const c of cases){
    const url2=path+'/cases/'+c.case_id;
    const ref=await call(first,'POST',url2+'/open',{period:2});
    assert.notEqual(ref.condition,assignments.get(first)[c.case_id]);
    assert.ok(!JSON.stringify(ref).includes('First-period findings.'));
    await call(first,'PUT',url2,{period:2,version:0,report:'Second report.',findings:answers,submit:true});
  }
  assert.equal((await call(first,'GET',path)).status,'complete');
  assert.equal((await call(senior,'GET',path)).status,'complete');
  await fail(call(senior,'POST',url+'/open',{period:2}),409);
  const unassisted={username:first.username,case_id:without,period:1,errors:[],accepted_draft_errors:[],version:0};
  await fail(call(admin,'PUT',adminPath+'/assessment',{...unassisted,accepted_draft_errors:['d']}),400);
  await fail(call(admin,'PUT',adminPath+'/assessment',{...unassisted,errors:[{type:'missed',significant:true,finding:'n'}]}),400);
  await call(admin,'PUT',adminPath+'/assessment',unassisted);
  await fail(call(admin,'PUT',adminPath+'/assessment',unassisted),409);
  const others=await Promise.allSettled(['B01','B02'].map(id=>call(visitor,'POST',path+'/cases/'+id+'/open',{period:1})));
  assert.equal(others.filter(v=>v.status==='fulfilled').length,1);
  assert.equal(others.find(v=>v.status==='rejected').reason.status,409);
  const adminList=await call(admin,'GET',adminPath+'/results');
  assert.equal(adminList.readings.find(r=>r.username===first.username&&r.case_id===timedId&&r.period===1).elapsed_seconds,100);
  assert.equal(adminList.readings.find(r=>r.username===first.username&&r.case_id===without&&r.period===1).assessment.errors.length,0);
  assert.equal(adminList.analysis.roster.selection_required,false);
  const senior2=user('s2','senior');await call(senior2,'POST',path+'/cases/B01/open',{period:1});
  const chosen={juniors:['j1','j2','j3'],seniors:['s1','s2']};
  const custom=await call(admin,'POST',adminPath+'/analysis',chosen);
  assert.deepEqual(custom.analysis.roster.juniors,chosen.juniors);
  await fail(call(first,'POST',adminPath+'/analysis',chosen),403);
  await fail(call(admin,'POST',adminPath+'/analysis',{...chosen,juniors:['j1','j2','s2']}),400);
});

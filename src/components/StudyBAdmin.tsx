import {useEffect,useRef,useState} from 'react';
import {Check,Download,FolderOpen,LockKeyhole,Plus,RefreshCw,Upload,X} from 'lucide-react';
import {api} from '../services/session';
import {useStudyData} from '../services/blindStudy';
import {hashBlob} from '../services/fileHash';
import {verifyPublicDriveCase} from '../services/publicDriveMedia';
import {message,saveFile} from '../utils';
import {blankCase,errorLabels,sessionDate,type Assessment,type CaseConfig,type CaseEntry,type Configuration,type RecordedError,type ResultReading,type Results} from '../services/studyB';
import {caseIds,readConfiguration} from '../services/studyBImport';
import {findingNames,findings} from '../services/studyAReview';
import {StudyBAnalysis,type StudyBAnalysisData} from './StudyBAnalysis';
import './StudyB.css';

function exportJSON(data:unknown,name:string){saveFile(JSON.stringify(data,null,2),name+'.json','application/json');}
function useWarn(dirty:boolean){
  useEffect(()=>{if(!dirty)return;
    const before=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
    const navigate=(e:MouseEvent)=>{
      const target=e.target instanceof Element?e.target.closest('a[href],button[data-sb-tab]'):null;
      if(!target||target.getAttribute('aria-pressed')==='true'||target.getAttribute('target')==='_blank')return;
      if(!window.confirm('Leave and discard unsaved changes?')){
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload',before);
    document.addEventListener('click',navigate,true);
    return ()=>{
      window.removeEventListener('beforeunload',before);
      document.removeEventListener('click',navigate,true);
    };
  },[dirty]);
}
function EntryList({title,prefix,items,change,readOnly}:{title:string;prefix:string;items:CaseEntry[];change:(v:CaseEntry[])=>void;readOnly:boolean}) {
  function add(){
    let n=1;while(items.some(x=>x.id===prefix+n))n++;
    change([...items,{id:prefix+n,description:''}]);
  }
  return <div><h3>{title} ({items.length})</h3>{items.map((x,i)=><div className="sb-repeat" key={i}>
    <label>Item ID<input value={x.id} maxLength={60} readOnly={readOnly} onChange={e=>change(items.map((v,j)=>j===i?{...v,id:e.target.value}:v))}/></label>
    <label>Description<input value={x.description} maxLength={1000} readOnly={readOnly} onChange={e=>change(items.map((v,j)=>j===i?{...v,description:e.target.value}:v))}/></label>
    {!readOnly&&<button className="button secondary" type="button" aria-label={'Remove '+x.id} onClick={()=>change(items.filter((_,j)=>j!==i))}><X size={14}/></button>}
  </div>)}{!readOnly&&<button type="button" className="button secondary" onClick={add} disabled={items.length>=64}><Plus size={14}/>Add item</button>}</div>;
}

function ConfigEditor({data,reload}:{data:Configuration;reload:()=>void}) {
  const [rows,setRows]=useState<CaseConfig[]>(data.cases);
  const [id,select]=useState('B01');
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [verified,setVerified]=useState<Record<string,string>>({});
  const operations=useRef<AbortController|null>(null);
  useEffect(()=>()=>operations.current?.abort(),[]);
  useWarn(dirty);
  const frozen=data.status==='frozen';
  const row=rows.find(x=>x.case_id===id)??blankCase(id);
  function update(patch:Partial<CaseConfig>){
    const next={...row,...patch};
    setRows(r=>[...r.filter(x=>x.case_id!==id),next].sort((a,b)=>a.case_id.localeCompare(b.case_id)));
    setDirty(true);setNotice('');setError('');
  }
  async function save(freeze:boolean){
    if(freeze&&!window.confirm('Freeze these 10 cases, reference findings, and model drafts and open Study B to readers?'))return;
    setBusy(true);setError('');
    try{await api('/admin/study-b',{method:'PUT',body:JSON.stringify({version:data.version,cases:rows,freeze})});setDirty(false);reload();}
    catch(e){setError(message(e));}finally{setBusy(false);}
  }
  async function inspect(file:File){
    setBusy(true);setError('');setNotice('Reading CT file…');
    const abort=new AbortController();operations.current=abort;
    try{if(!/\.nii\.gz$/i.test(file.name)||file.size<3||file.size>=2**31)throw new Error('Choose a compressed NIfTI (.nii.gz) smaller than 2 GiB.');
      const sha256=await hashBlob(file,abort.signal,p=>setNotice('Reading CT file · '+p+'%'));
      update({size:file.size,sha256});setNotice('CT size and checksum filled in.');
    }catch(e){if(!abort.signal.aborted)setError(message(e));}finally{if(!abort.signal.aborted)setBusy(false);}
  }
  async function verify(){
    setBusy(true);setError('');setNotice('Checking public CT access…');
    const abort=new AbortController();operations.current=abort;
    try{
      await verifyPublicDriveCase(row.drive_url,row,abort.signal);
      setVerified(v=>({...v,[id]:[row.drive_url,row.size,row.sha256].join('|')}));setNotice('Public download and file identity verified.');
    }catch(e){if(!abort.signal.aborted){setNotice('');setError(message(e));}}finally{if(!abort.signal.aborted)setBusy(false);}
  }
  async function importFile(file:File){
    try{
      if(file.size>3*1024**2)throw new Error('Choose a Study B configuration under 3 MiB.');
      const next=readConfiguration(await file.text());
      if((rows.length||dirty)&&!window.confirm('Replace the local case configuration with this file? Changes take effect when saved.'))return;
      setRows(next);select(next[0]?.case_id??'B01');setDirty(true);setError('');setNotice('Configuration loaded. Save draft or freeze when ready.');
    }catch(e){setError(message(e));}
  }
  return <section className="work-card"><div className="sb-subhead"><div><h2>Case configuration</h2>
    <p className="sb-hint">{frozen?'Frozen for data collection.':'Prepare 10 de-identified chest CT examinations with an independent expert reference.'}</p></div>
    <span className="badge">{frozen?'Frozen':rows.length+' / 10 configured'}</span></div>
    <fieldset className="sb-admin-fields" disabled={busy}>
      <div className="sb-admin-tools">
        <button className="button secondary" onClick={()=>exportJSON({cases:frozen||rows.length?rows:caseIds.map(blankCase)},'study-b-configuration')}><Download size={14}/>{rows.length?'Export configuration':'Download template'}</button>
        {!frozen&&<label className="button secondary"><Upload size={14}/>Import JSON<input type="file" className="file-hidden" accept=".json,application/json" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void importFile(f);}}/></label>}
      </div>
      <label className="sb-compact">Examination<select value={id} onChange={e=>{select(e.target.value);setError('');setNotice('');}}>{caseIds.map(x=><option key={x}>{x}</option>)}</select></label>
      <label>CT file link<input value={row.drive_url} placeholder="Google Drive file URL" readOnly={frozen} onChange={e=>update({drive_url:e.target.value})}/></label>
      <div className="sb-admin-grid"><label>Size (bytes)<input type="number" min="0" value={row.size||''} readOnly={frozen} onChange={e=>update({size:Number(e.target.value)})}/></label>
      <label>SHA-256<input value={row.sha256} readOnly={frozen} maxLength={64} onChange={e=>update({sha256:e.target.value.trim().toLowerCase()})}/></label></div>
      <div className="actions">{!frozen&&<label className="button secondary"><FolderOpen size={14}/>Read size and checksum from CT<input type="file" accept=".gz" className="file-hidden" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void inspect(f);}}/></label>}
      <button type="button" className="button secondary" disabled={!row.drive_url||!row.size||!row.sha256} onClick={()=>void verify()}><Check size={14}/>Verify CT link</button>
      {verified[id]===[row.drive_url,row.size,row.sha256].join('|')&&<span className="badge">Verified</span>}</div>
      <label>MORPH-CT draft<textarea rows={5} maxLength={48000} value={row.draft} readOnly={frozen} onChange={e=>update({draft:e.target.value})}/></label>
      <label>Independent expert reference<textarea rows={5} maxLength={48000} value={row.reference} readOnly={frozen} onChange={e=>update({reference:e.target.value})}/></label>
      <EntryList title="Reference key findings" prefix="ref-" items={row.reference_findings} change={v=>update({reference_findings:v})} readOnly={frozen}/>
      <EntryList title="Errors in the original draft" prefix="err-" items={row.draft_errors} change={v=>update({draft_errors:v})} readOnly={frozen}/>
      {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!frozen&&<div className="sb-admin-tools"><button type="button" className="button secondary" disabled={!dirty} onClick={()=>void save(false)}>Save configuration draft</button>
      <button type="button" className="button primary" disabled={rows.length!==10} onClick={()=>void save(true)}><LockKeyhole size={14}/>Freeze and open study</button></div>}
    </fieldset></section>;
}

function ConfigTab(){
  const {data,error,refresh}=useStudyData<Configuration>('/admin/study-b');
  if(!data)return <p role={error?'alert':'status'}>{error??'Loading configuration…'} {error&&<button className="button secondary" onClick={refresh}>Retry</button>}</p>;
  return <ConfigEditor key={data.version} data={data} reload={refresh}/>;
}

function AssessmentForm({reading,c,onDone}:{reading:ResultReading;c:CaseConfig;onDone:()=>void}) {
  const original=reading.assessment;
  const [errors,setErrors]=useState<RecordedError[]>(original?.errors??[]);
  const [accepted,setAccepted]=useState<string[]>(original?.accepted_draft_errors??[]);
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
  const [messageText,setMessage]=useState('');
  useWarn(dirty);
  function update(i:number,e:Partial<RecordedError>){
    setErrors(rows=>rows.map((r,j)=>i===j?{...r,...e}:r));setDirty(true);
  }
  async function save(){
    if(errors.some(e=>!e.finding.trim()||(e.type==='missed'&&!e.reference_id))){setMessage('Identify the affected finding for every error. Link missed findings to a reference item.');return;}
    setBusy(true);setMessage('');
    try{await api('/admin/study-b/assessment',{method:'PUT',body:JSON.stringify({
      username:reading.username,case_id:reading.case_id,period:reading.period,version:original?.version??0,
      errors:errors.map(e=>({...e,finding:e.finding.trim()})),accepted_draft_errors:accepted
    })});setDirty(false);onDone();}
    catch(e){setMessage(message(e));}finally{setBusy(false);}
  }
  const name=reading.display_name||reading.username;
  return <section className="work-card sb-admin-assess"><div className="sb-subhead"><h2>{reading.case_id} · {name}</h2>
    <span className="badge">Session {reading.period}</span></div><fieldset className="sb-admin-fields" disabled={busy}>
      <div className="sb-admin-grid"><div><h3>Final reader report</h3><pre>{reading.report}</pre></div>
      <div><h3>Independent expert reference</h3><pre>{c.reference}</pre></div></div>
      {c.reference_findings.length>0&&<div><h3>Reference key findings</h3><ul>{c.reference_findings.map(f=><li key={f.id}>{f.description}</li>)}</ul></div>}
      <details><summary>Reader's structured findings</summary><dl>{findings.map(f=><div key={f}><dt>{findingNames[f]}</dt><dd>{reading.findings[f]?.present?'Present · '+reading.findings[f]!.side:reading.findings[f]?'Absent':'—'}</dd></div>)}</dl></details>
      {reading.condition==='with_ai'&&<details><summary>Original MORPH-CT draft</summary><pre>{c.draft}</pre></details>}
      <div><h3>Errors in the final reader report ({errors.length})</h3>
        {errors.map((e,i)=><div className="sb-error-item" key={i}>
          <div className="sb-admin-grid"><label>Error type<select value={e.type} onChange={v=>update(i,{type:v.target.value as RecordedError['type']})}>
            {Object.entries(errorLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
            <label>Reference item{e.type!=='missed'?' (optional)':''}<select value={e.reference_id??''} onChange={ev=>{
              const selected=c.reference_findings.find(f=>f.id===ev.target.value);
              update(i,{reference_id:selected?.id,finding:selected?selected.description.slice(0,120):e.finding});
            }}><option value="">Choose reference item</option>{c.reference_findings.map(f=><option key={f.id} value={f.id}>{f.description}</option>)}</select></label></div>
          <label>Affected finding<input value={e.finding} maxLength={120} onChange={v=>update(i,{finding:v.target.value})}/></label>
          <label>Details (optional)<textarea rows={2} value={e.detail} maxLength={1000} onChange={v=>update(i,{detail:v.target.value})}/></label>
          <label className="sb-checkbox"><input type="checkbox" checked={e.significant} onChange={v=>update(i,{significant:v.target.checked})}/>Clinically significant</label>
          <div><button className="button secondary" onClick={()=>{setErrors(errors.filter((_,j)=>j!==i));setDirty(true);}}>Remove error</button></div>
        </div>)}
        <button type="button" className="button secondary" onClick={()=>{setErrors([...errors,{finding:'',type:'unsupported',significant:false,detail:''}]);setDirty(true);}}><Plus size={14}/>Add error</button>
      </div>
      {reading.condition==='with_ai'&&<div><h3>Draft errors retained in the final report</h3>{c.draft_errors.length?c.draft_errors.map(d=>
        <label className="sb-checkbox" key={d.id}><input type="checkbox" checked={accepted.includes(d.id)} onChange={v=>{
          setAccepted(v.target.checked?[...accepted,d.id]:accepted.filter(id=>id!==d.id));setDirty(true);
        }}/>{d.description}</label>):<p>No errors were identified in this case's frozen draft.</p>}</div>}
      {messageText&&<p role="alert" className="error">{messageText}</p>}
      <div className="sb-admin-tools"><button className="button secondary" onClick={()=>{if(!dirty||window.confirm('Discard unsaved assessment changes?'))onDone();}}>Close</button>
        <button className="button primary" disabled={busy||(!dirty&&!!original)} onClick={()=>void save()}>Save assessment</button></div>
    </fieldset></section>;
}
function ResultsTab(){
  const {data,error,refresh}=useStudyData<Results&{analysis?:StudyBAnalysisData}>('/admin/study-b/results');
  const [selected,setSelected]=useState<ResultReading|null>(null);
  if(!data)return <p role={error?'alert':'status'}>{error??'Loading readings…'} {error&&<button className="button secondary" onClick={refresh}>Retry</button>}</p>;
  if(selected){
    const c=data.cases.find(x=>x.case_id===selected.case_id);
    if(c)return <AssessmentForm key={[selected.username,selected.period,selected.case_id].join('/')} c={c} reading={selected} onDone={()=>{setSelected(null);refresh();}}/>;
  }
  const submitted=data.readings.filter(r=>r.submitted_at);
  return <><section className="work-card"><div className="sb-subhead"><div><h2>Readings and assessments</h2>
    <p className="sb-hint">{submitted.length} submitted · {submitted.filter(r=>r.assessment).length} assessed</p></div>
    <div className="actions"><button className="button secondary" onClick={refresh}><RefreshCw size={14}/>Refresh</button>
    <button className="button secondary" disabled={!submitted.length} onClick={()=>exportJSON(data,'study-b-private-results')}><Download size={14}/>Export results</button></div></div>
    {data.readings.length?<div className="table-scroll"><table className="sb-assessment-list"><thead><tr><th>Reader</th><th>Case</th><th>Session</th><th>Condition</th><th>Time</th><th>Assessment</th></tr></thead>
      <tbody>{data.readings.map(r=><tr key={[r.username,r.period,r.case_id].join('/')}><td>{r.display_name||r.username}<small> · {r.cohort}</small></td>
        <td>{r.case_id}</td><td>{r.period}</td><td>{r.condition==='with_ai'?'With AI':'Without AI'}</td>
        <td>{r.elapsed_seconds!=null?(r.elapsed_seconds/60).toFixed(1)+' min':'In progress'}</td>
        <td>{r.submitted_at?<button className="button secondary" onClick={()=>setSelected(r)}>{r.assessment?'View assessment':'Assess reading'}</button>:'—'}</td>
      </tr>)}</tbody></table></div>:<p className="sb-admin-note">No readings have started.</p>}
  </section>{submitted.length>0&&<StudyBAnalysis readings={data.readings} overall={data.analysis}/>}</>;
}
export default function StudyBAdmin(){
  const [tab,setTab]=useState<'cases'|'results'>('cases');
  return <main className="page sb-page sb-admin"><div className="page-heading"><div><span className="eyebrow">Study B</span><h1>Crossover study</h1></div></div>
    <div className="sb-admin-nav" role="group" aria-label="Study B administration">
      <button type="button" data-sb-tab aria-pressed={tab==='cases'} onClick={()=>setTab('cases')}>Case configuration</button>
      <button type="button" data-sb-tab aria-pressed={tab==='results'} onClick={()=>setTab('results')}>Readings and results</button>
    </div>{tab==='cases'?<ConfigTab/>:<ResultsTab/>}
  </main>;
}

import {useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {api,ResponseError} from '../services/session';
import {useStudyData,type Letter} from '../services/blindStudy';
import {message} from '../utils';
import {hasHan} from '../../backend/english-ui.mjs';

interface EditorCase {
  case_id:string;
  case_name:string;
  revision:string;
  locked:boolean;
  reports:{letter:Letter;model_name:string;text:string}[];
}

function Editor({source,reload}:{source:EditorCase;reload:()=>void}) {
  const [saved,setSaved]=useState(source);
  const [name,setName]=useState(source.case_name);
  const [reports,setReports]=useState(source.reports);
  const [busy,setBusy]=useState(false);
  const [stale,setStale]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const disabled=busy||stale||saved.locked;
  const dirty=name!==saved.case_name || reports.some((r,i)=>r.text!==saved.reports[i].text);
  const needsEnglish=hasHan(name)||reports.some(r=>hasHan(r.text));
  const valid=Boolean(name.trim())&&!needsEnglish&&reports.every(r=>r.text.trim());
  async function save() {
    if(disabled||!dirty||!valid)return;
    setBusy(true);setError('');setNotice('');
    try {
      const next:EditorCase=await api('/admin/cases/'+encodeURIComponent(source.case_id)+'/editor',{
        method:'POST',body:JSON.stringify({revision:saved.revision,case_name:name,reports})
      });
      setSaved(next);setName(next.case_name);setReports(next.reports);setNotice('Changes saved.');
    } catch(e) {
      setError(message(e));setStale(e instanceof ResponseError && e.status===409);
    } finally {setBusy(false);}
  }
  return <form className="work-card study-panel case-editor" onSubmit={e=>{e.preventDefault();void save();}}>
    <p>{saved.locked?'A reader has submitted ratings. The reviewed text and case name are locked.':'You can edit these reports until the first reader submits ratings for this case.'}</p>
    <label>Case name<input value={name} required maxLength={120} disabled={disabled} onChange={e=>{setName(e.target.value);setNotice('');}}/></label>
    {reports.map((r,i)=><label key={r.letter}><strong>Report {r.letter} · {r.model_name}</strong>
      <textarea value={r.text} placeholder="Original report in English" rows={7} required maxLength={48000} disabled={disabled} onChange={e=>{
        const text=e.target.value;setReports(prev=>prev.map((item,pos)=>pos===i?{...item,text}:item));setNotice('');
      }}/>
    </label>)}
    {needsEnglish&&<p role="alert" className="error">Use English for the case name and report text.</p>}
    <div className="actions">
      {!saved.locked&&<button className="button primary" disabled={disabled||!dirty||!valid}>{busy?'Saving…':'Save changes'}</button>}
      {stale&&<button type="button" className="button secondary" onClick={reload}>Reload saved version</button>}
      <span role="status">{notice}</span>
    </div>{error&&<p className="error" role="alert">{error}</p>}
  </form>;
}

export default function AdminCaseEditor() {
  const {caseId=''}=useParams();
  const {data,error,refresh}=useStudyData<EditorCase>('/admin/cases/'+encodeURIComponent(caseId)+'/editor');
  return <main className="page study-upload">
    <Link className="review-link" to={'/admin/cases/'+encodeURIComponent(caseId)}>Back to case</Link>
    <div className="page-heading"><div><h1>Edit case</h1><p>{caseId}</p></div></div>
    {error?<p className="error" role="alert">{error} <button className="button secondary" onClick={refresh}>Retry</button></p>:
      data?<Editor key={caseId} source={data} reload={refresh}/>:<p role="status">Loading saved reports…</p>}
  </main>;
}

import {useEffect,useState,type FormEvent} from 'react';
import {ScanLine} from 'lucide-react';
import {useStudyData} from '../services/blindStudy';
import {joinReview,type Identity} from '../services/session';
import {message} from '../utils';

export default function PublicReaderEntry({onStart}:{onStart:(user:Identity)=>void}) {
  const {data,error:loadError,refresh}=useStudyData<{studies:{prefix:string;case_count:number}[]}>('/public/studies');
  const studies=data?.studies??[];
  const [selected,setSelected]=useState('');
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const prefix=studies.find(s=>s.prefix===selected)?.prefix??studies[0]?.prefix??'';
  useEffect(()=>setError(''),[name,prefix]);
  async function submit(e:FormEvent) {
    e.preventDefault();
    if(!name.trim()||!prefix||busy)return;
    setBusy(true);setError('');
    try{onStart(await joinReview(prefix,name.trim()));}catch(cause){setError(message(cause));}
    finally{setBusy(false);}
  }
  return <main className="login-page"><form className="form-card login-card" onSubmit={submit}>
    <ScanLine size={30}/><h1>CT Report Review</h1>
    <p>Enter your name to start reviewing.</p>
    <label>Name<input autoComplete="name" maxLength={100} required value={name} onChange={e=>setName(e.currentTarget.value)}/></label>
    {studies.length>1&&<label>Study<select value={prefix} disabled={busy} onChange={e=>setSelected(e.currentTarget.value)}>
      {studies.map(s=><option value={s.prefix} key={s.prefix}>{s.prefix} ({s.case_count} cases)</option>)}
    </select></label>}
    {loadError?<p className="error" role="alert">{loadError} <button className="button secondary" type="button" onClick={refresh}>Retry</button></p>
      :!data?<p role="status">Loading studies…</p>:!studies.length?<p role="status">No studies are open for review yet.</p>:null}
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy||!prefix||!name.trim()}>{busy?'Opening…':'Start review'}</button>
  </form></main>;
}

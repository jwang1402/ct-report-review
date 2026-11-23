import {useState,type FormEvent} from 'react';
import {ArrowRight,ScanLine} from 'lucide-react';
import {enterReader,logout,ResponseError,type Cohort,type Identity} from '../services/session';
import {message} from '../utils';

export default function CrossoverEntry({cohort,onStart}:{cohort:Cohort;onStart:(user:Identity)=>void}){
  const [name,setName]=useState(''),[pending,setPending]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[nameMismatch,setNameMismatch]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||!name.trim())return;
    setBusy(true);setError('');setNameMismatch(false);setPending('');
    try{
      const user=await enterReader(cohort,name.trim());
      if('request_code' in user)setPending(user.request_code);else onStart(user);
    }catch(e){setError(message(e));setNameMismatch(e instanceof ResponseError&&e.status===409&&e.message.includes('name differs'));}finally{setBusy(false);}
  }
  async function switchReader(){
    setBusy(true);
    try{await logout();}catch{/* Local session is cleared even if the network is unavailable. */}
    finally{setNameMismatch(false);setError('');setPending('');setBusy(false);}
  }
  return <main className="login-page reader-entry"><form className="form-card login-card reader-entry-card" onSubmit={submit}>
    <div className="reader-entry-heading"><ScanLine size={30} aria-hidden="true"/><h1>CT Report Review</h1><p>{cohort==='senior'?'Senior radiologist':'Junior radiologist'}</p></div>
    <label>Name<input autoComplete="name" maxLength={100} required disabled={busy} value={name} onChange={e=>{setName(e.target.value);setError('');setNameMismatch(false);}}/></label>
    {pending&&<p role="status">Ask your coordinator to link this browser using code <strong>{pending}</strong>, then select Continue.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy||!name.trim()}>{busy?'Opening…':'Continue'}<ArrowRight size={16}/></button>
    {nameMismatch&&<button className="button secondary" type="button" disabled={busy} onClick={()=>void switchReader()}>Switch reader</button>}
  </form></main>;
}

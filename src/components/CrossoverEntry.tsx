import {useState,type FormEvent} from 'react';
import {ArrowRight,ScanLine} from 'lucide-react';
import {enterReader,forgetCrossoverDevice,hasCrossoverDevice,remembersCrossoverDevice,type Cohort,type Identity} from '../services/session';
import {message} from '../utils';

export default function CrossoverEntry({cohort,onStart}:{cohort:Cohort;onStart:(user:Identity)=>void}){
  const [known,setKnown]=useState(()=>hasCrossoverDevice(cohort));
  const [name,setName]=useState(''),[returning,setReturning]=useState(false),[pending,setPending]=useState('');
  const [remember,setRemember]=useState(()=>remembersCrossoverDevice(cohort)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||!name.trim())return;
    setBusy(true);setError('');
    try{
      const user=await enterReader(cohort,name.trim(),returning||!!pending,remember);
      if('request_code' in user){setPending(user.request_code);setKnown(true);}else onStart(user);
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  function otherReader(){
    if(!window.confirm('Switch reader on this browser? To return to this profile later you may need the coordinator to reconnect your device.'))return;
    forgetCrossoverDevice(cohort);setKnown(false);setName('');setReturning(false);setRemember(false);setPending('');setError('');
  }
  return <main className="login-page reader-entry"><form className="form-card login-card reader-entry-card" onSubmit={submit}>
    <div className="reader-entry-heading"><ScanLine size={30} aria-hidden="true"/><h1>CT Report Review</h1><p>{cohort==='senior'?'Senior radiologist':'Junior radiologist'}</p></div>
    <label>Name<input autoComplete="name" maxLength={100} required value={name} onChange={e=>setName(e.target.value)}/></label>
    {!known&&<label className="reader-consent"><input type="checkbox" checked={returning} onChange={e=>setReturning(e.target.checked)}/>I have already started this study on another device or browser.</label>}
    <label className="reader-consent"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/>Remember this reader on my personal browser</label>
    {pending&&<p role="status">Give your coordinator device request <strong>{pending}</strong>. After verification, enter your registered display name and check access here.</p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy||!name.trim()}>{busy?'Opening…':pending?'Check access':'Continue'}<ArrowRight size={16}/></button>
    {known&&<button className="button secondary" type="button" disabled={busy} onClick={otherReader}>Use a different reader on this browser</button>}
  </form></main>;
}

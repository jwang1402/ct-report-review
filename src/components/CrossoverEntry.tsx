import {useState,type FormEvent} from 'react';
import {ArrowRight,ScanLine} from 'lucide-react';
import {enterReader,type Cohort,type Identity} from '../services/session';
import {message} from '../utils';

export default function CrossoverEntry({cohort,onStart}:{cohort:Cohort;onStart:(user:Identity)=>void}){
  const [name,setName]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:FormEvent){
    e.preventDefault();if(busy||!name.trim())return;
    setBusy(true);setError('');
    try{
      onStart(await enterReader(cohort,name.trim()));
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  return <main className="login-page reader-entry"><form className="form-card login-card reader-entry-card" onSubmit={submit}>
    <div className="reader-entry-heading"><ScanLine size={30} aria-hidden="true"/><h1>CT Report Review</h1><p>{cohort==='senior'?'Senior radiologist':'Junior radiologist'}</p></div>
    <label>Name<input autoComplete="name" maxLength={100} required disabled={busy} value={name} onChange={e=>{setName(e.target.value);setError('');}}/></label>
    {error&&<p className="error" role="alert">{error}</p>}
    <button className="button primary full" disabled={busy||!name.trim()}>{busy?'Opening…':'Continue'}<ArrowRight size={16}/></button>
  </form></main>;
}

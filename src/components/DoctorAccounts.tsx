import {useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {useStudyData} from '../services/blindStudy';
import {api,radiologistsPath} from '../services/session';
import {message} from '../utils';
import './DoctorAccounts.css';
import PublicStudyAccess from './PublicStudyAccess';

export default function DoctorAccounts() {
  const doctors = useStudyData<{doctors:string[]}>('/admin/doctors');
  const studies = useStudyData<{studies:{prefix:string;case_count:number}[]}>('/admin/enrollment/studies');
  const [username,setUsername] = useState('');
  const [password,setPassword] = useState('');
  const [reader,setReader] = useState('');
  const [prefix,setPrefix] = useState('');
  const [busy,setBusy] = useState<'create'|'assign'|null>(null);
  const [feedback,setFeedback] = useState('');
  const [error,setError] = useState('');
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = radiologistsPath;

  async function create(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy('create'); setError(''); setFeedback('');
    try {
      const name = username.trim();
      await api('/admin/doctors',{method:'POST',body:JSON.stringify({username:name,password})});
      setUsername(''); setPassword(''); setReader(name); doctors.refresh();
      setFeedback('Account created for '+name+'.');
    } catch (e) { setError(message(e)); }
    finally { setBusy(null); }
  }

  async function assign(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy('assign'); setError(''); setFeedback('');
    try {
      const result = await api('/admin/enrollment',{method:'POST',body:JSON.stringify({username:reader,prefix})});
      setFeedback(reader+' can now review '+result.case_count+' cases in '+prefix+'.');
    } catch (e) { setError(message(e)); }
    finally { setBusy(null); }
  }

  return <main className="page reader-admin">
    <div className="page-heading"><h1>Readers</h1></div>
    <div className="work-card doctor-entry"><strong>Radiologist review link</strong><a href={url.href}>{url.href}</a></div>
    <PublicStudyAccess/>
    <details className="private-readers"><summary>Private study accounts</summary><div className="reader-admin-forms">
      <form className="form-card" onSubmit={create}>
        <h2>Create a reader account</h2>
        <label>Username<input required autoComplete="off" pattern="[a-z0-9][a-z0-9_\-]{0,39}" title="Use lowercase letters, numbers, underscores or hyphens." value={username} onChange={e=>setUsername(e.target.value)} maxLength={40}/></label>
        <label>Password (at least 12 characters)<input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        <button className="button primary" disabled={!!busy}>{busy==='create'?'Creating…':'Create account'}</button>
      </form>
      <form className="form-card" onSubmit={assign}>
        <h2>Assign a published study</h2>
        <label>Reader<select required value={reader} onChange={e=>setReader(e.target.value)}>
          <option value="">Choose a reader</option>{doctors.data?.doctors.map(name=><option key={name}>{name}</option>)}
        </select></label>
        <label>Study<select required value={prefix} onChange={e=>setPrefix(e.target.value)}>
          <option value="">Choose a study</option>{studies.data?.studies.map(s=><option value={s.prefix} key={s.prefix}>{s.prefix} ({s.case_count} cases)</option>)}
        </select></label>
        {studies.data?.studies.length===0&&<p><Link to="/admin/upload">Import the first study</Link></p>}
        <button className="button secondary" disabled={!!busy||!reader||!prefix}>{busy==='assign'?'Assigning…':'Assign cases'}</button>
      </form>
    </div></details>
    {feedback&&<p role="status">{feedback}</p>}
    {(error||doctors.error||studies.error)&&<p role="alert" className="error">{error||doctors.error||studies.error}</p>}
  </main>;
}

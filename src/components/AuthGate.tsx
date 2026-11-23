import {useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {Link,useLocation,useNavigate} from 'react-router-dom';
import {ScanLine} from 'lucide-react';
import {api, login, sessionToken, clearSession,radiologistsPath,workspaceRole,type Identity} from '../services/session';
import PublicReaderEntry from './PublicReaderEntry';
import CrossoverEntry from './CrossoverEntry';
import {readerCohort} from '../services/session';
import {message} from '../utils';

export type {Identity} from '../services/session';
async function currentIdentity():Promise<Identity> {
  const session = await api('/session');
  if (session.role==='doctor' && ['senior','junior'].includes(session.cohort))
    return {username:'',role:'doctor',cohort:session.cohort,display_name:session.display_name};
  if (typeof session.username !== 'string' || !['admin','doctor'].includes(session.role)) {
    throw new Error('This account has no assigned study role.');
  }
  return {username:session.username,role:session.role,display_name:session.display_name,public_study:session.public_study};
}

export function AuthGate({children}:{children:(user:Identity)=>ReactNode}) {
  const {pathname}=useLocation();
  const role=workspaceRole(pathname);
  if(!role)return <main className="page"><h1>Page not found</h1><Link to={radiologistsPath}>Open case review</Link></main>;
  return <WorkspaceGate key={readerCohort(pathname)??role} role={role}>{children}</WorkspaceGate>;
}

function WorkspaceGate({role,children}:{role:Identity['role'];children:(user:Identity)=>ReactNode}) {
  const {pathname,state} = useLocation();
  const navigate=useNavigate(),cohort=readerCohort(pathname);
  const [user,setUser] = useState<Identity|null>(null);
  const [checking,setChecking] = useState(true);
  const [username,setUsername] = useState('');
  const [password,setPassword] = useState('');
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    function end() { setUser(null); setPassword(''); setError(''); }
    window.addEventListener('ct-session-ended',end);
    async function verify() {
      const token = sessionToken();
      if (!token) { setChecking(false); return; }
      try {
        const identity = await currentIdentity();
        if (active && token === sessionToken()) {
          if(identity.role===role && identity.cohort===cohort) setUser(identity);
          else clearSession();
        }
      } catch (e) {
        if (active && token === sessionToken()) { setUser(null); setError(message(e)); }
      } finally { if (active) setChecking(false); }
    }
    void verify();
    const timer = window.setInterval(() => { if(sessionToken()) void verify(); },60000);
    return () => { active=false; clearInterval(timer); window.removeEventListener('ct-session-ended',end); };
  },[role,cohort]);

  async function signIn(event:FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      await login(username,password);
      const identity=await currentIdentity();
      if(identity.role!==role)throw new Error('Use the sign-in page for your assigned role.');
      setUser(identity);
    } catch(e) {
      clearSession(); setError(message(e));
    } finally { setPassword(''); setBusy(false); }
  }
  if(checking) return <main className="login-page" role="status">Checking session…</main>;
  if(cohort && (pathname==='/'+cohort || !user))return <CrossoverEntry cohort={cohort} onStart={u=>{
    setUser(u);navigate('/'+cohort+(cohort==='senior'&&!state?.returnToStudyB?'/workspace':'/study-b'),{replace:true});
  }}/>;
  if(user) return children(user);
  if(role==='doctor'&&pathname!==radiologistsPath+'/account')return <PublicReaderEntry onStart={setUser}/>;
  return <main className="login-page"><form className="form-card login-card" onSubmit={signIn}>
    <ScanLine size={30}/><h1>{pathname.startsWith('/admin')?'Administrator sign-in':'CT Report Review'}</h1>
    <label>Username<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label>
    <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
    {error && <p role="alert" className="error">{error}</p>}
    <button className="button primary full" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
  </form></main>;
}

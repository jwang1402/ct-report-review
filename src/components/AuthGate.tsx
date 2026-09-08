import {useEffect,useState,type ReactNode} from 'react';
import {useLocation} from 'react-router-dom';
import {ScanLine} from 'lucide-react';
import {api,login,sessionToken,clearSession} from '../services/session';
export function AuthGate({children}:{children:ReactNode}){
 const location=useLocation(),[valid,setValid]=useState(false),[checking,setChecking]=useState(true),[username,setUsername]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const end=()=>{setValid(false);setPassword('');window.location.hash='/login';};window.addEventListener('ct-session-ended',end);return()=>window.removeEventListener('ct-session-ended',end);},[]);
 useEffect(()=>{let alive=true;setChecking(true);async function check(){if(!sessionToken()){setValid(false);if(location.pathname!=='/login')window.location.hash='/login';setChecking(false);return;}try{await api('/session');if(alive)setValid(true);}catch(e){if(alive){setValid(false);setError(e instanceof Error?e.message:'Sign in again.');}}finally{if(alive)setChecking(false);}}void check();return()=>{alive=false;};},[location.pathname]);
 useEffect(()=>{if(!valid)return;const timer=setInterval(()=>{void api('/session').catch(()=>clearSession());},60000);return()=>clearInterval(timer);},[valid]);
 if(checking)return <main className="login-page"><span className="spinner"/>Checking session…</main>;
 if(valid)return children;
 return <main className="login-page"><form className="form-card login-card" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await login(username,password);setPassword('');setValid(true);window.location.hash='/cases';}catch(e){setPassword('');setError(e instanceof Error?e.message:'Sign-in failed.');}finally{setBusy(false);}}}><ScanLine size={30}/><h1>CT Report Review</h1><p>Sign in to your review workspace.</p><label>Username<input autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>{error&&<p className="error" role="alert">{error}</p>}<button className="button primary full" disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form></main>;
}


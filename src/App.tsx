import {lazy,Suspense} from 'react';
import {HashRouter,Link,NavLink,Navigate,Route,Routes} from 'react-router-dom';
import {ScanLine} from 'lucide-react';
import {AuthGate, type Identity} from './components/AuthGate';
import {BlindCase, StudyList} from './components/BlindCases';
import {logout} from './services/session';

const AdminResults=lazy(()=>import('./components/AdminResults'));
const AdminUpload=lazy(()=>import('./components/AdminUpload'));
const AdminCaseEditor=lazy(()=>import('./components/AdminCaseEditor'));
const DoctorAccounts=lazy(()=>import('./components/DoctorAccounts'));
const LegacyWorkspace=lazy(()=>import('./LegacyWorkspace'));

function Workspace({user}:{user:Identity}) {
  const isAdmin=user.role==='admin';
  const home=isAdmin?'/admin':'/doctor';
  return <>
    <header className="header blind-header">
      <Link className="brand" to={home}><span className="brand-icon"><ScanLine size={22}/></span>CT Report Review</Link>
      <nav aria-label="Study">
        <NavLink to={home} end>{isAdmin?'Cases':'Assigned cases'}</NavLink>
        {isAdmin&&<NavLink to="/admin/upload">Upload study</NavLink>}
        {isAdmin&&<NavLink to="/admin/readers">Readers</NavLink>}
        {isAdmin&&<NavLink to="/admin/results">Results</NavLink>}
        {isAdmin&&<NavLink to="/admin/archive">Previous reviews</NavLink>}
      </nav>
      <div className="header-end"><span>{user.username}</span><button className="button secondary" onClick={()=>void logout().catch(()=>{})}>Sign out</button></div>
    </header>
    <Suspense fallback={<p className="page" role="status">Loading…</p>}>
      <Routes>
        <Route path={home} element={<StudyList role={user.role}/>}/>
        <Route path={home+'/cases/:caseId'} element={<BlindCase role={user.role}/>}/>
        {isAdmin&&<Route path="/admin/upload" element={<AdminUpload/>}/>}
        {isAdmin&&<Route path="/admin/readers" element={<DoctorAccounts/>}/>}
        {isAdmin&&<Route path="/admin/cases/:caseId/edit" element={<AdminCaseEditor/>}/>}
        {isAdmin&&<Route path="/admin/results" element={<AdminResults/>}/>}
        {isAdmin&&<Route path="/admin/archive" element={<LegacyWorkspace/>}/>}
        {isAdmin&&<Route path="/results" element={<Navigate to="/admin/archive" replace/>}/>}
        <Route path="*" element={<Navigate to={home} replace/>}/>
      </Routes>
    </Suspense>
  </>;
}

export default function App(){
  return <HashRouter><AuthGate>{user=><Workspace key={user.role+':'+user.username} user={user}/>}</AuthGate></HashRouter>;
}

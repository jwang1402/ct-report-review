import {lazy,Suspense} from 'react';
import {HashRouter,Link,NavLink,Navigate,Route,Routes} from 'react-router-dom';
import {Activity,FolderOpen,Plus,ScanLine} from 'lucide-react';
import {AuthGate, type Identity} from './components/AuthGate';
import {BlindCase, StudyList} from './components/BlindCases';
import StudyHome from './components/StudyHome';
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
    <header className="header">
      <Link className="brand" to={home}><span className="brand-icon"><ScanLine size={22}/></span><div>CT Report Review<small>CLINICAL RESEARCH</small></div></Link>
      <nav aria-label="Study">
        <NavLink to={home} end><ScanLine size={15}/>Home</NavLink>
        {isAdmin&&<NavLink to="/admin/cases"><FolderOpen size={15}/>Clinical Review</NavLink>}
        {isAdmin&&<NavLink to="/admin/upload"><Plus size={15}/>Upload Case</NavLink>}
        {isAdmin&&<NavLink to="/admin/results"><Activity size={15}/>Results</NavLink>}
      </nav>
      <div className="header-end"><span>{user.display_name||user.username}</span><button className="button secondary"
        title={user.public_study?'End this review session before leaving a shared computer':undefined}
        onClick={()=>void logout().catch(()=>{})}>{user.public_study?'End session':'Sign out'}</button></div>
    </header>
    <Suspense fallback={<p className="page" role="status">Loading…</p>}>
      <Routes>
        <Route path={home} element={<StudyHome role={user.role}/>}/>
        <Route path={home+'/cases'} element={isAdmin?<StudyList role={user.role}/>:<Navigate to="/doctor" replace/>}/>
        <Route path={home+'/cases/:caseId'} element={<BlindCase role={user.role} publicReader={!!user.public_study}/>}/>
        {isAdmin&&<Route path="/admin/upload" element={<AdminUpload/>}/>}
        {isAdmin&&<Route path="/admin/readers" element={<DoctorAccounts/>}/>}
        {isAdmin&&<Route path="/admin/cases/:caseId/edit" element={<AdminCaseEditor/>}/>}
        {isAdmin&&<Route path="/admin/results" element={<AdminResults/>}/>}
        {isAdmin&&<Route path="/admin/archive" element={<LegacyWorkspace/>}/>}
        {isAdmin&&<Route path="/results" element={<Navigate to="/admin/results" replace/>}/>}
        {isAdmin&&<Route path="/upload" element={<Navigate to="/admin/upload" replace/>}/>}
        <Route path="/cases" element={<Navigate to={isAdmin?'/admin/cases':'/doctor'} replace/>}/>
        <Route path="*" element={<Navigate to={home} replace/>}/>
      </Routes>
    </Suspense>
  </>;
}

export default function App(){
  return <HashRouter><AuthGate>{user=><Workspace key={user.role+':'+user.username} user={user}/>}</AuthGate></HashRouter>;
}

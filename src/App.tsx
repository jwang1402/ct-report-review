import {lazy,Suspense,useState} from 'react';
import {HashRouter,Link,NavLink,Navigate,Route,Routes,useNavigate} from 'react-router-dom';
import {Activity,FolderOpen,Plus,ScanLine} from 'lucide-react';
import {AuthGate, type Identity} from './components/AuthGate';
import {BlindCase, StudyList} from './components/BlindCases';
import StudyHome from './components/StudyHome';
import {logout,workspaceHome} from './services/session';

const AdminResults=lazy(()=>import('./components/AdminResults'));
const AdminUpload=lazy(()=>import('./components/AdminUpload'));
const AdminCaseEditor=lazy(()=>import('./components/AdminCaseEditor'));
const DoctorAccounts=lazy(()=>import('./components/DoctorAccounts'));
const LegacyWorkspace=lazy(()=>import('./LegacyWorkspace'));
const StudyBWorkspace=lazy(()=>import('./components/StudyBWorkspace'));
const StudyBAdmin=lazy(()=>import('./components/StudyBAdmin'));
const CrossoverAccess=lazy(()=>import('./components/CrossoverAccess'));

function SeniorWorkspace(){
  const [study,setStudy]=useState('');
  const navigate=useNavigate();
  return <main className="page reader-home"><div className="page-heading"><h1>Reader workspace</h1></div>
    <form className="form-card senior-study-picker" onSubmit={e=>{e.preventDefault();if(study)navigate('/senior/'+study);}}>
      <div><label htmlFor="senior-study">Study</label><select id="senior-study" required value={study} onChange={e=>setStudy(e.target.value)}>
        <option value="">Choose a study</option><option value="study-a">Study A — Blinded report review</option>
        <option value="study-b">Study B — CT reading</option>
      </select></div>
      <button className="button primary" type="submit" disabled={!study}>Open study</button>
    </form></main>;
}

function Workspace({user}:{user:Identity}) {
  const navigate=useNavigate();
  const isAdmin=user.role==='admin';
  const home=user.cohort==null?workspaceHome(user.role):user.cohort==='senior'?'/senior/workspace':'/junior/study-b';
  return <>
    <header className={isAdmin?'header':'header reader-nav'}>
      <Link className="brand" to={home}><span className="brand-icon"><ScanLine size={22}/></span><div>CT Report Review{isAdmin&&<small>CLINICAL RESEARCH</small>}</div></Link>
      <nav aria-label="Study">
        <NavLink to={home} end><ScanLine size={15}/>Home</NavLink>
        {isAdmin&&<NavLink to="/admin/cases"><FolderOpen size={15}/>Clinical Review</NavLink>}
        {isAdmin&&<NavLink to="/admin/upload"><Plus size={15}/>Upload Case</NavLink>}
        {isAdmin&&<NavLink to="/admin/results"><Activity size={15}/>Results</NavLink>}
        {isAdmin&&<NavLink to="/admin/reader-access">Reader access</NavLink>}
      </nav>
      <div className={'header-end'+(user.cohort?' reader-account':'')}><span>{user.display_name||user.username}</span>
        {user.cohort&&<button className="button secondary" onClick={()=>void logout('switch-reader').catch(()=>{})}>Switch reader</button>}
        <button className="button secondary"
        title={user.public_study?'End this review session before leaving a shared computer':undefined}
        onClick={()=>void logout().catch(()=>{})}>{user.public_study?'End session':'Sign out'}</button></div>
    </header>
    <Suspense fallback={<p className="page" role="status">Loading…</p>}>
      <Routes>
        {user.cohort==='senior'&&<Route path="/senior/workspace" element={<SeniorWorkspace/>}/>}
        {user.cohort==='senior'&&<Route path="/senior/study-a" element={<StudyHome role="doctor"/>}/>}
        {user.cohort==='senior'&&<Route path="/senior/cases/:caseId" element={<BlindCase role="doctor" publicReader/>}/>}
        {user.cohort&&<Route path={'/'+user.cohort+'/study-b'} element={<StudyBWorkspace onConfirmName={()=>navigate('/'+user.cohort,{state:{returnToStudyB:true}})}/>}/>}
        {isAdmin&&<Route path="/admin/study-b" element={<StudyBAdmin/>}/>}
        {isAdmin&&<Route path="/admin/reader-access" element={<CrossoverAccess/>}/>}
        {!user.cohort&&<Route path={home} element={<StudyHome role={user.role}/>}/>}
        <Route path={home+'/cases'} element={isAdmin?<StudyList role={user.role}/>:<Navigate to={home} replace/>}/>
        {!user.cohort&&<Route path={home+'/cases/:caseId'} element={<BlindCase role={user.role} publicReader={!!user.public_study}/>}/>}
        {isAdmin&&<Route path="/admin/upload" element={<AdminUpload/>}/>}
        {isAdmin&&<Route path="/admin/readers" element={<DoctorAccounts/>}/>}
        {isAdmin&&<Route path="/admin/cases/:caseId/edit" element={<AdminCaseEditor/>}/>}
        {isAdmin&&<Route path="/admin/results" element={<AdminResults/>}/>}
        {isAdmin&&<Route path="/admin/archive" element={<LegacyWorkspace/>}/>}
        {isAdmin&&<Route path="/results" element={<Navigate to="/admin/results" replace/>}/>}
        {isAdmin&&<Route path="/upload" element={<Navigate to="/admin/upload" replace/>}/>}
        <Route path="/cases" element={<Navigate to={isAdmin?'/admin/cases':home} replace/>}/>
        <Route path="*" element={<Navigate to={home} replace/>}/>
      </Routes>
    </Suspense>
  </>;
}

export default function App(){
  return <HashRouter><AuthGate>{user=><Workspace key={user.role+':'+user.username} user={user}/>}</AuthGate></HashRouter>;
}

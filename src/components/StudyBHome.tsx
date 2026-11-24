import {Check, ChevronRight, ClipboardList, RefreshCw, ScanLine} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useStudyData} from '../services/blindStudy';
import {inCaseOrder} from '../services/caseOrder';
import {sessionDate, type StudyBList} from '../services/studyB';
import './StudyBHome.css';

export default function StudyBHome({onConfirmName}:{onConfirmName:()=>void}) {
  const {data,error,refresh}=useStudyData<StudyBList>('/study-b');
  const ready=data?.status==='ready';
  const cases=ready?inCaseOrder(data.cases):[];
  return <main className="page home-page reader-home sb-home">
    <div className="page-heading"><h1>Study B workspace</h1></div>
    {ready&&<div className="summary-strip">
      <div><ScanLine/><span>Cases<strong>{cases.length}</strong></span></div>
      <div><ClipboardList/><span>In progress<strong>{cases.filter(c=>c.started&&!c.submitted).length}</strong></span></div>
      <div><Check/><span>Submitted<strong>{cases.filter(c=>c.submitted).length}</strong></span></div>
    </div>}
    <section className="work-card">
      <div className="section-heading"><h2>{ready?'Session '+data.period+' cases':'Reading assignments'}</h2>
        <button className="button secondary push-right" type="button" disabled={!data&&!error} onClick={refresh}><RefreshCw size={14}/>Refresh</button>
      </div>
      {error&&<p className="global-error" role="alert">{error}</p>}
      {!data&&!error&&<div className="empty" role="status"><span className="spinner"/>Loading assignments…</div>}
      {ready&&<div className="table-scroll case-workspace-scroll sb-case-directory" role="region" aria-label="Assigned cases" tabIndex={0}>
        <table><thead><tr><th scope="col">Case</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead>
          <tbody>{cases.map(c=><tr key={c.case_id}>
            <td><span className="case-title"><span className="study-icon"><ScanLine size={19}/></span><strong>{c.case_id}</strong></span></td>
            <td><span className={'badge'+(c.submitted?' good':'')}>{c.submitted?'Submitted':c.started?'In progress':'Ready'}</span></td>
            <td>{!c.submitted&&<Link className="review-link" to={'read?case='+encodeURIComponent(c.case_id)} aria-label={(c.started?'Resume ':'Select ')+c.case_id}>
              {c.started?'Resume':'Select'}<ChevronRight size={15}/></Link>}</td>
          </tr>)}</tbody></table>
      </div>}
      {data&&!ready&&<div className="empty">
        {data.status==='complete'?<Check size={26}/>:<ClipboardList size={26}/>}
        <h2>{data.status==='complete'?'All readings submitted':data.status==='washout'?'Session 1 complete':data.status==='confirm_name'?'Confirm your name for session 2':'No readings available yet'}</h2>
        {data.status==='washout'&&<p>Session 2 opens {sessionDate(data.opens_at)}.</p>}
        {data.status==='not_ready'&&<p>Your cases will appear when the coordinator opens the study.</p>}
        {data.status==='confirm_name'&&<button className="button primary" type="button" onClick={onConfirmName}>Confirm name</button>}
      </div>}
    </section>
  </main>;
}

import {Activity,ArrowUpRight,Check,FileText,Plus,RefreshCw,ScanLine} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useStudyData,type StudyListItem} from '../services/blindStudy';
import type {Identity} from '../services/session';
import {CaseTable} from './BlindCases';
import {isStudyACase} from '../services/studyDisplay';
import {StudyBInventory} from './StudyBInventory';

export default function StudyHome({role}:{role:Identity['role']}) {
  const admin=role==='admin';
  const {data,error,refresh}=useStudyData<{cases:StudyListItem[]}>('/blind/cases');
  const cases=data?.cases;
  const studyATitle=cases?.length&&cases.every(c=>isStudyACase(c.case_id))?'Study A':'Reader workspace';
  return <main className={'page home-page'+(admin?'':' reader-home')}>
    <div className="page-heading"><div>
      {admin?<><span className="eyebrow">CLINICAL EVALUATION WORKSPACE</span>
        <h1>CT Report Review</h1><p>Clinical evaluation of AI-generated reports against CT imaging data</p></>:
        <h1>{studyATitle}</h1>}
    </div>{admin&&<Link className="button primary" to="/admin/upload"><Plus size={16}/>Upload Case</Link>}</div>
    {admin&&<><StudyBInventory/><h2 className="case-overview-title">{studyATitle==='Study A'?'Study A':'Blinded report review'}</h2></>}
    <div className="summary-strip">
      <div><ScanLine/><span>{admin?'Published cases':'Cases'}<strong>{cases?.length??'—'}</strong></span></div>
      <div><FileText/><span>{admin?'Model reports':'Reports'}<strong>{cases?cases.reduce((sum,c)=>sum+(c.report_count??4),0):'—'}</strong></span></div>
      <div><Check/><span>{admin?'Fully reviewed cases':'Cases reviewed'}<strong>{cases?.filter(c=>c.scored).length??'—'}</strong></span></div>
    </div>
    <section className="work-card">
      <div className="section-heading"><h2>Case workspace</h2>
        <button className="button secondary push-right" disabled={!data&&!error} onClick={refresh}><RefreshCw size={14}/>Refresh Cases</button>
      </div>
      {error?<p className="global-error" role="alert">{error}</p>:cases?<CaseTable role={role} cases={cases} compact={admin} scrollable={!admin}/>:
        <div className="empty" role="status"><span className="spinner"/><p>Loading published cases…</p></div>}
    </section>
    {admin&&<div className="home-bottom">
      <Link to="/admin/study-b/results"><FileText size={20}/><div><h3>Study B readings</h3><p>Review crossover readings and assessments.</p></div><ArrowUpRight size={20}/></Link>
      <Link to="/admin/cases"><ScanLine size={20}/><div><h3>Clinical Review</h3><p>Inspect the CT study and evaluate each model report.</p></div><ArrowUpRight size={20}/></Link>
      <Link to="/admin/results"><Activity size={20}/><div><h3>Review results</h3><p>Explore individual ratings and export reviewer feedback.</p></div><ArrowUpRight size={20}/></Link>
    </div>}
  </main>;
}

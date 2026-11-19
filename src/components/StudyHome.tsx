import {Activity,ArrowUpRight,Check,FileText,Plus,RefreshCw,ScanLine} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useStudyData,type StudyListItem} from '../services/blindStudy';
import type {Identity} from '../services/session';
import {CaseTable} from './BlindCases';

export default function StudyHome({role}:{role:Identity['role']}) {
  const admin=role==='admin';
  const library='/'+role+'/cases';
  const {data,error,refresh}=useStudyData<{cases:StudyListItem[]}>('/blind/cases');
  const cases=data?.cases;
  return <main className="page home-page">
    <div className="page-heading"><div>
      <span className="eyebrow">CLINICAL EVALUATION WORKSPACE</span>
      <h1>CT Report Review</h1><p>Clinical evaluation of AI-generated reports against CT imaging data</p>
    </div>{admin&&<Link className="button primary" to="/admin/upload"><Plus size={16}/>Upload Case</Link>}</div>
    <div className="summary-strip">
      <div><ScanLine/><span>Published cases<strong>{cases?.length??'—'}</strong></span></div>
      <div><FileText/><span>Model reports<strong>{cases?cases.length*4:'—'}</strong></span></div>
      <div><Check/><span>{admin?'Fully reviewed cases':'Cases you reviewed'}<strong>{cases?.filter(c=>c.scored).length??'—'}</strong></span></div>
    </div>
    <section className="work-card">
      <div className="section-heading"><h2>Case workspace</h2><span className="muted">Published studies</span>
        <button className="button secondary push-right" disabled={!data&&!error} onClick={refresh}><RefreshCw size={14}/>Refresh Cases</button>
      </div>
      {error?<p className="global-error" role="alert">{error}</p>:cases?<CaseTable role={role} cases={cases} compact={admin} scrollable={!admin}/>:
        <div className="empty" role="status"><span className="spinner"/><p>Loading published cases…</p></div>}
    </section>
    {admin&&<div className="home-bottom">
      <Link to={library}><ScanLine size={20}/><div><h3>Clinical Review</h3><p>Inspect the CT study and evaluate each model report.</p></div><ArrowUpRight size={20}/></Link>
      <Link to="/admin/results"><Activity size={20}/><div><h3>Review results</h3><p>Explore individual ratings and export reviewer feedback.</p></div><ArrowUpRight size={20}/></Link>
    </div>}
  </main>;
}

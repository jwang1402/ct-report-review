import {lazy,Suspense,useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {ArrowLeft,ChevronRight,RefreshCw} from 'lucide-react';
import {caseEndpoint,useStudyData,type StudyListItem,type StudyDetail,type ReaderReport,type NamedReport} from '../services/blindStudy';
import {api,ResponseError} from '../services/session';
import {message} from '../utils';
import {decisionLabels,ratings} from '../types';
import {ViewerBoundary} from './ViewerBoundary';
import DriveCaseViewer from './DriveCaseViewer';
import {Tabs,TabsContent,TabsList,TabsTrigger} from './Tabs';
import type {Identity} from './AuthGate';
const Viewer=lazy(()=>import('./Viewer'));

export function StudyList({role}:{role:Identity['role']}) {
  const {data,error,refresh}=useStudyData<{cases:StudyListItem[]}>('/blind/cases');
  const admin=role==='admin';
  return <main className="page">
    <div className="page-heading"><div><h1>{admin?'Study cases':'My cases'}</h1>
      {data&&<p>{admin?data.cases.length+' cases':data.cases.filter(c=>c.scored).length+' of '+data.cases.length+' cases scored'}</p>}
    </div><div className="actions">
      {admin&&<Link className="button primary" to="/admin/upload">Upload study</Link>}
      <button className="button secondary" onClick={refresh}><RefreshCw size={15}/> Refresh</button>
    </div></div>
    {error?<p role="alert" className="error">{error}</p>:!data?<p role="status">Loading cases…</p>:
      !data.cases.length?<p>{admin?'No private study cases imported.':'No cases have been assigned to your account.'}</p>:
      <div className="work-card table-scroll"><table><thead><tr><th>Case</th><th>{admin?'Reader submissions':'My scores'}</th><th/></tr></thead>
        <tbody>{data.cases.map(c=><tr key={c.case_id}><td><strong>{c.case_name}</strong>{c.case_name!==c.case_id&&<small> · {c.case_id}</small>}</td>
          <td>{c.scored?(admin?'All submitted':'Submitted'):'Pending'}</td>
          <td><Link className="review-link" to={'/'+role+'/cases/'+encodeURIComponent(c.case_id)}>Open case <ChevronRight size={14}/></Link></td></tr>)}</tbody>
      </table></div>}
  </main>;
}

function DoctorReports({id,reports,revision,reload}:{id:string;reports:ReaderReport[];revision:string;reload:()=>void}) {
  const [drafts,setDrafts]=useState(reports);
  const [saved,setSaved]=useState(reports);
  const [selected,setSelected]=useState(reports[0].letter);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [outdated,setOutdated]=useState(false);
  const dirty=drafts.some((r,i)=>r.rating!==saved[i].rating||r.comment!==saved[i].comment);
  const complete=drafts.filter(r=>r.rating!==null).length;
  useEffect(()=>{
    if(!dirty)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  function edit(changes:Partial<Pick<ReaderReport,'rating'|'comment'>>) {
    setDrafts(rows=>rows.map(row=>row.letter===selected?{...row,...changes}:row));
    setNotice('');
  }
  async function submit() {
    if(busy||complete!==4||!dirty)return;
    setBusy(true);setError('');
    try {
      await api(caseEndpoint(id)+'/ratings',{method:'POST',body:JSON.stringify({revision,ratings:drafts.map(({letter,rating,comment})=>({letter,rating,comment}))})});
      setSaved(drafts);setNotice('Your four ratings have been saved.');
    }catch(e){setOutdated(e instanceof ResponseError && e.status===409);setError(message(e));}finally{setBusy(false);}
  }
  return <section className="blind-reports">
    <div className="panel-header"><h2>Reports</h2><span>{complete} / 4 rated</span></div>
    <Tabs value={selected} onValueChange={v=>setSelected(v as ReaderReport['letter'])}>
      <TabsList aria-label="Anonymous reports">{drafts.map(r=><TabsTrigger key={r.letter} value={r.letter}>Report {r.letter}</TabsTrigger>)}</TabsList>
      {drafts.map(r=><TabsContent key={r.letter} value={r.letter} className="blind-tab">
        <div className="blind-text">{r.text}</div>
        <fieldset className="quality-rating" disabled={busy}><legend>Findings quality</legend>
          <div className="quality-rating-options">{ratings.map(value=><label key={value} className={'quality-rating-choice '+(r.rating===Number(value)?'chosen':'')}>
            <input type="radio" name={'rating-'+r.letter} value={value} checked={r.rating===Number(value)} onChange={()=>edit({rating:Number(value)})}/>
            <span className="rating-number">{value}</span><span className="rating-description">{decisionLabels[value].split(' · ')[1]}</span>
          </label>)}</div>
        </fieldset>
        <label className="blind-notes">Comment (optional)<textarea value={r.comment} disabled={busy} maxLength={10000} rows={3} onChange={e=>edit({comment:e.target.value})}/></label>
      </TabsContent>)}
    </Tabs>
    <div className="blind-save"><span role="status">{busy?'Saving…':notice||(dirty?'Unsaved changes':complete===4?'Submitted':'Choose a rating for each report.')}</span>
      <button className="button primary" disabled={outdated||busy||!dirty||complete!==4} onClick={()=>void submit()}>Save four ratings</button>
    </div>{error&&<p className="error" role="alert">{error}</p>}
    {outdated&&<button className="button secondary" onClick={reload}>Reload updated reports and rate again</button>}
  </section>;
}

function AdminReports({reports}:{reports:NamedReport[]}) {
  return <section className="blind-reports"><h2>Model reports</h2><Tabs defaultValue={reports[0].model_name}>
    <TabsList aria-label="Model reports">{reports.map(r=><TabsTrigger key={r.model_name} value={r.model_name}>{r.model_name}</TabsTrigger>)}</TabsList>
    {reports.map(r=><TabsContent key={r.model_name} value={r.model_name}><div className="blind-text">{r.text}</div></TabsContent>)}
  </Tabs></section>;
}

export function BlindCase({role,publicReader=false}:{role:Identity['role'];publicReader?:boolean}) {
  const {caseId=''}=useParams();
  const {data,error,refresh}=useStudyData<StudyDetail>(caseEndpoint(caseId));
  const back=<Link className="review-link" to={'/'+role}><ArrowLeft size={16}/> Cases</Link>;
  if(!data)return <main className="page">{back}{error?<p className="error" role="alert">{error} <button className="button secondary" onClick={refresh}>Retry</button></p>:<p role="status">Loading case…</p>}</main>;
  const doctorReports=data.reports.filter((r):r is ReaderReport=>'letter' in r).sort((a,b)=>a.letter.localeCompare(b.letter));
  const adminReports=data.reports.filter((r):r is NamedReport=>'model_name' in r);
  if(role==='doctor' ? doctorReports.map(r=>r.letter).join('')!=='ABCD' || data.reports.length!==4 : !adminReports.length) {
    return <main className="page">{back}<p role="alert">The case assignment could not be loaded. Contact the coordinator.</p></main>;
  }
  return <main className="blind-case">
    <div className="review-topbar">{back}<strong>{data.case_name}</strong>{data.case_name!==caseId&&<span className="case-id">{caseId}</span>}
      {role==='admin'&&<Link className="button secondary" to={'/admin/cases/'+encodeURIComponent(caseId)+'/edit'}>Edit case</Link>}
    </div>
    <div className="blind-split">
      {data.imaging.drive_url?<DriveCaseViewer key={data.case_id} study={data} publicReader={publicReader}/>:<ViewerBoundary key={data.case_id}><Suspense fallback={<p role="status">Loading imaging engine…</p>}>
        <Viewer key={data.case_id} privateCase item={{case_id:data.case_id,imaging:data.imaging,asset:{size:data.imaging.size,url:''}}}/>
      </Suspense></ViewerBoundary>}
      {role==='doctor'?<DoctorReports key={caseId} id={caseId} reports={doctorReports} revision={data.revision??'initial'} reload={refresh}/>:<AdminReports key={caseId} reports={adminReports}/>}
    </div>
  </main>;
}

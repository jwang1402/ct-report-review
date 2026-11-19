import {lazy,Suspense,useEffect,useState,type ReactNode} from 'react';
import {Link,useParams} from 'react-router-dom';
import {ArrowLeft,ChevronRight,Download,FileText,PanelLeftClose,Plus,RefreshCw,ScanLine} from 'lucide-react';
import {caseEndpoint,useStudyData,type StudyListItem,type StudyDetail,type ReaderReport,type NamedReport,type StudyResult} from '../services/blindStudy';
import {api,ResponseError} from '../services/session';
import {inCaseOrder} from '../services/caseOrder';
import {message,saveFile} from '../utils';
import {decisionLabels,ratings} from '../types';
import {ViewerBoundary} from './ViewerBoundary';
import DriveCaseViewer from './DriveCaseViewer';
import {Tabs,TabsContent,TabsList,TabsTrigger} from './Tabs';
import {Expandable} from './Expandable';
import {ResizablePanel,ResizablePanelGroup,ResizableHandle} from './Resizable';
import type {Identity} from './AuthGate';
import './CaseWorkspace.css';

const Viewer=lazy(()=>import('./Viewer'));
type Role=Identity['role'];
const caseLink=(role:Role,id:string)=>'/'+role+'/cases/'+encodeURIComponent(id);

function ReaderCaseLabel({id}:{id:string}) {
  const alias=id.match(/(?:^|-)(Case\d+)$/)?.[1]??id;
  return <span><strong>{alias}</strong>{alias!==id&&<small>{id}</small>}</span>;
}

export function CaseTable({role,cases,compact=false,scrollable=false}:{role:Role;cases:StudyListItem[];compact?:boolean;scrollable?:boolean}) {
  if(!cases.length)return <div className="empty"><div className="empty-icon"><ScanLine size={32}/></div><h2>No cases available</h2>
    {role==='admin'?<Link className="button primary" to="/admin/upload"><Plus size={16}/>Upload Case</Link>:<p>Your study cases will appear here.</p>}</div>;
  const ordered=inCaseOrder(cases);
  return <div className={'table-scroll'+(scrollable?' case-workspace-scroll':'')} role={scrollable?'region':undefined}
    aria-label={scrollable?'Case list':undefined} tabIndex={scrollable?0:undefined}><table><thead><tr><th>Case / study</th><th>Imaging</th><th>Reports</th><th>Review status</th><th/></tr></thead>
    <tbody>{(compact?ordered.slice(0,5):ordered).map(c=><tr key={c.case_id}>
      <td><Link className="case-title" to={caseLink(role,c.case_id)}><span className="study-icon"><ScanLine size={19}/></span>
        {role==='doctor'?<ReaderCaseLabel id={c.case_id}/>:<span><strong>{c.case_name}</strong>{c.case_id!==c.case_name&&<small>{c.case_id}</small>}</span>}</Link></td>
      <td><span className="format-badge">NIfTI</span></td><td>4 reports</td>
      <td>{role==='doctor'?<div className="review-meter"><span>{c.scored?4:0} / 4 reviewed</span><progress value={c.scored?4:0} max={4}/></div>
        :<span className={'badge'+(c.scored?' good':'')}>{c.scored?'All submitted':'Pending'}</span>}</td>
      <td><Link className="review-link" to={caseLink(role,c.case_id)}>Review<ChevronRight size={15}/></Link></td>
    </tr>)}</tbody></table></div>;
}

export function StudyList({role}:{role:Role}) {
  const {data,error,refresh}=useStudyData<{cases:StudyListItem[]}>('/blind/cases');
  return <main className="page"><div className="page-heading"><div>
    <span className="eyebrow">CLINICAL REVIEW</span><h1>Case library {data&&<span className="heading-count">{data.cases.length}</span>}</h1>
    <p>Open a study to load its CT and review the reports.</p></div><div className="actions">
      <button className="button secondary" disabled={!data&&!error} onClick={refresh}><RefreshCw size={15}/>Refresh Cases</button>
      {role==='admin'&&<Link className="button primary" to="/admin/upload"><Plus size={15}/>Upload Case</Link>}
    </div></div><div className="work-card">
      {error?<div className="empty" role="alert">{error}</div>:data?<CaseTable role={role} cases={data.cases}/>:<div className="empty" role="status"><span className="spinner"/>Loading published cases…</div>}
    </div></main>;
}

interface TabReport {id:string; label:string; text:string;}
function ReportFrame({caseId,items,selected,select,summary,children,control}:{caseId:string;items:TabReport[];selected:string;select:(value:string)=>void;summary?:string;children:ReactNode;control?:ReactNode}) {
  const [hidden,setHidden]=useState(false);
  const [font,setFont]=useState(14);
  return <Expandable title="Model reports"><aside className={'report-panel'+(hidden?' reviews-hidden':'')}>
    <div className="panel-header"><div><FileText size={16}/><h2>Model reports</h2>
      <button className="icon-button" aria-label="Decrease report text" onClick={()=>setFont(s=>Math.max(10,s-2))}>A−</button>
      <button className="icon-button" aria-label="Increase report text" onClick={()=>setFont(s=>Math.min(32,s+2))}>A+</button></div><span>{summary}</span></div>
    {control}
    <Tabs value={selected} onValueChange={select} className="report-tabs"><TabsList aria-label="Model reports">{items.map(r=>
      <TabsTrigger key={r.id} value={r.id}>{r.label}</TabsTrigger>)}</TabsList>
      {items.map(r=><TabsContent key={r.id} value={r.id} className="report-content">
        <span className="eyebrow">AI-GENERATED REPORT</span><div className="report-title"><h3>{r.label}</h3>
          <button className="icon-button" disabled={!r.text} title="Download Report" aria-label={'Download '+r.label} onClick={()=>saveFile(r.text,caseId+'-'+r.id+'.txt')}><Download size={16}/></button></div>
        <div className="report-text" style={{fontSize:font}}>{r.text||'The English report is unavailable. Please contact the study coordinator.'}</div>
      </TabsContent>)}</Tabs>
    <button className="review-collapse" aria-expanded={!hidden} aria-controls="review-body" onClick={()=>setHidden(v=>!v)}>{hidden?'▲ Show reviews':'▼ Hide reviews'}</button>
    <div id="review-body" className="review-body" hidden={hidden}>{children}</div>
  </aside></Expandable>;
}

function DoctorReports({id,reports,revision,reload,onSaved}:{id:string;reports:ReaderReport[];revision:string;reload:()=>void;onSaved:()=>void}) {
  const [drafts,setDrafts]=useState(reports);
  const [saved,setSaved]=useState(reports);
  const [selected,setSelected]=useState<string>(reports[0].letter);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [outdated,setOutdated]=useState(false);
  const draft=drafts.find(r=>r.letter===selected)!;
  const dirty=drafts.some((r,i)=>r.rating!==saved[i].rating||r.comment!==saved[i].comment);
  const complete=drafts.filter(r=>r.rating!==null).length;
  const missingOriginal=drafts.some(r=>!r.text);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[dirty]);
  function edit(changes:Partial<Pick<ReaderReport,'rating'|'comment'>>) {
    setDrafts(rows=>rows.map(row=>row.letter===selected?{...row,...changes}:row));setNotice('');
  }
  async function submit() {
    if(busy||complete!==4||!dirty||missingOriginal)return;
    setBusy(true);setError('');
    try{
      await api(caseEndpoint(id)+'/ratings',{method:'POST',body:JSON.stringify({revision,ratings:drafts.map(({letter,rating,comment})=>({letter,rating,comment}))})});
      setSaved(drafts);setNotice('Your four ratings have been saved.');onSaved();
    }catch(e){setOutdated(e instanceof ResponseError&&e.status===409);setError(message(e));}finally{setBusy(false);}
  }
  return <ReportFrame caseId={id} selected={selected} select={setSelected} items={drafts.map(r=>({id:r.letter,label:'Report '+r.letter,text:r.text}))}
    summary={complete+' / 4 rated'}>
    <div className="decision-panel"><div className="section-heading"><h3>Your review</h3></div>
      <section className="reviewer-group"><h3>Report {selected} · Review</h3>
        <fieldset className="quality-rating" disabled={busy||!draft.text}><legend>Findings quality</legend>
          <div className="quality-rating-options">{ratings.map(value=><label key={value} className={'quality-rating-choice '+(draft.rating===Number(value)?'chosen':'')}>
            <input type="radio" name={'rating-'+selected} value={value} checked={draft.rating===Number(value)} onChange={()=>edit({rating:Number(value)})}/>
            <span className="rating-number">{value}</span><span className="rating-description">{decisionLabels[value].split(' · ')[1]}</span>
          </label>)}</div>
          <div className="quality-rating-caption">{draft.rating?'Selected: '+decisionLabels[String(draft.rating) as typeof ratings[number]]:'Select a score from 1 · Poor to 5 · Excellent'}</div>
        </fieldset>
        <label>Comment (optional)<textarea value={draft.comment??''} placeholder={draft.comment===null?'A previous comment is saved. Type in English to replace it.':'Write in English'} disabled={busy} maxLength={10000} rows={3} onChange={e=>edit({comment:e.target.value})}/></label>
        <p role="status">{notice||(missingOriginal?'Ratings can be submitted when all four English reports are available.':complete+' / 4 reports ready. Switch report tabs to review each report.')}</p>
        <button className="button primary full" disabled={outdated||busy||!dirty||complete!==4||missingOriginal} onClick={()=>void submit()}>{busy?'Saving…':'Save four ratings'}</button>
      </section>
      {error&&<p role="alert" className="error">{error}</p>}{outdated&&<button className="button secondary" onClick={reload}>Reload updated reports and rate again</button>}
    </div>
  </ReportFrame>;
}

function AdminReports({reports,id}:{reports:NamedReport[];id:string}) {
  const canonical=reports.length===4&&reports.map(r=>r.letter).sort().join('')==='ABCD';
  const sorted=canonical?[...reports].sort((a,b)=>a.letter!.localeCompare(b.letter!)):reports;
  const [reveal,setReveal]=useState(false);
  const [selected,setSelected]=useState(sorted[0].letter??sorted[0].model_name);
  const {data,error,refresh}=useStudyData<{results:StudyResult[]}>('/admin/results');
  const report=sorted.find(r=>(r.letter??r.model_name)===selected)!;
  const scores=data?.results.filter(r=>r.case_id===id&&r.model_name===report.model_name&&r.rating!==null);
  return <ReportFrame caseId={id} selected={selected} select={setSelected} items={sorted.map(r=>({id:r.letter??r.model_name,text:r.text,
    label:canonical?'Report '+r.letter+(reveal?' · '+r.model_name:''):r.model_name}))}
    control={canonical?<div className="model-key-control"><button className="text-button" aria-pressed={reveal} onClick={()=>setReveal(!reveal)}>{reveal?'Hide model names':'Reveal model names'}</button></div>:null}>
    <div className="decision-panel"><div className="section-heading"><h3>Submitted reviews</h3><button className="icon-button" aria-label="Refresh reviews" onClick={refresh}><RefreshCw size={15}/></button></div>
      {error?<p role="alert">{error}</p>:!scores?<p role="status">Loading reviews…</p>:!scores.length?<p>No ratings submitted for this report.</p>:
        scores.map(r=><div className="review-feedback" key={r.username}><div><strong>{r.display_name||r.username}</strong><span className="badge">{r.rating} / 5</span></div>{r.comment&&<p>{r.comment}</p>}</div>)}
    </div>
  </ReportFrame>;
}

export function BlindCase({role,publicReader=false}:{role:Role;publicReader?:boolean}) {
  const {caseId=''}=useParams();
  const {data,error,refresh}=useStudyData<StudyDetail>(caseEndpoint(caseId));
  const library=useStudyData<{cases:StudyListItem[]}>('/blind/cases');
  const cases=inCaseOrder(library.data?.cases??[]);
  const back=role==='doctor'?'/doctor':'/admin/cases';
  if(!data)return <main className="page"><div className="empty"><ScanLine size={32}/><h2>{error||'Loading case…'}</h2>
    {error&&<button className="button secondary" onClick={refresh}>Retry</button>}<Link className="button secondary" to={back}>Back to cases</Link></div></main>;
  const doctorReports=data.reports.filter((r):r is ReaderReport=>!('model_name' in r)).sort((a,b)=>a.letter.localeCompare(b.letter));
  const adminReports=data.reports.filter((r):r is NamedReport=>'model_name' in r);
  if(role==='doctor'?doctorReports.map(r=>r.letter).join('')!=='ABCD'||data.reports.length!==4:!adminReports.length){
    return <main className="page"><Link to={back}>Back to cases</Link><p role="alert">The case assignment could not be loaded.</p></main>;
  }
  return <main className="review-page clinical-case">
    <div className="review-topbar"><Link to={back} className="icon-button" aria-label="Back to cases"><ArrowLeft size={18}/></Link>
      <span className="case-id">{data.case_id}</span>{data.case_name!==data.case_id&&<strong>{data.case_name}</strong>}<span className="format-badge">NIfTI</span>
      <span className="muted push-right">{data.reports.length} model reports</span>
      {role==='admin'&&<Link className="button secondary" to={caseLink(role,caseId)+'/edit'}>Edit case</Link>}
    </div>
    <ResizablePanelGroup direction="horizontal" className="review-layout">
      <ResizablePanel defaultSize={15} minSize={10} maxSize={24}><aside className="case-sidebar"><div className="panel-header">
        <h2>Cases <span>{cases.length}</span></h2><PanelLeftClose size={15}/></div>
        {library.error&&<button className="button secondary" onClick={library.refresh}>Reload case list</button>}
        {cases.map(c=><Link key={c.case_id} to={caseLink(role,c.case_id)} className={'case-item '+(c.case_id===caseId?'active':'')} aria-current={c.case_id===caseId?'page':undefined}>
          <div><span className="mini-study"><ScanLine size={22}/></span>{role==='doctor'?<ReaderCaseLabel id={c.case_id}/>:<span><strong>{c.case_id}</strong><small>NIfTI</small></span>}<ChevronRight size={14}/></div>
          {role==='admin'&&c.case_name!==c.case_id&&<p>{c.case_name}</p>}<small>{c.scored?'Submitted':'Pending'}</small></Link>)}
      </aside></ResizablePanel><ResizableHandle/>
      <ResizablePanel defaultSize={55} minSize={35}>
        {data.imaging.drive_url?<DriveCaseViewer key={data.case_id} study={data} publicReader={publicReader||data.public_ct}/>:<ViewerBoundary key={data.case_id}>
          <Suspense fallback={<div className="empty"><span className="spinner"/>Loading imaging engine…</div>}>
            <Viewer key={data.case_id} privateCase item={{case_id:data.case_id,imaging:data.imaging,asset:{size:data.imaging.size,url:''}}}/>
          </Suspense></ViewerBoundary>}
      </ResizablePanel><ResizableHandle/>
      <ResizablePanel defaultSize={30} minSize={23} maxSize={45}>{role==='doctor'?<DoctorReports key={caseId} id={caseId} reports={doctorReports}
        revision={data.revision??'initial'} reload={refresh} onSaved={library.refresh}/>:<AdminReports key={caseId} id={caseId} reports={adminReports}/>}</ResizablePanel>
    </ResizablePanelGroup>
  </main>;
}

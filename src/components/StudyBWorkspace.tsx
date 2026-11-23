import {useEffect,useRef,useState} from 'react';
import {ArrowLeft, Check, ChevronRight, ClipboardList, RefreshCw, ScanLine} from 'lucide-react';
import {Link} from 'react-router-dom';
import {api, ResponseError} from '../services/session';
import {useStudyData} from '../services/blindStudy';
import {findingNames,findings,type Finding} from '../services/studyAReview';
import {fillUnanswered,missingReading,sessionDate,sideLabels,type FindingRecord,type Reading,type Side,type StudyBList} from '../services/studyB';
import {message} from '../utils';
import DriveCaseViewer from './DriveCaseViewer';
import './StudyB.css';

function ReadingForm({entry,onBack}:{entry:Reading;onBack:()=>void}) {
  const [report,setReport]=useState(entry.report);
  const [answers,setAnswers]=useState<FindingRecord>(entry.findings);
  const [version,setVersion]=useState(entry.version);
  const [dirty,setDirty]=useState(false);
  const [busy,setBusy]=useState(false);
  const [conflict,setConflict]=useState(false);
  const [alert,setAlert]=useState('');
  const [notice,setNotice]=useState('');
  const inflight=useRef(false);
  const count=findings.filter(f=>answers[f]).length;
  useEffect(()=>{
    if(!dirty)return;
    const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};
    const navigate=(e:MouseEvent)=>{
      const a=e.target instanceof Element?e.target.closest('a[href]'):null;
      if(a&&a.getAttribute('target')!=='_blank'&&!window.confirm('Leave without saving these changes?')){
        e.preventDefault();e.stopImmediatePropagation();
      }
    };
    window.addEventListener('beforeunload',warn);
    document.addEventListener('click',navigate,true);
    return ()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('click',navigate,true);};
  },[dirty]);
  function edit(){setDirty(true);setNotice('');setAlert('');}
  function changeFinding(key:Finding,present:boolean,side:Side) {
    setAnswers(current=>({...current,[key]:{present,side}}));edit();
  }
  async function save(submit:boolean) {
    if(inflight.current||conflict)return;
    if(submit){
      const problem=missingReading(report,answers);
      if(problem){setAlert(problem);return;}
      if(!window.confirm('Submit and lock your final report and findings for '+entry.case_id+'?'))return;
    }
    inflight.current=true;setBusy(true);setAlert('');setNotice('');
    try {
      const res=await api('/study-b/cases/'+encodeURIComponent(entry.case_id),{
        method:'PUT',body:JSON.stringify({period:entry.period,version,report,findings:answers,submit})
      });
      setVersion(res.version);setDirty(false);
      if(submit)onBack();else setNotice('Draft saved.');
    }catch(e){setAlert(message(e));if(e instanceof ResponseError&&e.status===409)setConflict(true);}
    finally{setBusy(false);inflight.current=false;}
  }
  const image={case_id:entry.case_id,imaging:{...entry.imaging,type:'NIFTI' as const,filename:entry.case_id+'.nii.gz'}};
  return <main className="sb-workspace">
    <header className="sb-toolbar"><button type="button" className="button secondary" disabled={busy}
      onClick={()=>{if(!dirty||window.confirm('Return to cases and discard unsaved changes?'))onBack();}}><ArrowLeft size={15}/>Cases</button>
      <strong>{entry.case_id}</strong><span className="format-badge">Study B · Session {entry.period}</span>
      <span className="sb-time">Opened {sessionDate(entry.started_at)}</span></header>
    <div className="sb-split"><section className="sb-image" aria-label="CT viewer"><DriveCaseViewer study={image} publicReader studyB/></section>
    <section className="sb-form-pane" aria-label="Reading form">
      <div className="sb-reading-head"><h1>Your reading</h1><span className="badge">{entry.condition==='with_ai'?'With MORPH-CT draft':'Independent reading'}</span></div>
      <fieldset disabled={busy||conflict} className="sb-form-fields">
        <label className="sb-labelled" htmlFor="sb-report">Final report
          <span>{entry.condition==='with_ai'?'Review and edit the draft against the CT.':'Write your findings and impression.'}</span></label>
        <textarea id="sb-report" className="sb-report" rows={10} maxLength={48000} value={report} onChange={e=>{setReport(e.target.value);edit();}}/>
        <div className="sb-section-title"><h2>Findings</h2><span>{count} / {findings.length} recorded</span></div>
        <p className="sb-hint">Record your interpretation of the CT. Add laterality when applicable.</p>
        <div className="sb-table-wrap"><table className="sb-checklist"><thead><tr><th>Finding</th><th>Assessment</th><th>Side</th></tr></thead>
          <tbody>{findings.map(f=><tr key={f}><th scope="row">{findingNames[f]}</th>
            <td><div className="sb-toggle" role="group" aria-label={findingNames[f]}>{[true,false].map(p=><button key={String(p)} type="button"
              aria-pressed={answers[f]?.present===p} onClick={()=>changeFinding(f,p,p?(answers[f]?.present?answers[f]!.side:'unspecified'):'na')}>{p?'Present':'Absent'}</button>)}</div></td>
            <td>{answers[f]?.present?<select aria-label={findingNames[f]+' side'} value={answers[f]!.side}
              onChange={e=>changeFinding(f,true,e.target.value as Side)}>{Object.entries(sideLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>:<span className="muted">—</span>}</td>
          </tr>)}</tbody></table></div>
        {count<findings.length&&<button type="button" className="button secondary sb-fill" onClick={()=>{setAnswers(fillUnanswered(answers));edit();}}>
          Mark remaining {findings.length-count} absent</button>}
      </fieldset>
      <footer className="sb-save-bar">
        {alert&&<p role="alert" className="error">{alert}</p>}
        {notice&&<p role="status">{notice}</p>}
        {conflict?<button className="button secondary" onClick={onBack}>Return to current assignments</button>
        :<div className="actions"><button className="button secondary" disabled={busy||!dirty} onClick={()=>void save(false)}>Save draft</button>
          <button className="button primary" disabled={busy} onClick={()=>void save(true)}><Check size={15}/>{busy?'Saving…':'Submit final reading'}</button></div>}
      </footer>
    </section></div>
  </main>;
}

export default function StudyBWorkspace({onConfirmName}:{onConfirmName?:()=>void}={}) {
  const {data,error,refresh}=useStudyData<StudyBList>('/study-b');
  const [reading,setReading]=useState<Reading|null>(null);
  const [opening,setOpening]=useState('');
  const [problem,setProblem]=useState('');
  const openingRef=useRef(false);
  async function open(id:string){
    if(!data||openingRef.current)return;
    openingRef.current=true;setOpening(id);setProblem('');
    try{setReading(await api('/study-b/cases/'+encodeURIComponent(id)+'/open',{method:'POST',body:JSON.stringify({period:data.period})}));}
    catch(e){setProblem(message(e));}finally{openingRef.current=false;setOpening('');}
  }
  if(reading)return <ReadingForm key={reading.case_id+'-'+reading.period} entry={reading} onBack={()=>{setReading(null);setProblem('');refresh();}}/>;
  return <main className="page sb-page"><div className="page-heading"><div><span className="eyebrow">Study B</span><h1>Reading workspace</h1></div>
    <button className="button secondary" disabled={!!opening} onClick={()=>{setProblem('');refresh();}}><RefreshCw size={15}/>Refresh</button></div>
    {(problem||error)&&<p role="alert" className="error">{problem||error}</p>}
    {!data&&!error&&<div className="empty" role="status"><span className="spinner"/>Loading assignments…</div>}
    {data&&<section className="work-card sb-library">
      {data.status==='ready'?<>
        <div className="sb-library-heading"><div><h2>Session {data.period}</h2><p>{data.cases.some(c=>c.started&&!c.submitted)?'Resume your current reading. Submitting it unlocks the next CT.':'Open a CT when ready to begin. The timer runs until you submit.'}</p></div>
          <span className="badge">{data.cases.filter(c=>c.submitted).length} / {data.cases.length} submitted</span></div>
        <div className="table-scroll"><table><thead><tr><th>Examination</th><th>Reading status</th><th/></tr></thead>
          <tbody>{data.cases.map(c=><tr key={c.case_id}><td><strong>{c.case_id}</strong></td><td>{c.submitted?'Submitted':c.started?'In progress':'Ready'}</td>
            <td>{!c.submitted&&<button className="button secondary" disabled={!!opening||(!c.started&&data.cases.some(x=>x.started&&!x.submitted))} onClick={()=>void open(c.case_id)}>
              {opening===c.case_id?'Opening…':c.started?'Resume reading':'Open CT'}<ChevronRight size={15}/></button>}</td></tr>)}</tbody></table></div>
      </>:<div className="empty">{data.status==='complete'?<Check size={26}/>:data.status==='not_ready'?<ScanLine size={26}/>:<ClipboardList size={26}/>}
        <h2>{data.status==='complete'?'All readings submitted':data.status==='washout'?'Session 1 complete':data.status==='confirm_name'?'Confirm your name for session 2':'No readings available yet'}</h2>
        {data.status==='washout'&&<p>Session 2 opens {sessionDate(data.opens_at)}.</p>}
        {data.status==='not_ready'&&<p>Your cases will appear when the coordinator opens the study.</p>}
        {data.status==='confirm_name'&&(onConfirmName?<button className="button primary" onClick={onConfirmName}>Confirm name</button>:<Link className="button primary" to="/junior">Confirm name</Link>)}
      </div>}
    </section>}
  </main>;
}

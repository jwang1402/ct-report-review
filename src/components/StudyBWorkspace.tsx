import {useEffect,useRef,useState} from 'react';
import {Check, ChevronRight, ClipboardList, RefreshCw, ScanLine} from 'lucide-react';
import {Link} from 'react-router-dom';
import {api, ResponseError} from '../services/session';
import {useStudyData} from '../services/blindStudy';
import {findingNames,findings,type Finding} from '../services/studyAReview';
import {fillUnanswered,missingReading,sessionDate,sideLabels,type FindingRecord,type Reading,type Side,type StudyBList} from '../services/studyB';
import {message} from '../utils';
import DriveCaseViewer from './DriveCaseViewer';
import StudyBReportEditor from './StudyBReportEditor';
import {ResizableHandle,ResizablePanel,ResizablePanelGroup} from './Resizable';
import './StudyAWorkspace.css';
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
  return <section className="sb-form-pane" aria-label="Reading form">
      <div className="sb-reading-head"><h1>Your reading</h1><span className="badge">{entry.condition==='with_ai'?'With MORPH-CT draft':'Independent reading'}</span></div>
      <fieldset disabled={busy||conflict} className="sb-form-fields">
        <StudyBReportEditor entry={entry} report={report} onChange={value=>{setReport(value);edit();}}/>
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
    </section>;
}

type Task=StudyBList['cases'][number];
function taskStatus(task:Task,currentId?:string){
  if(task.submitted)return 'Submitted';
  return task.started||task.case_id===currentId?'In progress':'Ready';
}

export default function StudyBWorkspace({onConfirmName}:{onConfirmName?:()=>void}={}) {
  const {data,error,refresh}=useStudyData<StudyBList>('/study-b');
  const [reading,setReading]=useState<Reading|null>(null);
  const [selectedId,select]=useState('');
  const [opening,setOpening]=useState('');
  const [problem,setProblem]=useState('');
  const openingRef=useRef(false);
  async function open(id:string){
    if(!data||openingRef.current)return;
    openingRef.current=true;setOpening(id);setProblem('');
    try{
      const entry:Reading=await api('/study-b/cases/'+encodeURIComponent(id)+'/open',{method:'POST',body:JSON.stringify({period:data.period})});
      setReading(entry);select(entry.case_id);
    }catch(e){setProblem(message(e));refresh();}finally{openingRef.current=false;setOpening('');}
  }
  function chooseCase(id:string){select(id);setProblem('');}
  function finish(){setReading(null);select('');setProblem('');refresh();}
  if(data?.status==='ready'&&data.cases.length){
    const currentId=reading?.case_id??data.cases.find(c=>c.started&&!c.submitted)?.case_id;
    const selected=data.cases.find(c=>c.case_id===selectedId)??data.cases.find(c=>c.case_id===currentId)??data.cases.find(c=>!c.submitted)??data.cases[0];
    const selectedStatus=taskStatus(selected,currentId);
    const showReading=reading?.case_id===selected.case_id;
    const image=reading?{case_id:reading.case_id,imaging:{...reading.imaging,type:'NIFTI' as const,filename:reading.case_id+'.nii.gz'}}:null;
    return <main className="review-page clinical-case study-a-workspace sb-workspace">
      <header className="review-topbar">
        <strong className="case-id">{selected.case_id}</strong>
        <span className="format-badge">Study B · Session {data.period}</span>
        <label className="sb-mobile-cases">Cases<select aria-label="Select examination" value={selected.case_id} disabled={!!opening}
          onChange={e=>chooseCase(e.target.value)}>{data.cases.map(c=><option key={c.case_id} value={c.case_id}>{c.case_id} · {taskStatus(c,currentId)}</option>)}</select></label>
        <span className="muted push-right">{data.cases.filter(c=>c.submitted).length} / {data.cases.length} submitted</span>
        {showReading&&reading&&<time className="sb-opened-at" dateTime={reading.started_at}>Opened {sessionDate(reading.started_at)}</time>}
        {!reading&&<button className="icon-button" type="button" aria-label="Refresh assignments" disabled={!!opening} onClick={()=>{setProblem('');refresh();}}><RefreshCw size={16}/></button>}
      </header>
      <ResizablePanelGroup direction="horizontal" className="review-layout sb-layout">
        <ResizablePanel defaultSize={14} minSize={10} maxSize={24}>
          <nav className="case-sidebar" aria-label="Study B cases"><div className="panel-header"><h2>Cases <span>{data.cases.length}</span></h2></div>
            {data.cases.map(c=>{
              const status=taskStatus(c,currentId),active=c.case_id===selected.case_id;
              return <button type="button" key={c.case_id} className={'case-item'+(active?' active':'')}
                aria-label={c.case_id+', '+status} aria-current={active?'page':undefined} disabled={!!opening} onClick={()=>chooseCase(c.case_id)}>
                <div><span className="mini-study"><ScanLine size={17}/></span><span><strong>{c.case_id}</strong><small>{status}</small></span>
                <ChevronRight size={14}/></div></button>;
            })}
          </nav>
        </ResizablePanel><ResizableHandle/>
        <ResizablePanel minSize={70} className="sb-stage">
          {!showReading&&<section className="sb-case-preview" aria-label="Examination preview">
            <div className="sb-preview-card"><span className="format-badge">{selectedStatus}</span>
              <h1>{selected.case_id}</h1>
              <p>{selected.submitted?'The final reading for this examination has been submitted.':
                currentId&&currentId!==selected.case_id?'Submit '+currentId+' before opening another examination.':
                currentId?'Resume this reading to continue your report.':'Open the CT when ready to begin. Timing continues until you submit.'}</p>
              {problem&&<p role="alert" className="error">{problem}</p>}
              {currentId&&currentId!==selected.case_id?<button className="button primary" type="button" onClick={()=>{if(reading)chooseCase(currentId);else void open(currentId);}} disabled={!!opening}>
                Resume {currentId}<ChevronRight size={15}/></button>:!selected.submitted&&
                <button className="button primary" type="button" disabled={!!opening} onClick={()=>void open(selected.case_id)}>
                  {opening?'Opening…':currentId?'Resume reading':'Open CT'}<ChevronRight size={15}/></button>}
            </div>
          </section>}
          {reading&&image&&<div className="sb-reading-area" aria-hidden={!showReading} inert={!showReading}>
            <ResizablePanelGroup direction="horizontal" className="sb-inner">
              <ResizablePanel defaultSize={52} minSize={30} className="sb-image" aria-label="CT viewer">
                <DriveCaseViewer key={reading.case_id} study={image} publicReader studyB/>
              </ResizablePanel><ResizableHandle/>
              <ResizablePanel defaultSize={48} minSize={32} className="sb-editor">
                <ReadingForm key={reading.case_id+'-'+reading.period} entry={reading} onBack={finish}/>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>}
        </ResizablePanel>
      </ResizablePanelGroup>
    </main>;
  }
  return <main className="page sb-page"><div className="page-heading"><div><span className="eyebrow">Study B</span><h1>Reading workspace</h1></div>
    <button className="button secondary" disabled={!!opening} onClick={()=>{setProblem('');refresh();}}><RefreshCw size={15}/>Refresh</button></div>
    {(problem||error)&&<p role="alert" className="error">{problem||error}</p>}
    {!data&&!error&&<div className="empty" role="status"><span className="spinner"/>Loading assignments…</div>}
    {data&&<section className="work-card sb-library">
      <div className="empty">{data.status==='complete'?<Check size={26}/>:data.status==='not_ready'?<ScanLine size={26}/>:<ClipboardList size={26}/>}
        <h2>{data.status==='complete'?'All readings submitted':data.status==='washout'?'Session 1 complete':data.status==='confirm_name'?'Confirm your name for session 2':'No readings available yet'}</h2>
        {data.status==='washout'&&<p>Session 2 opens {sessionDate(data.opens_at)}.</p>}
        {data.status==='not_ready'&&<p>Your cases will appear when the coordinator opens the study.</p>}
        {data.status==='confirm_name'&&(onConfirmName?<button className="button primary" onClick={onConfirmName}>Confirm name</button>:<Link className="button primary" to="/junior">Confirm name</Link>)}
      </div>
    </section>}
  </main>;
}

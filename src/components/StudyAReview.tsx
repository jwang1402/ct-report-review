import {useEffect,useRef,useState,type FormEvent} from 'react';
import {caseEndpoint} from '../services/blindStudy';
import {api,ResponseError} from '../services/session';
import {blankReview,errorNames,findingNames,findings,reviewProblem,validFindings,
  type ErrorType,type Finding,type FindingError,type ReviewDraft,type SavedReview,type StudyAReport} from '../services/studyAReview';
import {decisionLabels,ratings} from '../types';
import {message} from '../utils';
import {ReportFrame} from './ReportFrame';
import './StudyAReview.css';

type ErrorEditor={finding:Finding|'other'|'';index?:number};
function ErrorForm({editor,original,save,close}:{editor:ErrorEditor;original?:FindingError;save:(row:FindingError)=>void;close:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const [finding,setFinding]=useState(editor.finding);
  const [other,setOther]=useState(original?.other??'');
  const [type,setType]=useState<ErrorType|''>(original?.type??'');
  const [severity,setSeverity]=useState(original?(original.significant?'yes':'no'):'');
  const [detail,setDetail]=useState(original?.detail??'');
  useEffect(()=>{const modal=dialog.current!;modal.showModal();return ()=>modal.close();},[]);
  function submit(e:FormEvent) {
    e.preventDefault();
    if(!finding||!type||!severity||(finding==='other'&&!other.trim()))return;
    save({finding,other:finding==='other'?other.trim():'',type,significant:severity==='yes',detail:detail.trim()});
  }
  return <dialog ref={dialog} className="study-a-error-dialog" aria-labelledby="study-error-title" onCancel={close}>
    <form onSubmit={submit}><h2 id="study-error-title">{original?'Edit error':'Add error'}</h2>
      <label>Finding<select required value={finding} onChange={e=>setFinding(e.target.value as typeof finding)}>
        <option value="">Select…</option>{findings.map(f=><option value={f} key={f}>{findingNames[f]}</option>)}
        <option value="other">Other clinically important finding</option>
      </select></label>
      {finding==='other'&&<label>Other finding<input required pattern={'.*\\S.*'} maxLength={180} value={other} onChange={e=>setOther(e.target.value)}/></label>}
      <label>Error type<select required value={type} onChange={e=>setType(e.target.value as ErrorType)}>
        <option value="">Select…</option>{Object.entries(errorNames).map(([key,label])=><option value={key} key={key}>{label}</option>)}
      </select></label>
      <label>Clinically significant?<select required value={severity} onChange={e=>setSeverity(e.target.value)}>
        <option value="">Select…</option><option value="yes">Yes</option><option value="no">No</option>
      </select></label>
      <label>Detail (optional)<input maxLength={300} value={detail} onChange={e=>setDetail(e.target.value)}/></label>
      <div className="actions"><button className="button secondary" type="button" onClick={close}>Cancel</button>
        <button className="button primary" type="submit">Save error</button></div>
    </form></dialog>;
}

export function StudyAReview({id,reports,revision,reload,onSaved}:{id:string;reports:StudyAReport[];revision:string;reload:()=>void;onSaved:()=>void}) {
  const [saved,setSaved]=useState<Record<string,SavedReview|null>>(()=>Object.fromEntries(reports.map(r=>[r.letter,r.review])));
  const [drafts,setDrafts]=useState<Record<string,ReviewDraft>>(()=>Object.fromEntries(reports.map(r=>[r.letter,r.review??blankReview()])));
  const [editable,setEditable]=useState<Record<string,boolean>>({});
  const [letter,select]=useState<string>(reports[0].letter);
  const [positiveOnly,setPositiveOnly]=useState(false);
  const [editor,setEditor]=useState<ErrorEditor|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [conflict,setConflict]=useState(false);
  const [notice,setNotice]=useState('');
  const current=reports.find(r=>r.letter===letter)!;
  const d=drafts[letter];
  const ready=Boolean(current.text)&&validFindings(current.findings);
  const locked=Boolean(saved[letter])&&!editable[letter];
  const disabled=!ready||locked||busy;
  const dirty=reports.some(r=>JSON.stringify(drafts[r.letter])!==JSON.stringify(saved[r.letter]??blankReview()));
  const reviewed=Object.values(saved).filter(Boolean).length;
  const visibleFindings=findings.filter(f=>!positiveOnly||current.findings?.[f]===1);
  useEffect(()=>{
    if(!dirty)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    function beforeNavigate(event:MouseEvent) {
      if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const a=event.target instanceof Element?event.target.closest('a[href]'):null;
      if(a instanceof HTMLAnchorElement&&a.target!=='_blank'&&!a.download&&a.href!==window.location.href&&
        !window.confirm('Leave this case and discard unsubmitted changes?')){event.preventDefault();event.stopPropagation();}
    }
    window.addEventListener('beforeunload',warn);
    document.addEventListener('click',beforeNavigate,true);
    return ()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('click',beforeNavigate,true);};
  },[dirty]);
  function patch(changes:Partial<ReviewDraft>) {
    setDrafts(prev=>({...prev,[letter]:{...prev[letter],...changes}}));setError('');setNotice('');
  }
  function chooseMode(mode:'yes'|'no') {
    if(d.mode===mode)return;
    if(mode==='no'&&d.errors.length&&!window.confirm('Remove the errors recorded for this report?'))return;
    patch({mode,errors:mode==='no'?[]:d.errors,confirmed:false});
  }
  async function submit() {
    if(disabled||conflict)return;
    const problem=reviewProblem(d);
    if(problem){setError(problem);return;}
    setBusy(true);setError('');setNotice('');
    try{
      const response:{review:SavedReview}=await api(caseEndpoint(id)+'/study-a-review',{method:'PUT',
        body:JSON.stringify({letter,revision,version:saved[letter]?.version??0,mode:d.mode,rating:d.rating,comment:d.comment,errors:d.errors,confirmed:true})});
      setDrafts(prev=>({...prev,[letter]:response.review}));setSaved(prev=>({...prev,[letter]:response.review}));
      setEditable(prev=>({...prev,[letter]:false}));setNotice('Report '+letter+' review saved.');onSaved();
    }catch(e){setError(message(e));if(e instanceof ResponseError&&e.status===409)setConflict(true);}
    finally{setBusy(false);}
  }
  function changeReport(next:string){
    if(busy)return;
    select(next);setEditor(null);setPositiveOnly(false);setError('');setNotice('');
  }
  function saveError(row:FindingError) {
    const errors=[...d.errors];
    if(editor?.index===undefined)errors.push(row);else errors[editor.index]=row;
    patch({mode:'yes',errors,confirmed:false});setEditor(null);
  }
  return <ReportFrame caseId={id} selected={letter} select={changeReport}
    items={reports.map(r=>({id:r.letter,label:'Report '+r.letter+(saved[r.letter]?' ✓':''),text:r.text}))} summary={reviewed+' / 3 reviewed'}>
    <div className="study-a-review">
      <section><div className="study-a-section-heading"><h3>Reported findings</h3><div className="study-a-buttons" aria-label="Filter findings">
        <button type="button" aria-pressed={!positiveOnly} onClick={()=>setPositiveOnly(false)}>All 18</button>
        <button type="button" aria-pressed={positiveOnly} onClick={()=>setPositiveOnly(true)}>Positive {current.findings?findings.filter(f=>current.findings![f]===1).length:''}</button>
      </div></div>
      <p className="study-a-hint">1 = reported as present · 0 = not reported as present</p>
      {validFindings(current.findings)?<div className="study-a-table" role="region" aria-label="Reported findings" tabIndex={0}><table><thead><tr>
        <th>Finding</th><th>Report</th>{d.mode==='yes'&&!locked&&<th>Review</th>}</tr></thead><tbody>
        {visibleFindings.map(f=><tr key={f}><td>{findingNames[f]}</td><td><span className={current.findings![f]?'study-a-positive':''}>{current.findings![f]?'✓ 1':'0'}</span></td>
          {d.mode==='yes'&&!locked&&<td><button type="button" disabled={disabled} aria-label={'Mark error for '+findingNames[f]} onClick={()=>setEditor({finding:f})}>Mark error</button></td>}</tr>)}
        {!visibleFindings.length&&<tr><td colSpan={d.mode==='yes'&&!locked?3:2}>No findings were extracted as present.</td></tr>}
      </tbody></table></div>:<p className="error" role="alert">The findings for this report are unavailable. Contact the study coordinator.</p>}
      </section>
      <section><fieldset disabled={disabled} className="study-a-field"><legend>Did you identify any errors?</legend>
        <div className="study-a-buttons"><button type="button" aria-pressed={d.mode==='no'} onClick={()=>chooseMode('no')}>No errors identified</button>
          <button type="button" aria-pressed={d.mode==='yes'} onClick={()=>chooseMode('yes')}>Yes, errors identified</button></div></fieldset>
        {d.mode==='yes'&&<>
          {!locked&&<p className="study-a-hint">Mark the affected finding in the table or add an error below.</p>}
          <ul className="study-a-errors">{d.errors.map((e,i)=><li key={i}>
            <div><strong>{e.finding==='other'?e.other:findingNames[e.finding]}</strong><span>{errorNames[e.type]} · {e.significant?'Clinically significant':'Minor'}</span>{e.detail&&<small>{e.detail}</small>}</div>
            {!locked&&<div className="study-a-buttons"><button disabled={disabled} onClick={()=>setEditor({index:i,finding:e.finding})}>Edit</button>
              <button disabled={disabled} onClick={()=>patch({errors:d.errors.filter((_,idx)=>idx!==i),confirmed:false})}>Remove</button></div>}</li>)}</ul>
          {!locked&&<button className="button secondary" disabled={disabled} onClick={()=>setEditor({finding:''})}>+ Add error</button>}
        </>}
      </section>
      <section><fieldset className="quality-rating" disabled={disabled}><legend>Overall report quality</legend>
        <div className="quality-rating-options">{ratings.map(r=><label key={r} className={'quality-rating-choice '+(d.rating===Number(r)?'chosen':'')}>
          <input type="radio" name={'study-a-quality-'+letter} value={r} checked={d.rating===Number(r)} onChange={()=>patch({rating:Number(r)})}/>
          <span className="rating-number">{r}</span><span className="rating-description">{decisionLabels[r].split(' · ')[1]}</span></label>)}</div></fieldset>
        <details key={letter} className="study-a-comment"><summary>Comment (optional)</summary>
          <textarea aria-label="Overall review comment" rows={2} maxLength={5000} disabled={disabled} value={d.comment} onChange={e=>patch({comment:e.target.value})}/></details>
        <label className="study-a-confirm"><input type="checkbox" checked={d.confirmed} disabled={disabled} onChange={e=>patch({confirmed:e.target.checked})}/>I have reviewed all findings.</label>
      </section>
      <div className="study-a-submit"><span role="status">{notice||(locked?'Submitted':(busy?'Saving…':''))}</span>
        {locked?<button className="button secondary" disabled={!ready} onClick={()=>{setEditable(prev=>({...prev,[letter]:true}));setNotice('');}}>Edit review</button>:
          <button className="button primary" disabled={disabled||conflict} onClick={()=>void submit()}>Submit review</button>}
      </div>
      {error&&<p className="error" role="alert">{error}</p>}{conflict&&<button className="button secondary" onClick={()=>{
        if(!dirty||window.confirm('Reload the latest reviews? Unsaved edits for this case will be discarded.'))reload();
      }}>Reload latest reviews</button>}
      {editor&&<ErrorForm editor={editor} original={editor.index===undefined?undefined:d.errors[editor.index]} save={saveError} close={()=>setEditor(null)}/>}
    </div>
  </ReportFrame>;
}

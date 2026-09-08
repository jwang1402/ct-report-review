import {useState} from 'react';
import {Check,Minus,X,RefreshCw} from 'lucide-react';
import type {CaseRelease,ModelReport,GitHubReview,Decision} from '../types';
import {decisionLabels} from '../types';
import {submitReview,updateReview} from '../services/reviews';
export function ReviewDecision({item,report,reviews,refresh}:{item:CaseRelease;report:ModelReport;reviews:GitHubReview[];refresh:()=>Promise<void>}){
 const [editing,setEditing]=useState<GitHubReview|null>(null),[saved,setSaved]=useState<GitHubReview|null>(null);
 const [name,setName]=useState(''),[decision,setDecision]=useState<Decision|undefined>(),[comment,setComment]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [submissionId,setSubmissionId]=useState(()=>crypto.randomUUID());
 const rows=saved?[...reviews.filter(r=>r.submission_id!==saved.submission_id),saved]:reviews;
 const form=!!editing||rows.length===0;
 function edit(r:GitHubReview){setEditing(r);setName(r.reviewer);setDecision(r.decision);setComment(r.comment);setError('');}
 async function submit(){if(!decision||!name.trim()||busy)return;setBusy(true);setError('');try{
  const input={schema:'ct-review-v1' as const,case_id:item.case_id,release_id:item.release_id,report_id:report.id,model_name:report.model_name,decision,reviewer:name.trim(),comment,submission_id:editing?.submission_id||submissionId};
  const result=editing?await updateReview(input,editing):await submitReview(input);setSaved(result);setEditing(null);setSubmissionId(crypto.randomUUID());await refresh();
 }catch(e){setError(e instanceof Error?e.message:'Could not save review.');}finally{setBusy(false);}}
 return <div className="decision-panel"><div className="section-heading"><h3>{editing?'Edit review':form?'Your review':'Submitted reviews'}</h3>{!form&&<button className="icon-button" aria-label="Refresh Reviews" disabled={busy} onClick={()=>{setSaved(null);void refresh();}}><RefreshCw size={15}/></button>}</div>
 {form?<><label>Doctor name <span className="required">required</span><input value={name} maxLength={100} disabled={busy} onChange={e=>setName(e.target.value)} placeholder="Enter your name" autoComplete="name"/></label><div className="decision-options" role="radiogroup" aria-label="Review decision">{([['ACCEPT',Check],['PARTIAL_ACCEPT',Minus],['REJECT',X]] as const).map(([value,Icon])=><label key={value} className={`decision ${value} ${decision===value?'chosen':''}`}><input type="radio" name="review-decision" checked={decision===value} disabled={busy} onChange={()=>setDecision(value)}/><Icon size={16}/>{value==='PARTIAL_ACCEPT'?'Partial':decisionLabels[value]}</label>)}</div><label>Comment {decision==='PARTIAL_ACCEPT'?<span className="required">required</span>:<span className="muted">optional</span>}<textarea rows={3} value={comment} maxLength={10000} disabled={busy} onChange={e=>setComment(e.target.value)} placeholder="Add clinical feedback…"/></label><button className="button primary full" disabled={busy||!name.trim()||!decision||decision==='PARTIAL_ACCEPT'&&!comment.trim()} onClick={()=>void submit()}>{busy?'Saving…':editing?'Save changes':'Submit Review'}<Check size={15}/></button>{editing&&<button className="button secondary full" disabled={busy} onClick={()=>{setEditing(null);setError('');}}>Cancel</button>}</>:rows.map(r=><div className="review-feedback" key={r.submission_id}><div><strong>{r.reviewer}</strong><span className={`badge ${r.decision}`}>{decisionLabels[r.decision]}</span></div>{r.comment&&<p>{r.comment}</p>}<div><small>{new Date(r.created_at).toLocaleString()}</small><button className="button secondary" disabled={busy} onClick={()=>edit(r)}>Edit</button></div></div>)}
 {error&&<div className="error" role="alert">{error}</div>}</div>;
}

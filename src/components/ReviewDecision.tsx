import {useState} from 'react';
import {Check,Minus,X,RefreshCw} from 'lucide-react';
import type {CaseRelease,ModelReport,GitHubReview,Decision} from '../types';
import {decisionLabels} from '../types';
import {submitCaseReviews,updateReview,deleteReview} from '../services/reviews';
type Draft={name:string;decision?:Decision;comment:string;submissionId:string;editing?:GitHubReview};
const empty=():Draft=>({name:'',comment:'',submissionId:crypto.randomUUID()});
const valid=(d?:Draft)=>!!d?.name.trim()&&!!d.decision&&(d.decision!=='PARTIAL_ACCEPT'||!!d.comment.trim());
export function ReviewDecision({item,report,reviews,refresh}:{item:CaseRelease;report:ModelReport;reviews:GitHubReview[];refresh:()=>Promise<void>}){
 const [drafts,setDrafts]=useState<Record<string,Draft>>(()=>Object.fromEntries(item.reports.map(r=>[r.id,empty()])));
 const [saved,setSaved]=useState<GitHubReview[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [deleted,setDeleted]=useState<string[]>([]);
 const rows=[...reviews.filter(r=>!saved.some(s=>s.submission_id===r.submission_id)),...saved].filter(r=>!deleted.includes(r.submission_id));
 const current=rows.filter(r=>r.report_id===report.id),draft=drafts[report.id]||empty();
 const form=!!draft.editing||current.length===0;
 const pending=item.reports.filter(r=>!rows.some(s=>s.report_id===r.id)||drafts[r.id]?.editing);
 const missing=pending.filter(r=>!valid(drafts[r.id]));
 const ready=missing.length===0&&pending.length>0;
 function change(patch:Partial<Draft>){setDrafts(all=>({...all,[report.id]:{...draft,...patch}}));}
 async function remove(r:GitHubReview){if(busy||!window.confirm('Delete this review by '+r.reviewer+'?'))return;setBusy(true);setError('');try{await deleteReview(r);setDeleted(all=>[...all,r.submission_id]);setSaved(all=>all.filter(s=>s.submission_id!==r.submission_id));setDrafts(all=>({...all,[r.report_id]:empty()}));await refresh();}catch(e){setError(e instanceof Error?e.message:'Could not delete review.');}finally{setBusy(false);}}
 function edit(r:GitHubReview){change({editing:r,name:r.reviewer,decision:r.decision,comment:r.comment,submissionId:r.submission_id});setError('');}
 async function submit(){if(!ready||busy)return;setBusy(true);setError('');try{
  const inputs=pending.map(r=>{const d=drafts[r.id];return {schema:'ct-review-v1' as const,case_id:item.case_id,release_id:item.release_id,report_id:r.id,model_name:r.model_name,decision:d.decision!,reviewer:d.name.trim(),comment:d.comment,submission_id:d.submissionId};});
  const fresh=inputs.filter(r=>!drafts[r.report_id].editing);
  if(fresh.length){const result=await submitCaseReviews(fresh);setSaved(all=>[...all.filter(r=>!result.some(s=>s.submission_id===r.submission_id)),...result]);}
  for(const input of inputs.filter(r=>drafts[r.report_id].editing)){const result=await updateReview(input,drafts[input.report_id].editing!);setSaved(all=>[...all.filter(r=>r.submission_id!==result.submission_id),result]);setDrafts(all=>({...all,[input.report_id]:empty()}));}
  setDrafts(all=>({...all,...Object.fromEntries(fresh.map(r=>[r.report_id,empty()]))}));await refresh();
 }catch(e){setError(e instanceof Error?e.message:'Could not save review.');}finally{setBusy(false);}}
 return <div className="decision-panel"><div className="section-heading"><h3>{draft.editing?'Edit review':form?'Your review':'Submitted reviews'}</h3>{!form&&<button className="icon-button" aria-label="Refresh Reviews" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15}/></button>}</div>
 {form?<><label>Doctor name <span className="required">required</span><input value={draft.name} maxLength={100} disabled={busy} onChange={e=>change({name:e.target.value})} placeholder="Enter your name" autoComplete="name"/></label><div className="decision-options" role="radiogroup" aria-label="Review decision">{([['ACCEPT',Check],['PARTIAL_ACCEPT',Minus],['REJECT',X]] as const).map(([value,Icon])=><label key={value} className={`decision ${value} ${draft.decision===value?'chosen':''}`}><input type="radio" name="review-decision" checked={draft.decision===value} disabled={busy} onChange={()=>change({decision:value})}/><Icon size={16}/>{value==='PARTIAL_ACCEPT'?'Partial':decisionLabels[value]}</label>)}</div><label>Comment {draft.decision==='PARTIAL_ACCEPT'?<span className="required">required</span>:<span className="muted">optional</span>}<textarea rows={3} value={draft.comment} maxLength={10000} disabled={busy} onChange={e=>change({comment:e.target.value})} placeholder="Add clinical feedback…"/></label>{draft.editing&&<button className="button secondary full" disabled={busy} onClick={()=>{setDrafts(all=>({...all,[report.id]:empty()}));setError('');}}>Cancel</button>}</>:current.map(r=><div className="review-feedback" key={r.submission_id}><div><strong>{r.reviewer}</strong><span className={`badge ${r.decision}`}>{decisionLabels[r.decision]}</span></div>{r.comment&&<p>{r.comment}</p>}<div><small>{new Date(r.created_at).toLocaleString()}</small><span className="actions"><button className="button secondary" disabled={busy} onClick={()=>edit(r)}>Edit</button><button className="button secondary" disabled={busy} onClick={()=>void remove(r)}>Delete</button></span></div></div>)}
 {pending.length>0&&<><p role="status">{item.reports.length-missing.length} / {item.reports.length} reports ready{missing.length>0?'. Complete: '+missing.map(r=>r.model_name).join(', '):''}</p><button className="button primary full" disabled={busy||!ready} onClick={()=>void submit()}>{busy?'Saving…':pending.every(r=>drafts[r.id]?.editing)?'Save changes':item.reports.length>1?'Submit all reports':'Submit Review'}<Check size={15}/></button></>}
 {error&&<div className="error" role="alert">{error}</div>}</div>;
}

import {useState,type ComponentType} from 'react';
import {Link} from 'react-router-dom';
import {Download, Eye, EyeOff, RefreshCw} from 'lucide-react';
import {useStudyData} from '../services/blindStudy';
import {compareCaseIds} from '../services/caseOrder';
import {api} from '../services/session';
import {message,saveFile} from '../utils';
import {findings,findingNames,type FindingMap} from '../services/studyAReview';
import {StudyAReference,type ExpertReference} from './StudyAReference';

type ErrorRecord={finding:string;other:string;type:'missed'|'unsupported'|'location'|'other';significant:boolean;detail:string;reported_location?:string;expected_location?:string};
type Assignment={case_id:string;letter:string;model_name:string};
type Result=Assignment&{username:string;display_name:string|null;rating:number;mode:'yes'|'no';confirmed:true;comment:string;errors:ErrorRecord[];updated_at:string;checklist_version:string;findings?:FindingMap|null};
type Reader={username:string;display_name:string|null;case_ids:string[];version:string};
type Payload={results:Result[];assignments:Assignment[];readers:Reader[]};
type DeleteProps={name:string;busy:boolean;error:string;cancel:()=>void;confirm:()=>void};

const errorNames={missed:'Missed finding',unsupported:'Unsupported finding',location:'Incorrect location / laterality',other:'Other description error'};
const shortId=(id:string)=>id.match(/(?:^|-)(Case\d+)$/)?.[1]??id;
const findingName=(e:ErrorRecord)=>e.finding==='other'?e.other:e.finding.replaceAll('_',' ');
const sortCases=(a:Assignment,b:Assignment)=>compareCaseIds(a.case_id,b.case_id)||a.letter.localeCompare(b.letter);

// CSV data may include free-text comments, finding names and reader-entered details.
function csv(cells:unknown[][]) {
  return '\ufeff'+cells.map(row=>row.map(value=>{
    let text=String(value??'');
    if(/^\s*[=+@-]|^[\t\r]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}

export function studyAExport(rows:Result[],reveal:boolean,kind:'reviews'|'errors'|'findings',refs:ExpertReference[]=[]) {
  const identity=['study','case','reader','reader_id','report','checklist_version',...(reveal?['model']:[])];
  const common=(r:Result)=>['Study A',shortId(r.case_id),r.display_name||r.username,r.username,r.letter,r.checklist_version,...(reveal?[r.model_name]:[])];
  if(kind==='findings'){
    const referenceByCase=new Map(refs.map(ref=>[ref.case_id,ref]));
    return csv([[...identity,'finding','report_mention','reference_status','reference_side','reference_version','comparison','reader_error_events','clinically_significant_events'],
      ...rows.flatMap(r=>findings.map(f=>{
        const ref=referenceByCase.get(r.case_id), item=ref?.findings[f], bit=r.findings?.[f];
        const comparison=!item?'reference_pending':bit==null?'report_checklist_unavailable':item.status==='indeterminate'?'indeterminate':
          bit===1?(item.status==='present'?'matched_present':'unsupported'):(item.status==='absent'?'matched_absent':'missed');
        const events=r.errors.filter(e=>e.finding===f);
        return [...common(r),findingNames[f],bit,item?.status,item?.side,ref?.version,comparison,events.length,events.filter(e=>e.significant).length];
      }))]);
  }
  if(kind==='errors')return csv([[...identity,'error_number','finding','error_type','clinically_significant','detail','reported_location','expected_location'],
    ...rows.flatMap(r=>r.errors.map((e,i)=>[...common(r),i+1,findingName(e),errorNames[e.type],e.significant?1:0,e.detail,e.reported_location,e.expected_location]))]);
  return csv([[...identity,'overall_quality','identified_errors','error_count','clinically_significant_errors','all_findings_reviewed','comment','updated_at'],
    ...rows.map(r=>[...common(r),r.rating,r.mode,r.errors.length,r.errors.filter(e=>e.significant).length,r.confirmed?1:0,r.comment,r.updated_at])]);
}

export function studyAProgress(reader:Reader,rows:Result[],assignments:Assignment[]) {
  const assignedCases=new Set(reader.case_ids);
  const expected=assignments.filter(a=>assignedCases.has(a.case_id));
  const saved=new Set(rows.filter(r=>r.username===reader.username).map(r=>r.case_id+'/'+r.letter));
  const pendingCases=new Set(expected.filter(a=>!saved.has(a.case_id+'/'+a.letter)).map(a=>a.case_id));
  const activeCases=new Set(expected.map(a=>a.case_id));
  return {reports:expected.filter(a=>saved.has(a.case_id+'/'+a.letter)).length,total:expected.length,completed:activeCases.size-pendingCases.size,cases:activeCases.size};
}

export function matchedModelResults(rows:Result[]){
  const sets=new Map<string,Result[]>();
  for(const r of rows){
    const key=JSON.stringify([r.username,r.case_id]);
    sets.set(key,[...(sets.get(key)??[]),r]);
  }
  const matched=[...sets.values()].filter(group=>new Set(group.map(r=>r.model_name)).size===3&&group.length===3).flat();
  const models=[...new Set(matched.map(r=>r.model_name))].sort();
  return models.map(model=>{
    const reviews=matched.filter(r=>r.model_name===model),events=reviews.flatMap(r=>r.errors);
    return {model,cases:new Set(reviews.map(r=>r.case_id)).size,reviews:reviews.length,
      significant:events.filter(e=>e.significant).length/reviews.length,missed:events.filter(e=>e.type==='missed').length,
      unsupported:events.filter(e=>e.type==='unsupported').length,location:events.filter(e=>e.type==='location').length,
      quality:reviews.reduce((total,r)=>total+r.rating,0)/reviews.length};
  });
}

export default function StudyAResults({DeleteDialog}:{DeleteDialog:ComponentType<DeleteProps>}) {
  const {data,error,refresh}=useStudyData<Payload>('/admin/study-a-results');
  const referenceData=useStudyData<{references:ExpertReference[]}>('/admin/study-a-references');
  const [selected,setSelected]=useState('');
  const [reveal,setReveal]=useState(false);
  const [removing,setRemoving]=useState<Reader|null>(null);
  const [deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
  const [notice,setNotice]=useState('');
  const assignments=[...(data?.assignments??[])].sort(sortCases);
  const readers=data?.readers??[], rows=data?.results??[];
  const filtered=rows.filter(r=>!selected||r.username===selected).sort((a,b)=>sortCases(a,b)||a.username.localeCompare(b.username));
  const readerNames=new Map(readers.map(r=>[r.username,r.display_name||r.username]));
  const visibleReaders=readers.filter(r=>!selected||r.username===selected);
  const cases=[...new Set(assignments.map(a=>a.case_id))];
  function exportResults(kind:'reviews'|'errors'|'findings') {
    saveFile(studyAExport(filtered,reveal,kind,referenceData.data?.references),'study-a-'+kind+(selected?'-reader':'')+(reveal?'-unblinded':'')+'.csv','text/csv;charset=utf-8');
  }
  async function removeReader(){
    if(!removing||deleting)return;
    setDeleting(true);setDeleteError('');
    try{
      await api('/admin/doctors/'+encodeURIComponent(removing.username),{method:'DELETE',body:JSON.stringify({version:removing.version})});
      setNotice((removing.display_name||removing.username)+' was deleted.');setRemoving(null);setSelected('');refresh();
    }catch(e){setDeleteError(message(e));}
    finally{setDeleting(false);}
  }
  const significant=filtered.reduce((n,r)=>n+r.errors.filter(e=>e.significant).length,0);
  const matched=matchedModelResults(filtered);
  return <>
    <div className="page-heading"><div><h1>Study A results</h1><p>Report quality and clinically significant errors</p></div>
      <div className="actions">
        <button className="button secondary" onClick={refresh}><RefreshCw size={15}/>Refresh</button>
        <button className="button secondary" disabled={!assignments.length} aria-pressed={reveal} onClick={()=>setReveal(!reveal)}>
          {reveal?<EyeOff size={15}/>:<Eye size={15}/>} {reveal?'Hide model names':'Show model names'}
        </button>
      </div>
    </div>
    {error?<p role="alert" className="error">{error}</p>:!data?<p role="status">Loading Study A results…</p>:<>
      <div className="reader-filter study-a-tools"><label>Reader<select value={selected} onChange={e=>setSelected(e.target.value)}>
        <option value="">All readers</option>
        {readers.map(r=><option key={r.username} value={r.username}>{readerNames.get(r.username)}</option>)}
      </select></label>
      <div className="actions"><button className="button secondary" disabled={!filtered.length||!referenceData.data} onClick={()=>exportResults('findings')}><Download size={15}/>Export findings</button>
        <button className="button secondary" disabled={!filtered.length} onClick={()=>exportResults('errors')}><Download size={15}/>Export errors</button>
        <button className="button primary" disabled={!filtered.length} onClick={()=>exportResults('reviews')}><Download size={15}/>Export reviews</button></div></div>
      <div className="summary-strip study-a-counts">
        <div><span>Submitted reviews<strong>{filtered.length}</strong></span></div>
        <div><span>Clinically significant errors<strong>{significant}</strong></span></div>
        <div><span>Significant errors per review<strong>{filtered.length?(significant/filtered.length).toFixed(2):'—'}</strong></span></div>
      </div>
      {notice&&<p role="status">{notice}</p>}
      {referenceData.data&&<StudyAReference cases={cases} references={referenceData.data.references} refresh={referenceData.refresh}/>}
      {referenceData.error&&<p role="alert" className="error">{referenceData.error} <button onClick={referenceData.refresh}>Reload references</button></p>}
      <section className="work-card results-group"><div className="section-heading"><h2>Reader progress</h2></div>
        {!visibleReaders.length?<p className="muted">No Study A readers enrolled.</p>:<div className="table-scroll"><table>
        <thead><tr><th>Reader</th><th>Reports submitted</th><th>Cases completed</th><th>Actions</th></tr></thead>
        <tbody>{visibleReaders.map(r=>{
          const p=studyAProgress(r,rows,assignments);
          return <tr key={r.username}><td>{readerNames.get(r.username)}</td><td>{p.reports} / {p.total}</td><td>{p.completed} / {p.cases}</td><td>
            <button className="button secondary" aria-label={'Delete reader '+readerNames.get(r.username)} onClick={()=>{setDeleteError('');setNotice('');setRemoving(r);}}>Delete</button></td></tr>;
        })}</tbody></table></div>}
      </section>
      {reveal&&<section className="work-card results-group"><div className="section-heading"><h2>Model key</h2></div><div className="table-scroll">
        <table><thead><tr><th>Case</th>{['A','B','C'].map(l=><th key={l}>Report {l}</th>)}</tr></thead>
        <tbody>{cases.map(id=><tr key={id}><td><Link to={'/admin/cases/'+encodeURIComponent(id)}>{shortId(id)}</Link></td>
          {['A','B','C'].map(l=><td key={l}>{assignments.find(a=>a.case_id===id&&a.letter===l)?.model_name??'—'}</td>)}</tr>)}</tbody></table>
      </div></section>}
      {reveal&&<section className="work-card results-group"><div className="section-heading"><h2>Matched report comparison</h2></div>
        <p className="muted">Includes a case for a reader once all three reports have been rated.</p>
        {!matched.length?<p>No complete sets for this selection.</p>:<div className="table-scroll"><table>
          <thead><tr><th>Model</th><th>Cases</th><th>Rated reports</th><th>Significant errors per report</th><th>Missed</th><th>Unsupported</th><th>Location errors</th><th>Mean quality (1–5)</th></tr></thead>
          <tbody>{matched.map(r=><tr key={r.model}><td>{r.model}</td><td>{r.cases}</td><td>{r.reviews}</td><td>{r.significant.toFixed(2)}</td>
            <td>{r.missed}</td><td>{r.unsupported}</td><td>{r.location}</td><td>{r.quality.toFixed(2)}</td></tr>)}</tbody></table></div>}
      </section>}
      <section className="work-card results-group"><div className="section-heading"><h2>Submitted reviews</h2></div>
        {!filtered.length?<p className="muted">No submitted reviews for this selection.</p>:<div className="table-scroll"><table>
          <thead><tr><th>Case</th><th>Reader</th><th>Report</th>{reveal&&<th>Model</th>}<th>Overall quality</th><th>Errors recorded</th><th>Comment</th><th>Last saved</th></tr></thead>
          <tbody>{filtered.map(r=><tr key={r.case_id+'/'+r.username+'/'+r.letter}>
            <td><Link to={'/admin/cases/'+encodeURIComponent(r.case_id)}>{shortId(r.case_id)}</Link></td><td>{readerNames.get(r.username)||r.display_name||r.username}</td><td>{r.letter}</td>{reveal&&<td>{r.model_name}</td>}
            <td>{r.rating} / 5</td><td>{!r.errors.length?'None identified':<details><summary>{r.errors.length} total · {r.errors.filter(e=>e.significant).length} significant</summary>
              <ul className="admin-study-errors">{r.errors.map((e,i)=><li key={i}><strong>{findingName(e)}</strong> · {errorNames[e.type]} · {e.significant?'Clinically significant':'Minor'}{e.detail&&<p>{e.detail}</p>}</li>)}</ul>
            </details>}</td><td className="comment-cell">{r.comment||'—'}</td><td>{new Date(r.updated_at).toLocaleString('en-US')}</td>
          </tr>)}</tbody></table></div>}
      </section>
    </>}
    {removing&&<DeleteDialog name={removing.display_name||removing.username} busy={deleting} error={deleteError}
      cancel={()=>setRemoving(null)} confirm={()=>void removeReader()}/>}
  </>;
}

import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Activity,ChevronRight,Download,Eye,EyeOff,FileText,RefreshCw} from 'lucide-react';
import {useStudyData,exportBlindResults,type StudyResult} from '../services/blindStudy';
import {decisionLabels,ratings,type Rating} from '../types';
import {message,saveFile} from '../utils';
import {api,ResponseError} from '../services/session';
import {compareCaseIds} from '../services/caseOrder';
import StudyAResults from './StudyAResults';
import './AdminResults.css';

type RosterEntry={username:string;display_name:string|null;version:string};
export function summarizeReaders(rows:StudyResult[],roster:RosterEntry[]=[]) {
  type Progress={id:string;name:string;cases:Map<string,Set<string>>;total:number;rated:number};
  const byReader=new Map<string,Progress>();
  for (const r of roster) {
    byReader.set(r.username,{id:r.username,name:r.display_name||r.username,cases:new Map(),total:0,rated:0});
  }
  for(const r of rows) {
    const reader=byReader.get(r.username)??{id:r.username,name:r.display_name||r.username,cases:new Map<string,Set<string>>(),total:0,rated:0};
    byReader.set(r.username,reader);
    const letters=reader.cases.get(r.case_id)??new Set<string>();
    reader.cases.set(r.case_id,letters);
    if(r.rating!==null){
      letters.add(r.letter);
      reader.total+=r.rating;
      reader.rated++;
    }
  }
  const nameCounts=new Map<string,number>();
  for(const r of byReader.values())nameCounts.set(r.name,(nameCounts.get(r.name)??0)+1);
  return Array.from(byReader.values(),r=>({
    id:r.id,name:(nameCounts.get(r.name)??0)>1?r.name+' · '+r.id.slice(-8):r.name,
    completed:Array.from(r.cases.values()).filter(letters=>letters.size===4).length,
    assigned:r.cases.size,mean:r.rated?(r.total/r.rated).toFixed(2):'—'
  })).sort((a,b)=>a.name.localeCompare(b.name));
}

function ConfirmDeleteReader({name,busy,error,cancel,confirm}:{name:string;busy:boolean;error:string;cancel:()=>void;confirm:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const element=dialog.current!;
    element.showModal();
    return ()=>element.close();
  },[]);
  return <dialog ref={dialog} className="form-card remove-dialog reader-delete-dialog" aria-labelledby="delete-reader-title"
    onCancel={event=>{event.preventDefault();if(!busy)cancel();}}>
    <h2 id="delete-reader-title">Delete reader?</h2>
    <p>This permanently deletes <strong>{name}</strong> and all of their ratings and comments across studies, and ends their current sessions.</p>
    {error&&<p className="error" role="alert">{error}</p>}
    <div className="actions"><button className="button secondary" autoFocus disabled={busy} onClick={cancel}>Cancel</button>
      <button className="button delete-reader" disabled={busy} onClick={confirm}>{busy?'Deleting…':'Delete reader'}</button></div>
  </dialog>;
}

export default function AdminResults() {
  const [view,setView]=useState<'study-a'|'legacy'>('study-a');
  return <main className="page">
    <nav className="admin-results-switch" aria-label="Results protocol">
      <button type="button" aria-pressed={view==='study-a'} onClick={()=>setView('study-a')}>Study A</button>
      <Link className="button secondary" to="/admin/study-b">Study B</Link>
      <button type="button" aria-pressed={view==='legacy'} onClick={()=>setView('legacy')}>Previous ratings</button>
    </nav>
    {view==='study-a'?<StudyAResults DeleteDialog={ConfirmDeleteReader}/>:<LegacyResults/>}
  </main>;
}

function LegacyResults() {
  const {data,error,refresh}=useStudyData<{results:StudyResult[];readers?:RosterEntry[]}>('/admin/results');
  const [reader,setReader]=useState('');
  const [revealed,setRevealed]=useState(false);
  const [target,setTarget]=useState<{username:string;name:string;version:string}|null>(null);
  const [deleting,setDeleting]=useState(false);
  const [deleteError,setDeleteError]=useState('');
  const [notice,setNotice]=useState('');
  const rows=data?.results??[];
  const roster=new Map(data?.readers?.map(r=>[r.username,r]));
  const readers=summarizeReaders(rows,data?.readers);
  const names=new Map(readers.map(r=>[r.id,r.name]));
  const selected=names.has(reader)?reader:'';
  const visible=rows.filter(r=>!selected||r.username===selected).sort((a,b)=>compareCaseIds(a.case_id,b.case_id));
  const progress=selected?readers.filter(r=>r.id===selected):readers;
  const byCase=new Map<string,StudyResult[]>();
  const histogram=new Map<number,number>();
  for(const r of visible){
    const group=byCase.get(r.case_id);
    if(group)group.push(r);else byCase.set(r.case_id,[r]);
    if(r.rating!==null)histogram.set(r.rating,(histogram.get(r.rating)??0)+1);
  }

  function exportView() {
    const records=revealed?visible:visible.map(r=>({...r,model_name:''}));
    const tag=selected?selected.replace(/[^\w-]/g,'-'):'all';
    saveFile(exportBlindResults(records),'reader-results-'+tag+(revealed?'-unblinded':'')+'.csv','text/csv;charset=utf-8');
  }
  async function deleteReader() {
    if(!target||deleting)return;
    setDeleting(true);setDeleteError('');
    try {
      await api('/admin/doctors/'+encodeURIComponent(target.username),{
        method:'DELETE',body:JSON.stringify({version:target.version})
      });
      if(selected===target.username)setReader('');
      setTarget(null);setNotice(target.name+' was deleted.');refresh();
    } catch (err) {
      if(err instanceof ResponseError && (err.status===409||err.status===404)){
        setTarget(null);setNotice(message(err));refresh();
      }else setDeleteError(message(err));
    } finally {setDeleting(false);}
  }
  return <>
    <div className="page-heading"><div><h1>Previous ratings</h1><p>Four-report reviews · Findings quality, 1–5</p></div>
      <div className="actions">
        <button className="button secondary" onClick={refresh}><RefreshCw size={15}/> Refresh Reviews</button>
        <button className="button secondary" disabled={!visible.length} aria-pressed={revealed} onClick={()=>setRevealed(s=>!s)}>
          {revealed?<EyeOff size={15}/>:<Eye size={15}/>} {revealed?'Hide model names':'Show model names'}
        </button>
        <button className="button primary" disabled={!visible.length} onClick={exportView}><Download size={15}/> Export CSV</button>
      </div>
    </div>
    {notice&&<p role="status">{notice}</p>}
    {target&&<ConfirmDeleteReader name={target.name} busy={deleting} error={deleteError} cancel={()=>setTarget(null)} confirm={()=>void deleteReader()}/>}
    {error?<p className="error" role="alert">{error}</p>:!data?<p role="status">Loading reader results…</p>:
      !readers.length?<div className="work-card empty"><Activity size={30}/><h2>No readers yet</h2>
        <Link className="button secondary" to="/admin/cases">Open Clinical Review <ChevronRight size={15}/></Link></div>:<>
        <div className="reader-filter"><label>Reader<select value={selected} onChange={e=>setReader(e.target.value)}>
          <option value="">All readers</option>
          {readers.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label></div>
        <div className="summary-strip results-counts">
          <div><FileText/><span>Submitted ratings<strong>{Array.from(histogram.values()).reduce((sum,n)=>sum+n,0)}</strong></span></div>
          {ratings.map(v=><div key={v}><span>{decisionLabels[v]}<strong>{histogram.get(Number(v))??0}</strong></span></div>)}
        </div>
        <section className="work-card results-group"><div className="section-heading"><h2>Reader progress</h2>
          <span className="muted">{progress.length} {progress.length===1?'reader':'readers'}</span></div>
          <div className="table-scroll"><table><thead><tr>
            <th>Reader</th><th>Completed cases</th><th>Assigned cases</th><th>Mean rating (1–5)</th><th>Actions</th>
          </tr></thead><tbody>{progress.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.completed}</td><td>{r.assigned}</td><td>{r.mean}</td>
            <td><button className="button secondary" aria-label={'Delete reader '+r.name} disabled={!roster.has(r.id)} onClick={()=>{
              const entry=roster.get(r.id);
              if(entry){setTarget({username:r.id,name:r.name,version:entry.version});setNotice('');setDeleteError('');}
            }}>Delete</button></td></tr>)}</tbody></table></div>
        </section>
        {Array.from(byCase,([id,entries])=><section className="work-card results-group" key={id}>
          <div className="section-heading"><h2><Link className="review-link" to={'/admin/cases/'+encodeURIComponent(id)}>{id}</Link></h2></div>
          <div className="table-scroll"><table><thead><tr><th>Reader</th><th>Report</th>{revealed&&<th>Model</th>}
            <th>Findings quality</th><th>Comment</th><th>Last saved</th>
          </tr></thead><tbody>{entries.map(r=><tr key={r.username+'/'+r.letter}>
            <td>{names.get(r.username)}</td><td>{r.letter}</td>{revealed&&<td>{r.model_name}</td>}
            <td>{r.rating===null?'Pending':<span className="badge">{decisionLabels[String(r.rating) as Rating]}</span>}</td>
            <td className="comment-cell">{r.comment||'—'}</td><td>{r.updated_at?new Date(r.updated_at).toLocaleDateString('en-US'):'—'}</td>
          </tr>)}</tbody></table></div>
        </section>)}
      </>}
  </>;
}

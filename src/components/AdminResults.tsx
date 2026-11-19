import {useState} from 'react';
import {Link} from 'react-router-dom';
import {Activity,ChevronRight,Download,Eye,EyeOff,FileText,RefreshCw} from 'lucide-react';
import {useStudyData,exportBlindResults,type StudyResult} from '../services/blindStudy';
import {decisionLabels,ratings,type Rating} from '../types';
import {saveFile} from '../utils';

export function summarizeReaders(rows:StudyResult[]) {
  type Progress={id:string;name:string;cases:Map<string,Set<string>>;total:number;rated:number};
  const byReader=new Map<string,Progress>();
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

export default function AdminResults() {
  const {data,error,refresh}=useStudyData<{results:StudyResult[]}>('/admin/results');
  const [reader,setReader]=useState('');
  const [revealed,setRevealed]=useState(false);
  const rows=data?.results??[];
  const readers=summarizeReaders(rows);
  const names=new Map(readers.map(r=>[r.id,r.name]));
  const selected=names.has(reader)?reader:'';
  const visible=selected?rows.filter(r=>r.username===selected):rows;
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
  return <main className="page">
    <div className="page-heading"><div><h1>Review results</h1><p>Findings quality ratings: 1 = Poor, 5 = Excellent.</p></div>
      <div className="actions">
        <button className="button secondary" onClick={refresh}><RefreshCw size={15}/> Refresh Reviews</button>
        <button className="button secondary" disabled={!visible.length} aria-pressed={revealed} onClick={()=>setRevealed(s=>!s)}>
          {revealed?<EyeOff size={15}/>:<Eye size={15}/>} {revealed?'Hide model names':'Show model names'}
        </button>
        <button className="button primary" disabled={!visible.length} onClick={exportView}><Download size={15}/> Export CSV</button>
      </div>
    </div>
    {error?<p className="error" role="alert">{error}</p>:!data?<p role="status">Loading reader results…</p>:
      !rows.length?<div className="work-card empty"><Activity size={30}/><h2>No reader assignments yet</h2>
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
            <th>Reader</th><th>Completed cases</th><th>Assigned cases</th><th>Mean rating (1–5)</th>
          </tr></thead><tbody>{progress.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.completed}</td><td>{r.assigned}</td><td>{r.mean}</td></tr>)}</tbody></table></div>
        </section>
        {Array.from(byCase,([id,entries])=><section className="work-card results-group" key={id}>
          <div className="section-heading"><h2><Link className="review-link" to={'/admin/cases/'+encodeURIComponent(id)}>{id}</Link></h2></div>
          <div className="table-scroll"><table><thead><tr><th>Reader</th><th>Report</th>{revealed&&<th>Model</th>}
            <th>Findings quality</th><th>Comment</th><th>Last saved</th>
          </tr></thead><tbody>{entries.map(r=><tr key={r.username+'/'+r.letter}>
            <td>{names.get(r.username)}</td><td>{r.letter}</td>{revealed&&<td>{r.model_name}</td>}
            <td>{r.rating===null?'Pending':<span className="badge">{decisionLabels[String(r.rating) as Rating]}</span>}</td>
            <td className="comment-cell">{r.comment||'—'}</td><td>{r.updated_at?new Date(r.updated_at).toLocaleDateString():'—'}</td>
          </tr>)}</tbody></table></div>
        </section>)}
      </>}
  </main>;
}

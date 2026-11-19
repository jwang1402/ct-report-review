import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useStudyData,exportBlindResults,type StudyResult} from '../services/blindStudy';
import {saveFile} from '../utils';

export default function AdminResults() {
  const {data,error,refresh}=useStudyData<{results:StudyResult[]}>('/admin/results');
  const [reader,setReader]=useState('');
  const rows=data?.results;
  const readers=Array.from(new Set(rows?.map(row=>row.username))).sort((a,b)=>a.localeCompare(b));
  const selectedReader=readers.includes(reader)?reader:'';
  const visible=selectedReader?rows?.filter(row=>row.username===selectedReader):rows;
  const submitted=visible?.filter(row=>row.rating!==null).length;
  function exportView() {
    if(!visible?.length)return;
    const name=selectedReader?'reader-results-'+selectedReader+'.csv':'reader-results.csv';
    saveFile(exportBlindResults(visible),name,'text/csv;charset=utf-8');
  }

  return <main className="page">
    <div className="page-heading"><div><h1>Reader results</h1>
      {rows&&<p>{readers.length} assigned {readers.length===1?'reader':'readers'}</p>}
    </div><div className="actions">
      <button className="button secondary" onClick={refresh}>Refresh</button>
      <button className="button primary" disabled={!visible?.length} onClick={exportView}>
        {selectedReader?'Export CSV for '+selectedReader:'Export CSV for all readers'}
      </button>
    </div></div>
    {error?<p className="error" role="alert">{error}</p>:!rows?<p role="status">Loading reader results…</p>:
      !rows.length?<p>No assigned reports.</p>:<>
        <div className="reader-filter">
          <label>Reader<select value={selectedReader} onChange={event=>setReader(event.target.value)}>
            <option value="">All readers</option>
            {readers.map(name=><option key={name} value={name}>{name}</option>)}
          </select></label>
          <span aria-live="polite">{selectedReader||'All readers'} · {submitted} of {visible?.length} assigned ratings submitted</span>
        </div>
        <div className="work-card table-scroll"><table><thead><tr><th>Case</th><th>Reader</th><th>Letter</th><th>Model</th><th>Rating</th><th>Comment</th><th>Last saved</th></tr></thead>
          <tbody>{visible?.map(r=><tr key={JSON.stringify([r.case_id,r.username,r.letter])}>
            <td><Link className="review-link" to={'/admin/cases/'+encodeURIComponent(r.case_id)}>{r.case_id}</Link></td><td>{r.username}</td><td>{r.letter}</td><td>{r.model_name}</td><td>{r.rating??'Pending'}</td><td className="comment-cell">{r.comment||'—'}</td><td>{r.updated_at||'—'}</td>
          </tr>)}</tbody></table></div>
      </>}
  </main>;
}

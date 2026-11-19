import {useEffect,useState} from 'react';
import {listReviews} from './services/reviews';
import {reviewsCSV} from './services/github/issues';
import type {GitHubReview} from './types';
import {decisionLabels} from './types';
import {message,saveFile} from './utils';

export default function LegacyWorkspace() {
  const [reviews,setReviews]=useState<GitHubReview[]|null>(null);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let active=true;
    setError('');
    listReviews().then(data=>{if(active)setReviews(data.reviews);})
      .catch(e=>{if(active)setError(message(e));});
    return ()=>{active=false;};
  },[retry]);
  return <main className="page">
    <div className="page-heading"><h1>Previous reviews</h1>
      <button className="button secondary" disabled={!reviews?.length} onClick={()=>saveFile(reviewsCSV(reviews??[],new Map()),'previous-reviews.csv','text/csv')}>Export CSV</button>
    </div>
    {error?<p role="alert">{error} <button className="button secondary" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>
      :!reviews?<p role="status">Loading previous reviews…</p>
      :!reviews.length?<p>No previous reviews.</p>
      :<div className="work-card table-scroll"><table><thead><tr><th>Case</th><th>Reported reviewer</th><th>Model</th><th>Rating</th><th>Comment</th><th>Submitted</th></tr></thead>
        <tbody>{reviews.map(row=><tr key={row.submission_id}><td>{row.case_id}</td><td>{row.reviewer}</td><td>{row.model_name}</td><td>{decisionLabels[row.decision]}</td><td className="comment-cell">{row.comment||'—'}</td><td>{row.created_at}</td></tr>)}</tbody></table></div>}
  </main>;
}

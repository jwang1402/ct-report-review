import {ChevronRight} from 'lucide-react';
import {Link} from 'react-router-dom';
import {useStudyData} from '../services/blindStudy';
import type {Configuration} from '../services/studyB';
import {caseIds} from '../services/studyBImport';
import {isStudyBCaseUploaded,studyBUploadCount} from '../services/studyBInventory';
import './StudyBInventory.css';

export function StudyBInventory() {
  const {data,error,refresh}=useStudyData<Configuration>('/admin/study-b');
  const saved=data?.cases??[];
  const uploaded=studyBUploadCount(saved);
  const frozen=data?.status==='frozen';
  const uploadLink='/admin/upload?study=B';
  return <section className="work-card study-b-inventory" aria-label="Study B case inventory">
    <div className="section-heading">
      <h2>Study B</h2>
      {data&&<span className="muted">{frozen?'Open to readers':'Not open to readers'}</span>}
      <Link className="review-link push-right" to={uploadLink}>Manage cases<ChevronRight size={15}/></Link>
    </div>
    <div className="study-b-inventory-body">
      {error?<p role="alert">{error} <button className="button secondary" onClick={refresh}>Retry</button></p>
        :!data?<p role="status">Loading Study B cases…</p>
        :<>
          <p><strong>{uploaded} / {caseIds.length} cases uploaded</strong>
            {uploaded===caseIds.length&&<span className="badge good">Upload complete</span>}</p>
          {saved.length>0&&<details>
            <summary>View saved cases ({saved.length})</summary>
            <ul>{saved.map(c=><li key={c.case_id}>
              <Link to={uploadLink+'&case='+encodeURIComponent(c.case_id)}>
                <strong>{c.case_id}</strong><span>{isStudyBCaseUploaded(c)?'Uploaded':'Incomplete'}</span>
                <ChevronRight size={13} aria-hidden="true"/>
              </Link>
            </li>)}</ul>
          </details>}
        </>}
    </div>
  </section>;
}

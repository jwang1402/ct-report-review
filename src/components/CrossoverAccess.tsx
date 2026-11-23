import {useState} from 'react';
import {useStudyData} from '../services/blindStudy';
import {api,type Cohort} from '../services/session';
import {message} from '../utils';

type Reader={username:string;display_name:string;cohort:Cohort};
type Pending={id:string;requested_name:string;cohort:Cohort;created_at:number};
export default function CrossoverAccess(){
  const {data,refresh,error}=useStudyData<{readers:Reader[];pending:Pending[]}>('/admin/crossover-access');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failure,setFailure]=useState('');
  const [target,setTarget]=useState<Record<string,string>>({});
  async function save(action:string,body:Record<string,string>){
    setBusy(true);setFailure('');setNotice('');
    try{await api('/admin/crossover-access',{method:'POST',body:JSON.stringify({action,...body})});setNotice('Reader access updated.');refresh();}
    catch(e){setFailure(message(e));}finally{setBusy(false);}
  }
  return <main className="page"><div className="page-heading"><h1>Reader access</h1><button className="button secondary" onClick={refresh}>Refresh</button></div>
    {error&&<p role="alert">{error}</p>}{failure&&<p role="alert">{failure}</p>}{notice&&<p role="status">{notice}</p>}
    {data&&<><section className="work-card"><h2>Device requests</h2><p>Confirm the reader’s identity directly before linking a new browser.</p>
      {!data.pending.length&&<p>No pending requests.</p>}
      {data.pending.map(q=><div className="work-card" key={q.id}><h3>{q.requested_name} · {q.cohort}</h3><p>Device request {q.id.slice(0,8)}</p>
        <label>Reader record<select value={target[q.id]??''} onChange={e=>setTarget({...target,[q.id]:e.target.value})}>
          <option value="">Select verified reader</option>{data.readers.filter(r=>r.cohort===q.cohort).map(r=><option key={r.username} value={r.username}>{r.display_name} · {r.username}</option>)}</select></label>
        <div className="actions"><button className="button primary" disabled={busy||!target[q.id]} onClick={()=>{
          if(window.confirm('Grant this device access to the selected reader’s private assessments?'))void save('link',{id:q.id,username:target[q.id]});
        }}>Link verified device</button><button className="button secondary" disabled={busy} onClick={()=>void save('dismiss',{id:q.id})}>Dismiss</button></div>
      </div>)}</section><section className="work-card"><h2>Reader records</h2>{!data.readers.length&&<p>No readers have entered yet.</p>}
      {data.readers.map(r=><div className="section-heading" key={r.username}><div><strong>{r.display_name}</strong><small> · {r.cohort} · {r.username}</small></div>
        <button className="button secondary" disabled={busy} onClick={()=>{const name=prompt('Display name',r.display_name)?.trim();
          if(name&&name!==r.display_name)void save('rename',{username:r.username,name});
        }}>Correct name</button></div>)}</section></>}
  </main>
}

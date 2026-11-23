import {useState} from 'react';
import {useStudyData} from '../services/blindStudy';
import {api,type Cohort} from '../services/session';
import {message} from '../utils';

type Reader={username:string;display_name:string;cohort:Cohort};
export default function CrossoverAccess(){
  const {data,refresh,error}=useStudyData<{readers:Reader[]}>('/admin/crossover-access');
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[failure,setFailure]=useState('');
  async function rename(username:string,name:string){
    setBusy(true);setFailure('');setNotice('');
    try{await api('/admin/crossover-access',{method:'POST',body:JSON.stringify({action:'rename',username,name})});setNotice('Reader name updated.');refresh();}
    catch(e){setFailure(message(e));}finally{setBusy(false);}
  }
  return <main className="page"><div className="page-heading"><h1>Reader access</h1><button className="button secondary" onClick={refresh}>Refresh</button></div>
    {error&&<p role="alert">{error}</p>}{failure&&<p role="alert">{failure}</p>}{notice&&<p role="status">{notice}</p>}
    {data&&<section className="work-card"><h2>Reader records</h2>{!data.readers.length&&<p>No readers have entered yet.</p>}
      {data.readers.map(r=><div className="section-heading" key={r.username}><div><strong>{r.display_name}</strong><small> · {r.cohort} · {r.username}</small></div>
        <button className="button secondary" disabled={busy} onClick={()=>{const name=prompt('Display name',r.display_name)?.trim();
          if(name&&name!==r.display_name)void rename(r.username,name);
        }}>Correct name</button></div>)}</section>}
  </main>
}

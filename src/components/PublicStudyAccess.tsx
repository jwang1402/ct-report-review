import {useEffect,useRef,useState} from 'react';
import {useStudyData} from '../services/blindStudy';
import {api} from '../services/session';
import {verifyPublicDriveCase} from '../services/publicDriveMedia';
import {message} from '../utils';

interface Study {prefix:string; case_count:number; enabled:boolean}
interface Image {case_id:string;drive_url:string;size:number;sha256:string}
export default function PublicStudyAccess(){
  const list=useStudyData<{studies:Study[]}>('/admin/public-studies');
  const [selected,setSelected]=useState('');
  const [approved,setApproved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const operation=useRef<AbortController|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[]);
  const study=list.data?.studies.find(s=>s.prefix===selected)??list.data?.studies[0];
  async function change(){
    if(!study||operation.current||(!study.enabled&&!approved))return;
    const controller=new AbortController();
    operation.current=controller;
    setBusy(true);setError('');setNotice('');
    try{
      if(!study.enabled){
        const data:{images:Image[]}=await api('/admin/public-studies/'+encodeURIComponent(study.prefix)+'/images',{signal:controller.signal});
        if(!data.images.length||data.images.length!==study.case_count)throw new Error('Unable to verify all CT files in this study.');
        for(const image of data.images){
          setNotice('Checking public CT access · '+image.case_id);
          await verifyPublicDriveCase(image.drive_url,image,controller.signal);
        }
      }
      await api('/admin/public-studies',{method:'POST',signal:controller.signal,body:JSON.stringify({prefix:study.prefix,enabled:!study.enabled})});
      setApproved(false);setNotice(study.enabled?'Public review closed.':'Public review is open.');list.refresh();
    }catch(e){if(!controller.signal.aborted){setError(message(e));setNotice('');}}
    finally{operation.current=null;setBusy(false);}
  }
  return <section className="work-card public-study-access"><h2>Public reader access</h2>
    {list.error?<p className="error">{list.error} <button className="button secondary" onClick={list.refresh}>Retry</button></p>
      :!list.data?<p role="status">Loading studies…</p>
      :!study?<p>No eligible studies have been published.</p>:<>
        <label>Study<select value={study.prefix} disabled={busy} onChange={e=>{setSelected(e.currentTarget.value);setApproved(false);setNotice('');setError('');}}>
          {list.data.studies.map(s=><option key={s.prefix} value={s.prefix}>{s.prefix} · {s.case_count} cases · {s.enabled?'Open':'Closed'}</option>)}
        </select></label>
        {study.enabled?<p>Anyone with the doctor link can enter a name and review this study. Closing entry here leaves Drive sharing settings in place.</p>:<>
          <p>For name-only access, share the approved CT files in Drive with “Anyone with the link” and allow downloads.</p>
          <label className="reader-consent"><input type="checkbox" checked={approved} disabled={busy}
            onChange={e=>setApproved(e.currentTarget.checked)}/>These cases and reports are approved for public sharing</label>
        </>}
        <button className={study.enabled?'button secondary':'button primary'} disabled={busy||(!approved&&!study.enabled)} onClick={()=>void change()}>
          {busy?'Updating…':study.enabled?'Close public review':'Open public review'}
        </button>
      </>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error">{error}</p>}
  </section>;
}

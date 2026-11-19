import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {parseStudyPackets,type StudyPackets} from '../services/studyPackets';
import {uploadStudy,type UploadProgress} from '../services/studyUpload';
import {useStudyData} from '../services/blindStudy';
import {message,sizeLabel} from '../utils';
import {api} from '../services/session';
import {validateDriveLinks} from '../services/restrictedDrive';
import {verifyPublicDriveCase} from '../services/publicDriveMedia';
import DriveLinks from './DriveLinks';
import DriveFolderUpload from './DriveFolderUpload';

const inputs=[
  {key:'images',label:'CT volumes',filename:'Reader_Images.zip'},
  {key:'reader',label:'Anonymous reports',filename:'Reader01.zip'},
  {key:'coordinator',label:'Model key',filename:'Coordinator_ONLY.zip'},
] as const;
type Files=Partial<Record<typeof inputs[number]['key'],File>>;

export default function AdminUpload() {
  const [files,setFiles]=useState<Files>({});
  const [source,setSource]=useState<'drive'|'r2'>('drive');
  const [links,setLinks]=useState<Record<string,string>>({});
  const [driveBusy,setDriveBusy]=useState(false);
  const [publicAccess,setPublicAccess]=useState(false);
  const [prefix,setPrefix]=useState('BR4shared');
  const [packets,setPackets]=useState<StudyPackets|null>(null);
  const [busy,setBusy]=useState<'verify'|'upload'|null>(null);
  const [phase,setPhase]=useState('');
  const [progress,setProgress]=useState<UploadProgress|null>(null);
  const [error,setError]=useState('');
  const [done,setDone]=useState<'published'|'existing'|null>(null);
  const [doctors,setDoctors]=useState<string[]>([]);
  const roster=useStudyData<{doctors:string[]}>('/admin/doctors');
  const storage=useStudyData<{ready:boolean}>('/admin/storage');
  const operation=useRef<AbortController|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[]);
  useEffect(()=>{
    if(!busy&&!driveBusy) return;
    function warn(e:BeforeUnloadEvent){e.preventDefault();e.returnValue='';}
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[busy,driveBusy]);
  const volumeBytes=packets?.cases.reduce((sum,c)=>sum+c.size,0)??0;
  async function verify() {
    const {images,reader,coordinator}=files;
    if(!images||!reader||!coordinator||operation.current)return;
    const controller=new AbortController();
    operation.current=controller;
    setBusy('verify');setError('');setPhase('Checking study files…');
    try {
      const verified=await parseStudyPackets({images,reader,coordinator},setPhase,controller.signal);
      controller.signal.throwIfAborted();
      setPackets(verified);setPhase('');
    } catch(e) {
      if(!controller.signal.aborted)setError(message(e));
    } finally {operation.current=null;setBusy(null);}
  }
  async function publish() {
    if(!packets||operation.current||driveBusy||done||(source==='r2'&&!storage.data?.ready))return;
    const controller=new AbortController();
    operation.current=controller;
    setError('');setBusy('upload');
    try {
      if(source==='drive'){
        validateDriveLinks(packets.cases.map(c=>c.case_id),links);
        if(publicAccess){
          for(const c of packets.cases){
            setPhase('Checking public CT access · '+c.case_id);
            await verifyPublicDriveCase(links[c.case_id].trim(),c,controller.signal);
          }
          setPhase('Publishing study…');
        }
        await api('/admin/drive-studies',{method:'POST',signal:controller.signal,
          body:JSON.stringify({prefix,doctors,public_access:publicAccess,cases:packets.cases.map(c=>({...c,drive_url:links[c.case_id].trim()}))})});
        setDone('published');
      } else {
        setProgress({bytes:0,message:'Opening upload session…'});
        setDone(await uploadStudy(packets,prefix,doctors,controller.signal,setProgress));
      }
    } catch(e) {
      if(controller.signal.aborted)setPhase('Upload paused. Resume with the same study files.');
      else setError(message(e));
    } finally {operation.current=null;setBusy(null);}
  }
  const validPrefix=/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(prefix);
  if(done)return <main className="page study-upload"><h1>{done==='published'?'Study published':'Study already published'}</h1>
    <p>{prefix} · {packets?.cases.length} cases</p>
    <div className="actions"><Link className="button primary" to="/admin">View cases</Link><Link className="button secondary" to="/admin/readers">Manage readers</Link></div>
  </main>;
  return <main className="page study-upload">
    <div className="page-heading"><div><h1>Upload study</h1><p>Import the CT volumes and four anonymous reports per case.</p></div></div>
    <section className="work-card study-panel"><label>CT storage
      <select value={source} disabled={!!busy||driveBusy} onChange={e=>{setSource(e.target.value as 'drive'|'r2');setPublicAccess(false);setProgress(null);setError('');setPhase('');}}>
        <option value="drive">Google Drive</option><option value="r2">Cloudflare R2</option>
      </select></label>
      {source==='drive'&&<p>The browser checks the three ZIP files on this computer. The website stores reports and Drive links. CT files stay in your Drive.</p>}
    </section>
    {source==='r2'&&(storage.error?<p className="error" role="alert">Storage check failed. {storage.error} <button className="button secondary" onClick={storage.refresh}>Retry</button></p>
      :storage.data?.ready===false?<p className="study-storage-status" role="status">Activate private CT storage to publish. You can verify the files on this computer now. <button className="button secondary" onClick={storage.refresh}>Check again</button></p>
      :!storage.data?<p role="status">Checking private CT storage…</p>:null)}
    <section className="work-card study-panel"><h2>Study files</h2>
      <div className="packet-files">{inputs.map(input=><label key={input.key}>
        <strong>{input.label}</strong><small>{input.filename}</small>
        <input type="file" accept=".zip" disabled={!!busy||driveBusy} onChange={e=>{
          const file=e.target.files?.[0];
          setFiles(f=>({...f,[input.key]:file}));setPackets(null);setPublicAccess(false);setLinks({});setProgress(null);setError('');setPhase('');
        }}/>
      </label>)}</div>
      {!packets&&<div className="actions"><button className="button secondary" disabled={!!busy||inputs.some(x=>!files[x.key])} onClick={()=>void verify()}>Verify files</button>
        {busy==='verify'&&<span role="status">{phase}</span>}</div>}
    </section>
    {packets&&<>
      <section className="work-card study-panel">
        <h2>Review study</h2><p>{packets.cases.length} CT volumes · {packets.cases.length*4} reports · {sizeLabel(volumeBytes)}</p>
        <label>Study ID<input type="text" required maxLength={40} disabled={!!busy||driveBusy} value={prefix} onChange={e=>{setPrefix(e.target.value);setProgress(null);setError('');setPhase('');}}/></label>
        {!validPrefix&&<p role="alert">Use 1–40 letters, digits, hyphens or underscores, starting with a letter or digit.</p>}
        <details><summary>Preview shared report assignments</summary><div className="table-scroll"><table>
          <thead><tr>{['Case','Report A','Report B','Report C','Report D'].map(x=><th key={x}>{x}</th>)}</tr></thead>
          <tbody>{packets.cases.map(c=><tr key={c.case_id}><td>{c.case_id}</td>{['A','B','C','D'].map(l=><td key={l}>{c.reports.find(r=>r.letter===l)?.model_name}</td>)}</tr>)}</tbody>
        </table></div></details>
      </section>
      {source==='drive'&&<>
        <section className="work-card study-panel"><h2>Public reader access</h2>
          <label className="reader-consent"><input type="checkbox" checked={publicAccess} disabled={!!busy||driveBusy}
            onChange={e=>setPublicAccess(e.currentTarget.checked)}/>These cases and reports are approved for public sharing</label>
          <p>Enabling access lets anyone with the doctor link enter a name, open the CT files and rate the anonymous reports.</p>
        </section>
        <DriveFolderUpload packets={packets} disabled={!!busy} allowPublic={publicAccess} links={links} onLinks={value=>{setLinks(value);setError('');}} onBusyChange={setDriveBusy}/>
        <DriveLinks allowPublic={publicAccess} caseIds={packets.cases.map(c=>c.case_id)} links={links} setLinks={value=>{setLinks(value);setError('');}} disabled={!!busy||driveBusy}/>
      </>}
      {!publicAccess&&<section className="work-card study-panel"><h2>Assign readers</h2>
        <p>All selected readers see the same cases and report letters. You can add readers after publishing.</p>
        {roster.error?<p role="alert" className="error">{roster.error} <button className="button secondary" onClick={roster.refresh}>Retry</button></p>
          :!roster.data?<p role="status">Loading readers…</p>:roster.data.doctors.length===0?<p>No doctor accounts yet.</p>
          :<div className="reader-checks">{roster.data.doctors.map(name=><label key={name}><input type="checkbox" disabled={!!busy} checked={doctors.includes(name)}
              onChange={e=>setDoctors(prev=>e.target.checked?[...prev,name]:prev.filter(user=>user!==name))}/>{name}</label>)}</div>}
      </section>}
      <div className="study-submit"><button disabled={!!busy||driveBusy||!validPrefix||(source==='r2'&&!storage.data?.ready)} className="button primary" onClick={()=>void publish()}>{source==='drive'?(busy==='upload'?'Publishing…':'Publish study'):progress?'Resume and publish':'Upload and publish'}</button>
        {busy==='upload'&&source==='r2'&&<button className="button secondary" onClick={()=>operation.current?.abort()}>Pause</button>}
        {progress&&<progress aria-label="CT upload progress" value={progress.bytes} max={volumeBytes}/>}
      </div>
      {progress&&<p role="status">{busy?progress.message:phase}</p>}
      {publicAccess&&busy==='upload'&&phase&&<p role="status">{phase}</p>}
    </>}
    {error&&<p className="error" role="alert">{error}{progress&&' You can resume with the same files.'}</p>}
  </main>;
}

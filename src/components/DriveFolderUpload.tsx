import {useEffect,useRef,useState} from 'react';
import {authorizeDrive,disconnectDrive,driveUploadConfigured,loadGoogle,selectDriveFolder,type UploadSession} from '../services/driveUpload';
import {uploadPrivateFolder} from '../services/privateDriveFolder';
import type {StudyPackets} from '../services/studyPackets';
import {message} from '../utils';

interface Props {
  packets:StudyPackets;
  disabled:boolean;
  allowPublic?:boolean;
  onLinks:(links:Record<string,string>)=>void;
  onBusyChange?:(value:boolean)=>void;
  links?:Record<string,string>;
}
export default function DriveFolderUpload({packets,disabled,onLinks,onBusyChange,allowPublic=false}:Props) {
  const [ready,setReady]=useState(false),[connected,setConnected]=useState(false);
  const [folder,setFolder]=useState<{id:string;name:string}|null>(null),[busy,setBusy]=useState(false);
  const [status,setStatus]=useState(''),[error,setError]=useState('');
  const sessions=useRef(new Map<string,UploadSession>());
  const op=useRef<AbortController|null>(null);
  useEffect(()=>{
    let mounted=true;
    if(driveUploadConfigured)void loadGoogle().then(()=>{if(mounted)setReady(true);})
      .catch(e=>{if(mounted)setError(message(e));});
    return ()=>{mounted=false;op.current?.abort();disconnectDrive();};
  },[]);
  useEffect(()=>{sessions.current.clear();setStatus('');setError('');},[packets,allowPublic]);

  async function perform(action:(signal:AbortSignal)=>Promise<void>){
    if(op.current||disabled)return;
    const controller=new AbortController();op.current=controller;
    setBusy(true);onBusyChange?.(true);setError('');setStatus('');
    try { await action(controller.signal); }
    catch(e) {
      if(controller.signal.aborted)setStatus('Upload paused. Use the same folder to continue.');
      else setError(message(e));
    } finally {op.current=null;setBusy(false);onBusyChange?.(false);}
  }
  if(!driveUploadConfigured)return null;
  return <section className="work-card study-panel"><h2>Upload CTs to Google Drive</h2>
    <p>{allowPublic?'Choose a dedicated Drive folder set to Anyone with the link (Viewer). Upload only the CTs approved for public sharing.':'Select a dedicated, restricted folder shared with your readers.'} The verified links will appear below.</p>
    <div className="actions">
      <button className="button secondary" disabled={!ready||disabled||busy}
        onClick={()=>void perform(async()=>{await authorizeDrive();setConnected(true);setFolder(null);sessions.current.clear();})}>
        {connected?'Reconnect Google Drive':'Connect Google Drive'}</button>
      {connected&&<button className="button secondary" disabled={disabled||busy}
        onClick={()=>void perform(async()=>{const selected=await selectDriveFolder();if(selected.id!==folder?.id)sessions.current.clear();setFolder(selected);})}>
        Choose folder</button>}
    </div>
    {folder&&<><p>Destination: {folder.name}</p><div className="actions">
      <button className="button primary" disabled={disabled||busy} onClick={()=>void perform(async signal=>{
        setStatus('Checking folder permissions and saved CTs…');
        const result=await uploadPrivateFolder(packets,folder.id,sessions.current,signal,setStatus,allowPublic);
        signal.throwIfAborted();onLinks(result);setStatus('Verified '+packets.cases.length+' CT links. The study is ready to publish.');
      })}>Upload and verify CTs</button>
      {busy&&status&&<button className="button secondary" onClick={()=>op.current?.abort()}>Pause</button>}
    </div></>}
    {status&&<p role="status">{status}</p>}
    {error&&<p role="alert" className="error">{error} You can also add the Drive links manually.</p>}
  </section>;
}

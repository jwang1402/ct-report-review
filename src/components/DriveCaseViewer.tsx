import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {StudyDetail} from '../services/blindStudy';
import {driveFileId,verifyCaseVolume} from '../services/restrictedDrive';
import {downloadPublicDriveCase} from '../services/publicDriveMedia';
import {ViewerBoundary} from './ViewerBoundary';
import {message,sizeLabel} from '../utils';
import {ScanLine} from 'lucide-react';

const Viewer=lazy(()=>import('./Viewer'));

export default function DriveCaseViewer({study,publicReader=false}:{study:StudyDetail;publicReader?:boolean}) {
  const [file,setFile]=useState<File|null>(null);
  const [error,setError]=useState('');
  const [checking,setChecking]=useState(false);
  const [retry,setRetry]=useState(0);
  const current=useRef<AbortController|null>(null);
  useEffect(()=>()=>current.current?.abort(),[]);
  const {drive_url:url,size,sha256}=study.imaging;
  useEffect(()=>{
    if(!publicReader||!url)return;
    const controller=new AbortController();
    current.current=controller;
    setChecking(true);setError('');setFile(null);
    downloadPublicDriveCase(url,{size,sha256},controller.signal)
      .then(value=>{if(!controller.signal.aborted)setFile(value);})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e));})
      .finally(()=>{if(!controller.signal.aborted)setChecking(false);});
    return ()=>controller.abort();
  },[publicReader,retry,url,size,sha256]);
  async function openFile(selected:File) {
    current.current?.abort();
    const controller=new AbortController();
    current.current=controller;
    setFile(null);setError('');setChecking(true);
    try {
      await verifyCaseVolume(selected,study.imaging,controller.signal);
      if(!controller.signal.aborted)setFile(selected);
    } catch(e) {
      if(!controller.signal.aborted)setError(message(e));
    } finally {if(!controller.signal.aborted)setChecking(false);}
  }
  if(file)return <ViewerBoundary><Suspense fallback={<div className="empty"><span className="spinner"/>Loading imaging engine…</div>}>
    <Viewer privateCase verifiedFile={file} item={{case_id:study.case_id,imaging:study.imaging,asset:{size:study.imaging.size,url:''}}}/>
  </Suspense></ViewerBoundary>;
  return <div className="ct-file-prompt">
    <section className="empty"><span className="empty-icon"><ScanLine size={32}/></span><h2>CT image</h2>
      <small>{study.case_id} · NIfTI · {sizeLabel(size)}</small>
      {!publicReader&&<p>Download this case from Drive with your authorized Google account. Open the .nii.gz file here to view it alongside the reports.</p>}
      {publicReader&&checking&&<p role="status">Loading and checking this CT…</p>}
      {(!publicReader||error)&&<>
      <div className="actions">
        {publicReader&&error&&<button className="button secondary" onClick={()=>setRetry(r=>r+1)}>Retry loading CT</button>}
        {url&&driveFileId(url)&&<a className="button secondary" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open CT in Drive ↗</a>}
        <label className="button secondary">Open downloaded CT<input className="file-hidden" type="file" accept=".nii.gz,.gz"
          onChange={e=>{const chosen=e.currentTarget.files?.[0];e.currentTarget.value='';if(chosen)void openFile(chosen);}}/></label>
      </div>
      </>}
      {!publicReader&&checking&&<p role="status">Checking the case file…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>
  </div>;
}

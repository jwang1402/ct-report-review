import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {StudyDetail} from '../services/blindStudy';
import {driveFileId,verifyCaseVolume} from '../services/restrictedDrive';
import {ViewerBoundary} from './ViewerBoundary';
import {message} from '../utils';

const Viewer=lazy(()=>import('./Viewer'));

export default function DriveCaseViewer({study}:{study:StudyDetail}) {
  const [file,setFile]=useState<File|null>(null);
  const [error,setError]=useState('');
  const [checking,setChecking]=useState(false);
  const current=useRef<AbortController|null>(null);
  useEffect(()=>()=>current.current?.abort(),[]);
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
  const url=study.imaging.drive_url;
  return <div className="drive-case-viewer">
    <section className="work-card study-panel"><h2>CT image</h2>
      <p>Download this case from Drive with your authorized Google account. Open the .nii.gz file here to view it alongside the reports.</p>
      <div className="actions">
        {url&&driveFileId(url)&&<a className="button secondary" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open CT in Drive ↗</a>}
        <label className="button secondary">Open downloaded CT<input className="file-hidden" type="file" accept=".nii.gz,.gz"
          onChange={e=>{const chosen=e.currentTarget.files?.[0];e.currentTarget.value='';if(chosen)void openFile(chosen);}}/></label>
      </div>
      {checking&&<p role="status">Checking the case file…</p>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>
    {file&&<ViewerBoundary><Suspense fallback={<p role="status">Loading imaging engine…</p>}>
      <Viewer privateCase verifiedFile={file} item={{case_id:study.case_id,imaging:study.imaging,asset:{size:study.imaging.size,url:''}}}/>
    </Suspense></ViewerBoundary>}
  </div>;
}

import {caseDisplayLabel} from '../services/studyDisplay';
import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import type {StudyDetail} from '../services/blindStudy';
import {driveFileId,verifyCaseVolume} from '../services/restrictedDrive';
import {downloadPublicDriveCase,type DriveImageProgress} from '../services/publicDriveMedia';
import {CTLoadProgress} from './CTLoadProgress';
import {ViewerBoundary} from './ViewerBoundary';
import {message,sizeLabel} from '../utils';
import {ScanLine} from 'lucide-react';

const loadViewer=()=>import('./Viewer');
const Viewer=lazy(loadViewer);

export default function DriveCaseViewer({study,publicReader=false,studyB=false}:{study:Pick<StudyDetail,'case_id'|'imaging'>;publicReader?:boolean;studyB?:boolean}) {
  const [file,setFile]=useState<File|null>(null);
  const [error,setError]=useState('');
  const [progress,setProgress]=useState<DriveImageProgress|null>(null);
  const [retry,setRetry]=useState(0);
  const current=useRef<AbortController|null>(null);
  useEffect(()=>()=>current.current?.abort(),[]);
  const {drive_url:url,size,sha256}=study.imaging;
  const caseId=study.case_id;
  useEffect(()=>{
    if(!publicReader||!url)return;
    const controller=new AbortController();
    current.current=controller;
    setError('');setFile(null);
    downloadPublicDriveCase(url,{size,sha256},controller.signal,value=>{if(!controller.signal.aborted)setProgress(value);},caseId,studyB)
      .then(value=>{if(!controller.signal.aborted)setFile(value);})
      .catch(e=>{if(!controller.signal.aborted)setError(message(e));})
      .finally(()=>{if(!controller.signal.aborted)setProgress(null);});
    // Fetch the viewer code while the selected CT is in transit.
    void loadViewer().catch(()=>{});
    return ()=>controller.abort();
  },[publicReader,retry,url,size,sha256,caseId,studyB]);
  async function openFile(selected:File) {
    current.current?.abort();
    const controller=new AbortController();
    current.current=controller;
    setFile(null);setError('');setProgress({stage:'verify',percent:0});
    try {
      await verifyCaseVolume(selected,study.imaging,controller.signal,percent=>{
        if(!controller.signal.aborted)setProgress({stage:'verify',percent});
      });
      if(!controller.signal.aborted)setFile(selected);
    } catch(e) {
      if(!controller.signal.aborted)setError(message(e));
    } finally {if(!controller.signal.aborted)setProgress(null);}
  }
  if(file)return <ViewerBoundary><Suspense fallback={<div className="empty"><CTLoadProgress label="Preparing CT viewer"/></div>}>
    <Viewer privateCase verifiedFile={file} item={{case_id:study.case_id,imaging:study.imaging,asset:{size:study.imaging.size,url:''}}}/>
  </Suspense></ViewerBoundary>;
  return <div className="ct-file-prompt">
    <section className="empty"><span className="empty-icon"><ScanLine size={32}/></span><h2>CT image</h2>
      <small>{caseDisplayLabel(study.case_id)} · NIfTI · {sizeLabel(size)}</small>
      {!publicReader&&<p>Download this case from Drive with your authorized Google account. Open the .nii.gz file here to view it alongside the reports.</p>}
      {progress?.stage==='download'&&<CTLoadProgress label={progress.reconnecting?'Reconnecting to CT…':'Downloading CT'}
        ratio={progress.total>0?progress.received/progress.total:undefined}
        detail={sizeLabel(progress.received)+' / '+sizeLabel(size)}/>}
      {progress?.stage==='verify'&&<CTLoadProgress label="Verifying CT file" ratio={progress.percent/100}/>}
      {(!publicReader||error)&&<>
      <div className="actions">
        {publicReader&&error&&<button className="button secondary" onClick={()=>setRetry(r=>r+1)}>Retry loading CT</button>}
        {url&&driveFileId(url)&&<a className="button secondary" href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open CT in Drive ↗</a>}
        <label className="button secondary">Open downloaded CT<input className="file-hidden" type="file" accept=".nii.gz,.gz"
          onChange={e=>{const chosen=e.currentTarget.files?.[0];e.currentTarget.value='';if(chosen)void openFile(chosen);}}/></label>
      </div>
      </>}
      {error&&<p className="error" role="alert">{error}</p>}
    </section>
  </div>;
}

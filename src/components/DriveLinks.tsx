import {useState} from 'react';
import {parseDriveLinksTable} from '../services/restrictedDrive';
import {message} from '../utils';

export default function DriveLinks({caseIds,links,setLinks,disabled,allowPublic=false}:{
  caseIds:string[];links:Record<string,string>;setLinks:(links:Record<string,string>)=>void;disabled:boolean;allowPublic?:boolean
}) {
  const [table,setTable]=useState('');
  const [error,setError]=useState('');
  return <section className="work-card study-panel">
    <h2>Case file links</h2>
    <p>To add links manually, paste each .nii.gz file’s link below. {allowPublic?'Set the approved files to “Anyone with the link” with download access.':'Give the assigned readers download access to the restricted folder.'}</p>
    <div className="drive-file-links">{caseIds.map(id=><label key={id}>
      {id}.nii.gz
      <input disabled={disabled} type="url" placeholder="Google Drive file link" value={links[id]??''}
        onChange={e=>setLinks({...links,[id]:e.currentTarget.value})}/>
    </label>)}</div>
    <details><summary>Paste several links at once</summary>
      <label>One case and file link per row
        <textarea disabled={disabled} rows={4} value={table} placeholder={'Case01\thttps://drive.google.com/file/d/…/view'} onChange={e=>setTable(e.target.value)}/>
      </label>
      <button className="button secondary" disabled={disabled||!table.trim()} onClick={()=>{
        try { setLinks({...links,...parseDriveLinksTable(table,caseIds)});setTable('');setError(''); }
        catch(e){setError(message(e));}
      }}>Apply links</button>
      {error&&<p className="error" role="alert">{error}</p>}
    </details>
  </section>;
}

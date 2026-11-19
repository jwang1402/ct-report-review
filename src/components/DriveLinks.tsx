import {useState} from 'react';
import {parseDriveLinksTable} from '../services/restrictedDrive';
import {message} from '../utils';

export default function DriveLinks({caseIds,links,setLinks,disabled}:{
  caseIds:string[];links:Record<string,string>;setLinks:(links:Record<string,string>)=>void;disabled:boolean
}) {
  const [table,setTable]=useState('');
  const [error,setError]=useState('');
  return <section className="work-card study-panel">
    <h2>Case file links</h2>
    <p>To add links manually, extract Reader_Images.zip, upload the .nii.gz files to Drive, and paste each file’s link below. Give your readers download access to the restricted folder.</p>
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

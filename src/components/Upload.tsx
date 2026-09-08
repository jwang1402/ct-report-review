import {useState,type ChangeEvent} from 'react';
import {UploadCloud,Plus,Trash2,ArrowUpRight,Download,Check,FileArchive} from 'lucide-react';
import {zip,unzip,gunzip} from 'fflate';
import {repositoryUrl} from '../config';
import type {Case,ModelReport} from '../types';
import {guardSize,ASSET_LIMIT} from '../services/github/releaseAssets';
import {saveFile,sizeLabel,message} from '../utils';
export const unzipFiles=(bytes:Uint8Array)=>new Promise<Record<string,Uint8Array>>((resolve,reject)=>unzip(bytes,{filter:f=>{if(f.originalSize>=ASSET_LIMIT)throw new Error('Expanded DICOM file exceeds 2 GiB.');return true;}},(e,d)=>e?reject(e):resolve(d)));
export const gunzipBytes=(bytes:Uint8Array)=>new Promise<Uint8Array<ArrayBuffer>>((resolve,reject)=>gunzip(bytes,(e,d)=>e?reject(e):resolve(new Uint8Array(d))));
const newReport=():ModelReport=>({id:`report-${crypto.randomUUID().slice(0,8)}`,model_name:'',report_name:'',report_text:''});
export function Upload(){
 const [id,setId]=useState(''),[name,setName]=useState(''),[description,setDescription]=useState('');
 const [files,setFiles]=useState<File[]>([]),[reports,setReports]=useState<ModelReport[]>([newReport()]);
 const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[stage,setStage]=useState(''),[error,setError]=useState('');
 const [prepared,setPrepared]=useState<{meta:Case;blob:Blob;tag:string}|null>(null);
 const update=(i:number,patch:Partial<ModelReport>)=>{setPrepared(null);setReports(rs=>rs.map((r,j)=>j===i?{...r,...patch}:r));};
 const select=(e:ChangeEvent<HTMLInputElement>)=>{setFiles(Array.from(e.target.files||[]));setPrepared(null);setError('');};
 async function prepare(){setError('');setBusy(true);setStage('Validating imaging data…');try{
  if(!/^[A-Za-z0-9_-]+$/.test(id)||!name.trim())throw new Error('Enter a case ID (letters, numbers, - or _) and a case name.');
  if(!files.length)throw new Error('Select an imaging file or a DICOM folder.');
  if(!consent)throw new Error('Confirm that this case is appropriate for public research sharing.');
  if(reports.some(r=>!r.model_name.trim()||!r.report_name.trim()||!r.report_text.trim()||!/^[\w-]+$/.test(r.id))||new Set(reports.map(r=>r.id)).size!==reports.length)throw new Error('Complete every report and use unique report IDs.');
  files.forEach(f=>guardSize(f.size));
  let blob:Blob;let type:'NIFTI'|'DICOM';let filename:string;
  const first=files[0];
  if(files.length===1&&/\.nii(\.gz)?$/i.test(first.name)){
   type='NIFTI';filename=id+(/\.gz$/i.test(first.name)?'.nii.gz':'.nii');
   const header=/\.gz$/i.test(first.name)?await gunzipBytes(new Uint8Array(await first.arrayBuffer())):new Uint8Array(await first.slice(0,560).arrayBuffer());
   const view=new DataView(header.buffer,header.byteOffset,header.byteLength);if(header.length<348||![348,540].includes(view.getInt32(0,true))&&![348,540].includes(view.getInt32(0,false)))throw new Error('Invalid NIfTI header.');
   blob=first;
  }else if(files.length===1&&/\.zip$/i.test(first.name)){
   type='DICOM';filename=id+'_dicom.zip';setStage('Checking DICOM ZIP…');const entries=await unzipFiles(new Uint8Array(await first.arrayBuffer()));if(!Object.keys(entries).some(n=>!n.endsWith('/')))throw new Error('DICOM ZIP is empty.');blob=first;
  }else{
   type='DICOM';filename=id+'_dicom.zip';setStage('Preparing original DICOM files…');const entries:Record<string,Uint8Array>={};let total=0;
   for(const f of files){total+=f.size;if(total>=ASSET_LIMIT)throw new Error('DICOM folder must be smaller than 2 GiB for this prototype.');const path=f.webkitRelativePath||f.name;if(entries[path])throw new Error('Duplicate filename: '+path);entries[path]=new Uint8Array(await f.arrayBuffer());}
   setStage('Packaging DICOM ZIP…');const bytes=await new Promise<Uint8Array<ArrayBuffer>>((resolve,reject)=>zip(entries,{level:0},(e,d)=>e?reject(e):resolve(new Uint8Array(d))));blob=new Blob([bytes],{type:'application/zip'});
  }
  guardSize(blob.size);const meta:Case={schema_version:'1.0',case_id:id,case_name:name.trim(),description,created_at:new Date().toISOString(),imaging:{type,filename,asset_name:filename,size:blob.size},reports};
  if(JSON.stringify(meta).length>45_000)throw new Error('Case metadata exceeds the Release description limit. Shorten report text.');
  setPrepared({meta,blob,tag:`case-${id}-${Date.now()}`});setStage('Ready for GitHub Release');
 }catch(e){setError(message(e));setStage('Preparation failed');}finally{setBusy(false);}}
 const releaseUrl=prepared?`${repositoryUrl}/releases/new?${new URLSearchParams({tag:prepared.tag,title:`${prepared.meta.case_id} - ${prepared.meta.case_name}`,body:'CT Report Review case. Attach case.json and the original CT asset before publishing. GitHub Actions will synchronize this case to the public Pages website.'})}`:'';
 return <main className="page upload-page"><div className="page-heading"><div><span className="eyebrow">RESEARCH WORKSPACE / PUBLISH</span><h1>Upload a case</h1><p>One CT study. Multiple model reports. A shared clinical review.</p></div><span className="badge">GitHub Releases</span></div>
 <div className="upload-layout"><div><fieldset disabled={busy} className="form-card"><div className="section-heading"><span className="step">01</span><h2>Case details</h2></div><div className="form-row"><label>Case ID<input value={id} placeholder="CT001" onChange={e=>{setId(e.target.value);setPrepared(null);}}/></label><label>Case name<input value={name} placeholder="Chest CT · follow-up" onChange={e=>{setName(e.target.value);setPrepared(null);}}/></label></div><label>Description<textarea rows={2} value={description} onChange={e=>{setDescription(e.target.value);setPrepared(null);}} placeholder="Optional clinical context for the reviewer"/></label>
 <div className="section-heading"><span className="step">02</span><h2>CT imaging</h2></div><div className="drop-zone"><UploadCloud size={28}/><h3>Select original imaging</h3><p>NIfTI, DICOM files, a DICOM folder, or ZIP · under 2 GiB</p><div className="actions"><label className="button">Choose files<input className="file-hidden" type="file" multiple onChange={select} aria-label="Choose CT files"/></label><label className="button secondary">Choose folder<input className="file-hidden" type="file" multiple {...{webkitdirectory:''} as object} onChange={select} aria-label="Choose DICOM folder"/></label></div></div>
 {!!files.length&&<div className="file-summary"><FileArchive size={20}/><div><strong>{files[0].name}{files.length>1?` + ${files.length-1} files`:''}</strong><small>{files.length} file(s) · {sizeLabel(files.reduce((a,f)=>a+f.size,0))} · {files.length===1&&/\.nii(\.gz)?$/i.test(files[0].name)?'NIfTI':'DICOM / ZIP'}</small></div></div>}
 <div className="section-heading"><span className="step">03</span><h2>Model reports</h2><span className="muted">{reports.length} added</span></div>
 {reports.map((r,i)=><div className="report-editor" key={i}><div className="section-heading"><strong>Report {String(i+1).padStart(2,'0')}</strong><button className="icon-button" aria-label={`Remove report ${i+1}`} disabled={reports.length===1} onClick={()=>{setReports(reports.filter((_,j)=>j!==i));setPrepared(null);}}><Trash2 size={16}/></button></div><div className="form-row"><label>Model name<input value={r.model_name} onChange={e=>update(i,{model_name:e.target.value})} placeholder="Enter any model name"/></label><label>Report ID<input value={r.id} onChange={e=>update(i,{id:e.target.value})}/></label></div><label>Report name<input value={r.report_name} onChange={e=>update(i,{report_name:e.target.value})} placeholder="Chest CT report"/></label><label>Report text<textarea rows={6} value={r.report_text} onChange={e=>update(i,{report_text:e.target.value})} placeholder="Paste the complete report…"/></label><label className="text-button">Import .txt / .md<input type="file" accept=".txt,.md" className="file-hidden" onChange={async e=>{const f=e.target.files?.[0];if(f)update(i,{report_text:await f.text()});}}/></label></div>)}
 <button className="button secondary full" onClick={()=>{setReports([...reports,newReport()]);setPrepared(null);}}><Plus size={16}/>Add Model Report</button></fieldset></div>
 <aside><div className="form-card sticky"><h2>Publish to your repository</h2><p className="muted">Prepare the files here, then upload both assets on GitHub.</p><ol className="steps-list"><li>Download case.json and the CT asset.</li><li>Open the prefilled GitHub Release.</li><li>Attach both files and publish.</li><li>Wait for Pages sync, then refresh Clinical Review.</li></ol><label className="checkbox-label"><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);setPrepared(null);}}/>This case contains only public, synthetic, or appropriately de-identified data.</label><button className="button primary full" disabled={busy} onClick={prepare}>{busy?'Preparing…':'Prepare Case'}<ArrowUpRight size={16}/></button>{stage&&<p className="status-line" role="status">{busy?<span className="spinner"/>:<Check size={15}/>} {stage}</p>}{error&&<div role="alert" className="error">{error}</div>}
 {prepared&&<div className="prepared"><button className="button secondary full" onClick={()=>saveFile(JSON.stringify(prepared.meta,null,2),'case.json','application/json')}><Download size={16}/>Download case.json</button><button className="button secondary full" onClick={()=>saveFile(prepared.blob,prepared.meta.imaging.filename)}><Download size={16}/>Download CT asset</button><a className="button primary full" href={releaseUrl} target="_blank" rel="noreferrer">Open GitHub Release<ArrowUpRight size={16}/></a><small>Attach <b>case.json</b> and <b>{prepared.meta.imaging.filename}</b>. After publishing, wait for the Pages synchronization workflow.</small></div>}
 <div className="note">Original CT data stays in Releases. A temporary copy is synchronized to Pages for browser viewing. Test mirror limit: 800 MB total.</div></div></aside></div></main>;
}

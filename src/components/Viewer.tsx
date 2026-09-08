import {useEffect,useRef,useState} from 'react';
import {ScanLine,RotateCcw,Move,ZoomIn,Contrast,Download,Maximize2} from 'lucide-react';
import * as cs from '@cornerstonejs/core';
import * as tools from '@cornerstonejs/tools';
import dicom from '@cornerstonejs/dicom-image-loader';
import {cornerstoneNiftiImageLoader,createNiftiImageIdsAndCacheMetadata} from '@cornerstonejs/nifti-volume-loader';
import dicomParser from 'dicom-parser';
import {unzipFiles,gunzipBytes} from './Upload';
import {downloadAsset} from '../services/github/releaseAssets';
import type {CaseRelease} from '../types';
import {sizeLabel,message} from '../utils';
let initPromise:Promise<void>|undefined;
function init(){return initPromise??=(async()=>{await cs.init();await tools.init();dicom.init({maxWebWorkers:Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1))});cs.imageLoader.registerImageLoader('nifti',cornerstoneNiftiImageLoader);for(const tool of [tools.WindowLevelTool,tools.PanTool,tools.ZoomTool,tools.StackScrollTool])tools.addTool(tool);})();}
interface Series {uid:string;label:string;files:File[];frames:number}
const presets:Record<string,[number,number]>={'Soft Tissue':[400,40],Lung:[1500,-600],Bone:[2000,500],Brain:[80,40]};
const axes=[cs.Enums.OrientationAxis.AXIAL,cs.Enums.OrientationAxis.SAGITTAL,cs.Enums.OrientationAxis.CORONAL];
const axisNames=['Axial','Sagittal','Coronal'];
export default function Viewer({item}:{item:CaseRelease}){
 const elements=useRef<(HTMLDivElement|null)[]>([]);const engineRef=useRef<cs.RenderingEngine|null>(null);const groupRef=useRef<ReturnType<typeof tools.ToolGroupManager.createToolGroup>>(undefined);
 const [status,setStatus]=useState('Downloading imaging dataset'),[error,setError]=useState(''),[progress,setProgress]=useState(0),[ready,setReady]=useState(false);
 const [series,setSeries]=useState<Series[]>([]),[selected,setSelected]=useState(''),[blob,setBlob]=useState<Blob|null>(null);
 const [activeTool,setActiveTool]=useState('WindowLevel'),[preset,setPreset]=useState('Soft Tissue'),[slices,setSlices]=useState<{index:number;total:number}[]>([{index:0,total:1},{index:0,total:1},{index:0,total:1}]);
 const [dimensions,setDimensions]=useState('—'),[spacing,setSpacing]=useState('—');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setReady(false);setError('');setBlob(null);setSeries([]);setSelected('');
  (async()=>{try{setStatus('Downloading imaging dataset');const data=await downloadAsset(item.asset,(n,t)=>{setProgress(n/t);setStatus(`Downloading imaging dataset · ${sizeLabel(n)} / ${sizeLabel(t)}`);},controller.signal);if(controller.signal.aborted)return;
   if(item.imaging.type==='NIFTI'){setBlob(data);return;}
   setStatus('Preparing DICOM series');const entries=await unzipFiles(new Uint8Array(await data.arrayBuffer()));const groups=new Map<string,Series>();let ignored=0,total=0;
   for(const [name,bytes] of Object.entries(entries)){if(name.endsWith('/')||name.includes('__MACOSX/')||name.split('/').pop()?.startsWith('.'))continue;total+=bytes.length;if(total>=2*1024**3)throw new Error('Expanded DICOM dataset exceeds the prototype 2 GiB memory limit.');try{const ds=dicomParser.parseDicom(bytes,{untilTag:'x7fe00010'});const uid=ds.string('x0020000e');if(!uid||!ds.uint16('x00280010')||!ds.uint16('x00280011')){ignored++;continue;}const count=Number(ds.string('x00280008')||1);const group=groups.get(uid)||{uid,label:ds.string('x0008103e')||'DICOM series',files:[],frames:0};group.files.push(new File([new Uint8Array(bytes)],name.split('/').pop()||'slice.dcm'));group.frames+=count;groups.set(uid,group);}catch{ignored++;}}
   const all=[...groups.values()].sort((a,b)=>b.frames-a.frames);if(!all.length)throw new Error('No readable DICOM image series found in this ZIP.');if(controller.signal.aborted)return;setSeries(all);setSelected(all[0].uid);setStatus(`${all.length} series found${ignored?` · ${ignored} non-image files skipped`:''}`);
  }catch(e){if(!controller.signal.aborted)setError(message(e));}})();return()=>controller.abort();
 },[item.release_id,retry]);
 useEffect(()=>{const picked=series.find(s=>s.uid===selected);if(!blob&&!picked)return;
  let closed=false,engine:cs.RenderingEngine|undefined,url:string|undefined,volumeId:string|undefined;const imageIds:string[]=[];const id=crypto.randomUUID();const viewIds=axes.map((_,i)=>`${id}-${i}`);const observers:ResizeObserver[]=[];const listeners:Array<()=>void>=[];
  setReady(false);setError('');
  const clean=()=>{observers.forEach(o=>o.disconnect());listeners.forEach(fn=>fn());tools.ToolGroupManager.destroyToolGroup(id);engine?.destroy();for(const imageId of imageIds){if(cs.cache.getImageLoadObject(imageId))cs.cache.removeImageLoadObject(imageId);}if(volumeId&&cs.cache.getVolume(volumeId))cs.cache.removeVolumeLoadObject(volumeId);if(url)URL.revokeObjectURL(url);dicom.wadouri.fileManager.purge();dicom.wadouri.dataSetCacheManager.purge();engineRef.current=null;groupRef.current=undefined;};
  (async()=>{try{
   setStatus('Initializing Cornerstone3D…');await init();if(closed)return;
   if(blob){setStatus('Preparing NIfTI volume…');let source=blob;const magic=new Uint8Array(await blob.slice(0,2).arrayBuffer());if(magic[0]===31&&magic[1]===139)source=new Blob([await gunzipBytes(new Uint8Array(await blob.arrayBuffer()))]);if(source.size>=2*1024**3)throw new Error('Expanded NIfTI exceeds 2 GiB.');url=URL.createObjectURL(source);imageIds.push(...await createNiftiImageIdsAndCacheMetadata({url}));}
   else if(picked){for(let i=0;i<picked.files.length;i++){if(closed)return;const f=picked.files[i];const ds=dicomParser.parseDicom(new Uint8Array(await f.arrayBuffer()),{untilTag:'x7fe00010'});const n=Number(ds.string('x00280008')||1);const imageId=dicom.wadouri.fileManager.add(f);for(let frame=1;frame<=n;frame++){const fid=n>1?`${imageId}?frame=${frame}`:imageId;await cs.imageLoader.loadAndCacheImage(fid);imageIds.push(fid);}setStatus(`Preparing DICOM series · ${i+1} / ${picked.files.length} files`);}}
   if(closed)return;
   if(!imageIds.length)throw new Error('Imaging dataset contains no slices.');
   volumeId=`cornerstoneStreamingImageVolume:${id}`;const volume=await cs.volumeLoader.createAndCacheVolume(volumeId,{imageIds});volume.load();
   if(closed)return;
   engine=new cs.RenderingEngine(id);engineRef.current=engine;
   engine.setViewports(axes.map((orientation,i)=>({viewportId:viewIds[i],type:cs.Enums.ViewportType.ORTHOGRAPHIC,element:elements.current[i]!,defaultOptions:{orientation,background:[0,0,0] as [number,number,number]}})));
   const group=tools.ToolGroupManager.createToolGroup(id)!;groupRef.current=group;
   for(const t of [tools.WindowLevelTool,tools.PanTool,tools.ZoomTool,tools.StackScrollTool])group.addTool(t.toolName);
   group.setToolActive(tools.WindowLevelTool.toolName,{bindings:[{mouseButton:tools.Enums.MouseBindings.Primary}]});group.setToolActive(tools.PanTool.toolName,{bindings:[{mouseButton:tools.Enums.MouseBindings.Auxiliary}]});group.setToolActive(tools.ZoomTool.toolName,{bindings:[{mouseButton:tools.Enums.MouseBindings.Secondary}]});group.setToolActive(tools.StackScrollTool.toolName,{bindings:[{mouseButton:tools.Enums.MouseBindings.Wheel}]});viewIds.forEach(v=>group.addViewport(v,id));
   await cs.setVolumesForViewports(engine,[{volumeId}],viewIds);if(closed)return;
   setDimensions(volume.dimensions.join(' × '));setSpacing(volume.spacing.map(s=>s.toFixed(2)).join(' × '));
   viewIds.forEach((vid,i)=>{const element=elements.current[i]!;const viewport=engine!.getViewport(vid) as cs.VolumeViewport;viewport.setProperties({voiRange:{lower:-160,upper:240}});const update=()=>{if(closed)return;setSlices(s=>s.map((old,j)=>j===i?{index:viewport.getSliceIndex(),total:viewport.getNumberOfSlices()}:old));};element.addEventListener(cs.Enums.Events.IMAGE_RENDERED,update);listeners.push(()=>element.removeEventListener(cs.Enums.Events.IMAGE_RENDERED,update));const observer=new ResizeObserver(()=>{if(!closed){engine?.resize(true,false);engine?.render();}});observer.observe(element);observers.push(observer);});
   engine.render();setReady(true);setStatus('Volume ready');setActiveTool('WindowLevel');setPreset('Soft Tissue');
  }catch(e){if(!closed)setError(`Unable to initialize CT viewer. ${message(e)}`);}finally{if(closed)clean();}})();
  return()=>{closed=true;clean();};
 },[blob,selected,series]);
 function chooseTool(name:string){const group=groupRef.current;if(!group)return;['WindowLevel','Pan','Zoom'].forEach(t=>group.setToolPassive(t));group.setToolActive(name,{bindings:[{mouseButton:tools.Enums.MouseBindings.Primary}]});setActiveTool(name);}
 function applyPreset(name:string){setPreset(name);const [w,l]=presets[name];engineRef.current?.getViewports().forEach(v=>{(v as cs.VolumeViewport).setProperties({voiRange:{lower:l-w/2,upper:l+w/2}});v.render();});}
 function reset(){engineRef.current?.getViewports().forEach(v=>v.resetCamera());applyPreset('Soft Tissue');engineRef.current?.render();}
 return <section className="viewer"><div className="viewer-toolbar"><div className="tool-set">{[[Contrast,'WindowLevel','Window / level'],[Move,'Pan','Pan'],[ZoomIn,'Zoom','Zoom']].map(([Icon,name,label])=>{const I=Icon as typeof Contrast;return <button key={String(name)} title={String(label)} aria-label={String(label)} disabled={!ready} className={`tool-button ${activeTool===name?'selected':''}`} onClick={()=>chooseTool(String(name))}><I size={17}/></button>;})}<span className="tool-separator"/><button className="tool-button" disabled={!ready} title="Reset view" aria-label="Reset view" onClick={reset}><RotateCcw size={17}/></button></div><select aria-label="Window preset" value={preset} disabled={!ready} onChange={e=>applyPreset(e.target.value)}>{Object.keys(presets).map(p=><option key={p}>{p}</option>)}</select><a className="tool-button" title="Download Original CT" aria-label="Download Original CT" href={item.asset.browser_download_url}><Download size={17}/></a></div>
 {series.length>1&&<div className="series-select"><label>Series <select value={selected} onChange={e=>setSelected(e.target.value)}>{series.map(s=><option key={s.uid} value={s.uid}>{s.label} · {s.frames} slices</option>)}</select></label></div>}
 <div className="viewport-grid">{axisNames.map((name,i)=><div className="viewport-cell" key={name}><div className="viewport-label"><span className={`plane-dot plane-${i}`}/>{name}<span className="muted">{ready?`${slices[i].index+1} / ${slices[i].total}`:'—'}</span><Maximize2 size={12}/></div><div className="ct-canvas" ref={el=>{elements.current[i]=el;}} onContextMenu={e=>e.preventDefault()}/>{ready&&<><span className="orientation top">{['A','S','S'][i]}</span><span className="orientation left">{['R','A','R'][i]}</span><span className="orientation right">{['L','P','L'][i]}</span><span className="orientation bottom">{['P','I','I'][i]}</span></>}<input aria-label={`${name} slice`} className="slice-slider" type="range" min={0} max={Math.max(0,slices[i].total-1)} value={slices[i].index} disabled={!ready} onChange={e=>{void cs.utilities.jumpToSlice(elements.current[i]!,{imageIndex:Number(e.target.value)});}}/></div>)}
 <div className="study-metadata"><ScanLine size={24}/><span className="eyebrow">STUDY INFORMATION</span><h3>{item.case_id}</h3><dl><dt>Format</dt><dd>{item.imaging.type}</dd><dt>Dimensions</dt><dd>{dimensions}</dd><dt>Spacing (mm)</dt><dd>{spacing}</dd><dt>Original asset</dt><dd>{sizeLabel(item.asset.size)}</dd><dt>Views</dt><dd>Axial · Sagittal · Coronal</dd></dl><p>Scroll to navigate slices. Drag with the selected tool to adjust the view.</p></div>
 {!ready&&<div className="viewer-overlay"><div>{error?<><ScanLine size={30}/><h3>Imaging could not be loaded</h3><p role="alert">{error}</p><button className="button secondary" onClick={()=>setRetry(v=>v+1)}>Retry loading</button></>:<><span className="spinner large"/><h3>{status}</h3><progress max={1} value={progress}/><p>Loading original volumetric data</p></>}</div></div>}
 </div><div className="viewer-footer"><span className={ready?'live-dot':''}/>{ready?'Cornerstone3D · MPR':status}<span className="push-right">{ready?'Original data':'Preparing'}</span></div></section>;
}

import {api} from './session';
import type {StudyPackets} from './studyPackets';

interface BatchImage {case_id:string; ready:boolean; parts:number[]}
interface Batch {batch_id:string; state:'draft'|'published'; part_size:number; images:BatchImage[]}
export interface UploadProgress {message:string; bytes:number}

export async function uploadStudy(packets:StudyPackets,prefix:string,doctors:string[],signal:AbortSignal,
  progress:(value:UploadProgress)=>void):Promise<'published'|'existing'> {
  const batch:Batch=await api('/admin/batches',{method:'POST',signal,
    body:JSON.stringify({prefix,cases:packets.cases})});
  if(batch.state==='published') return 'existing';
  if(!Number.isSafeInteger(batch.part_size) || batch.part_size<=0) throw new Error('Unexpected upload part size.');
  const base='/admin/batches/'+encodeURIComponent(batch.batch_id);
  const images=new Map(batch.images.map(img=>[img.case_id,img]));
  let bytes=0;
  for(const [i,studyCase] of packets.cases.entries()) {
    const image=images.get(studyCase.case_id);
    if(!image) throw new Error('The upload session is missing '+studyCase.case_id+'.');
    if(image.ready) {bytes+=studyCase.size;continue;}
    const message='Uploading '+studyCase.case_id+' · CT '+(i+1)+' of '+packets.cases.length;
    progress({message,bytes});
    const url=base+'/images/'+encodeURIComponent(studyCase.case_id);
    let blob:Blob|undefined;
    const uploaded=new Set(image.parts);
    for(let start=0,part=1;start<studyCase.size;start+=batch.part_size,part++) {
      signal.throwIfAborted();
      const end=Math.min(start+batch.part_size,studyCase.size);
      if(!uploaded.has(part)) {
        blob??=await packets.getImage(studyCase.case_id);
        if(blob.size!==studyCase.size) throw new Error('Image size changed. Select and verify the files again.');
        await api(url+'/parts/'+part,{method:'PUT',signal,headers:{'Content-Type':'application/octet-stream'},
          body:blob.slice(start,end)});
      }
      bytes+=end-start;
      progress({message,bytes});
    }
    await api(url+'/complete',{method:'POST',signal});
  }
  progress({message:'Publishing cases and reader assignments…',bytes});
  await api(base+'/publish',{method:'POST',signal,body:JSON.stringify({doctors})});
  return 'published';
}

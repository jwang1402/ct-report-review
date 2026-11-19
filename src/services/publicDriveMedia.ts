import {driveFileId,verifyCaseVolume} from './restrictedDrive';
import {apiBase,sessionToken} from './session';

type ExpectedImage = {size:number;sha256?:string};
export type DriveImageProgress =
  | {stage:'download';received:number;total:number;reconnecting?:boolean}
  | {stage:'verify';percent:number};

function fileRequest(link:string, query:Record<string,string>, signal:AbortSignal, range?:string) {
  const id=driveFileId(link);
  const key=import.meta.env.VITE_DRIVE_API_KEY;
  if(!id)throw new Error('Choose a sharing link for an individual Google Drive file.');
  if(!key)throw new Error('Google Drive access for public images has not been configured.');
  const resourceKey=new URL(link).searchParams.get('resourcekey');
  const headers=new Headers();
  if(resourceKey){
    if(!/^[a-zA-Z0-9_-]{1,200}$/.test(resourceKey))throw new Error('Invalid Drive resource key.');
    headers.set('X-Goog-Drive-Resource-Keys',id+'/'+resourceKey);
  }
  if(range)headers.set('Range',range);
  const url=new URL('https://www.googleapis.com/drive/v3/files/'+id);
  url.search=new URLSearchParams({...query,key,supportsAllDrives:'true'}).toString();
  return fetch(url,{headers,signal,credentials:'omit',cache:'no-store',referrerPolicy:'strict-origin'});
}

class TransferError extends Error {
  constructor(message:string, readonly retryable:boolean) {super(message);}
}

async function media(link:string,signal:AbortSignal,range?:string){
  const response=await fileRequest(link,{alt:'media'},signal,range);
  if(!response.ok||!response.body||/text\/html|application\/json/i.test(response.headers.get('Content-Type')??'')){
    await response.body?.cancel();
    if(response.status===429||response.status>=500)throw new TransferError('Google Drive is temporarily unavailable. Retry loading the CT.',true);
    throw new TransferError('Google Drive did not return this CT ('+response.status+'). Open the file link to check access.',false);
  }
  return response;
}

const RANGE_BYTES=4*1024*1024;
const DIRECT_IDLE_MS=8000;
const retryDelays=[1000,3000,7000,15000,25000];

async function reconnectAfter(delay:number,signal:AbortSignal){
  signal.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
    const done=()=>{signal.removeEventListener('abort',abort);resolve();};
    const timer=setTimeout(done,delay);
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    signal.addEventListener('abort',abort,{once:true});
  });
}

async function studyMedia(caseId:string,signal:AbortSignal,range?:string) {
  const token=sessionToken();
  if(!token||!apiBase)throw new TransferError('Your review session has ended. Reopen the case to load the CT.',false);
  const headers=new Headers({Authorization:'Bearer '+token});
  if(range)headers.set('Range',range);
  const url=apiBase+'/blind/cases/'+encodeURIComponent(caseId)+'/image'+(range?'?part='+range.slice(6):'');
  const response=await fetch(url,{headers,signal,credentials:'omit',cache:'no-store',redirect:'error'});
  if(!response.ok||!response.body){
    let msg='The review service could not load this CT ('+response.status+').';
    if(response.headers.get('content-type')?.includes('application/json')){
      const body=await response.json().catch(()=>null);
      if(typeof body?.error==='string')msg=body.error;
    }
    throw new TransferError(msg,response.status===429||response.status>=500);
  }
  return response;
}

type PartSource=(signal:AbortSignal,range?:string)=>Promise<Response>;

class InvalidMedia extends Error {}

async function readTransfer(source:PartSource,total:number,start:number,end:number,idleMs:number,signal:AbortSignal,
  append:(part:Blob)=>void,update:(bytes:number)=>void) {
  const range=start>0||end<total-1?'bytes='+start+'-'+end:undefined;
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal.throwIfAborted();
  signal.addEventListener('abort',abort,{once:true});
  let timer=setTimeout(abort,idleMs);
  try {
    const response=await source(controller.signal,range);
    if(response.status===200 && start!==0) {
      abort();throw new InvalidMedia('The server could not resume the CT at the requested position.');
    }
    const length=response.status===200?total:end-start+1;
    const contentRange=response.headers.get('Content-Range');
    if(response.status!==200 && (response.status!==206 || !range || (contentRange && contentRange!=='bytes '+start+'-'+end+'/'+total))) {
      abort();throw new TransferError('Drive returned an unexpected part of the CT. Retry loading the file.',true);
    }
    let pieces:BlobPart[]=[], pending=0, count=0;
    function flush(){
      if(!pending)return;
      append(new Blob(pieces));pieces=[];pending=0;
    }
    const reader=response.body!.getReader();
    try {
      for(;;){
        const chunk=await reader.read();
        if(chunk.done)break;
        if(!chunk.value.byteLength)continue;
        clearTimeout(timer);timer=setTimeout(abort,idleMs);
        count+=chunk.value.byteLength;
        if(count>length){abort();throw new InvalidMedia('The downloaded CT exceeds its verified size.');}
        pieces.push(chunk.value);
        pending+=chunk.value.byteLength;
        if(pending>=RANGE_BYTES)flush();
        update(start+count);
      }
    } finally {flush();reader.releaseLock();}
    if(count!==length)throw new TransferError('The CT download stopped early. Retry loading the file.',true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort',abort);
  }
}

export async function downloadPublicDriveCase(link:string,expected:ExpectedImage,signal:AbortSignal,onProgress?:(progress:DriveImageProgress)=>void,caseId?:string) {
  const total=expected.size;
  const parts:Blob[]=[];
  const direct:PartSource=(partSignal,range)=>media(link,partSignal,range);
  let saved=0,lastUpdate=0;
  function append(part:Blob){parts.push(part);saved+=part.size;}
  onProgress?.({stage:'download',received:0,total});
  function update(received:number){
    const now=performance.now();
    if(received===total||now-lastUpdate>=100){
      onProgress?.({stage:'download',received,total});lastUpdate=now;
    }
  }
  // A healthy connection delivers the entire scan in a single GET.
  try{
    await readTransfer(direct,total,0,total-1,DIRECT_IDLE_MS,signal,append,update);
  }catch(e){
    signal.throwIfAborted();
    if(e instanceof InvalidMedia||(!caseId&&e instanceof TransferError&&!e.retryable))throw e;
    if(saved<total)onProgress?.({stage:'download',received:saved,total,reconnecting:true});
  }
  const resume:PartSource=caseId?(partSignal,range)=>studyMedia(caseId,partSignal,range):direct;
  let span=RANGE_BYTES;
  while(saved<total){
    for(let retry=0;;){
      try{
        const end=Math.min(saved+span,total)-1;
        await readTransfer(resume,total,saved,end,45000,signal,append,update);
        break;
      }catch(e){
        signal.throwIfAborted();
        if(e instanceof InvalidMedia||(e instanceof TransferError&&!e.retryable))throw e;
        if(saved===total)break;
        if(retry>=retryDelays.length)throw e instanceof TransferError?e:new Error('The connection to Google Drive was interrupted. Retry loading the CT or open the downloaded file.');
        onProgress?.({stage:'download',received:saved,total,reconnecting:true});
        span=Math.max(512*1024,span/2);
        await reconnectAfter(retryDelays[retry++],signal);
      }
    }
  }
  const file=new File(parts,'study-ct.nii.gz',{type:'application/gzip'});
  onProgress?.({stage:'verify',percent:0});
  await verifyCaseVolume(file,expected,signal,percent=>onProgress?.({stage:'verify',percent}));
  return file;
}

// Use the anonymous API key and no cookies to exercise the same access as a reader.
export async function verifyPublicDriveCase(link:string,expected:ExpectedImage,signal:AbortSignal) {
  const response=await fileRequest(link,{fields:'id,size,sha256Checksum,capabilities(canDownload)'},signal);
  if(!response.ok)throw new Error('This CT cannot be opened anonymously. Use a Drive file shared as Anyone with the link (Viewer).');
  const metadata=await response.json();
  if(metadata.id!==driveFileId(link)||Number(metadata.size)!==expected.size||metadata.capabilities?.canDownload===false)
    throw new Error('The public CT must match the verified file size and allow downloads.');
  if(!metadata.sha256Checksum){
    await downloadPublicDriveCase(link,expected,signal);
    return;
  }
  if(metadata.sha256Checksum!==expected.sha256)throw new Error('The CT at this link does not match the case checksum.');
  const probe=await media(link,signal,'bytes=0-1');
  const reader=probe.body!.getReader();
  const magic:number[]=[];
  try {
    while(magic.length<2) {
      const {value,done}=await reader.read();
      if(done)break;
      for(const byte of value.subarray(0,2-magic.length))magic.push(byte);
    }
  } finally {await reader.cancel();reader.releaseLock();}
  if(magic[0]!==31||magic[1]!==139)throw new Error('Drive did not return the expected compressed CT image.');
}

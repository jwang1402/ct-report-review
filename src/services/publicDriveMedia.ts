import {driveFileId,verifyCaseVolume} from './restrictedDrive';

type ExpectedImage = {size:number;sha256?:string};

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

async function media(link:string,signal:AbortSignal,range?:string){
  const response=await fileRequest(link,{alt:'media'},signal,range);
  if(!response.ok||!response.body||/text\/html|application\/json/i.test(response.headers.get('Content-Type')??'')){
    await response.body?.cancel();
    throw new Error('Google Drive could not serve this CT without signing in. Check the file link and download permission.');
  }
  return response;
}

export async function downloadPublicDriveCase(link:string,expected:ExpectedImage,signal:AbortSignal) {
  const response=await media(link,signal);
  const reader=response.body!.getReader();
  const parts:ArrayBuffer[]=[];
  let size=0;
  try {
    for(;;){
      const chunk=await reader.read();
      if(chunk.done)break;
      size+=chunk.value.byteLength;
      if(size>expected.size)throw new Error('The Drive file is larger than the verified case image.');
      parts.push(new Uint8Array(chunk.value).buffer);
    }
  } finally {await reader.cancel();reader.releaseLock();}
  const file=new File(parts,'study-ct.nii.gz',{type:'application/gzip'});
  await verifyCaseVolume(file,expected,signal);
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

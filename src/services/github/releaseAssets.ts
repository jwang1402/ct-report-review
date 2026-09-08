import type {ReleaseAsset} from '../../types';
export const ASSET_LIMIT=2*1024**3;
export function guardSize(size:number){if(size>=ASSET_LIMIT)throw new Error('Files must be smaller than 2 GiB per Release asset.');if(size<=0)throw new Error('The imaging file is empty.');}
export async function downloadAsset(asset:ReleaseAsset,onProgress?:(n:number,total:number)=>void,signal?:AbortSignal):Promise<Blob>{
 guardSize(asset.size);
 if(!asset.url)throw new Error('Automatic Drive loading is not configured for this deployment.');
 let response:Response;
 try {response=await fetch(asset.url,{headers:{Accept:'application/octet-stream'},credentials:'omit',signal});}catch(e){if(signal?.aborted)throw e;throw new Error('Cannot download imaging. Check your network and storage access.');}
 if(!response.ok)throw new Error(`Imaging/metadata download failed (${response.status}). Refresh cases and try again.`);
 if(/application\/json|text\/html/.test(response.headers.get('content-type')||''))throw new Error('Storage returned a page or metadata instead of imaging data.');
 if(!response.body)return verify(await response.blob(),asset);
 const reader=response.body.getReader();const chunks:Uint8Array<ArrayBuffer>[]=[];let n=0;
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>=ASSET_LIMIT){await reader.cancel();throw new Error('Asset exceeds the 2 GiB limit.');}chunks.push(new Uint8Array(value));onProgress?.(n,asset.size);}
 if(n!==asset.size)throw new Error('Incomplete download. Expected '+asset.size+' bytes, received '+n+'.');
 return verify(new Blob(chunks),asset);
}
async function verify(blob:Blob,asset:ReleaseAsset){
 if(blob.size!==asset.size)throw new Error('Incomplete imaging download.');
 if(asset.sha256){const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const hash=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');if(hash!==asset.sha256)throw new Error('Imaging checksum mismatch. The file may have changed; refresh the published case metadata.');}
 return blob;
}

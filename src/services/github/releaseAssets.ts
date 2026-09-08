import type {ReleaseAsset} from '../../types';
export const ASSET_LIMIT=2*1024**3;
export function guardSize(size:number){if(size>=ASSET_LIMIT)throw new Error('Files must be smaller than 2 GiB per Release asset.');if(size<=0)throw new Error('The imaging file is empty.');}
export async function downloadAsset(asset:ReleaseAsset,onProgress?:(n:number,total:number)=>void,signal?:AbortSignal):Promise<Blob>{
 guardSize(asset.size);
 let response:Response;
 try {response=await fetch(asset.url,{headers:{Accept:'application/octet-stream'},signal});}catch(e){if(signal?.aborted)throw e;throw new Error('Cannot download this Release asset. Check the network and GitHub cross-origin access.');}
 if(!response.ok)throw new Error(`Imaging/metadata download failed (${response.status}). Refresh cases and try again.`);
 if(response.headers.get('content-type')?.includes('application/json'))throw new Error('GitHub returned asset metadata instead of a binary file. Retry later.');
 if(!response.body)return response.blob();
 const reader=response.body.getReader();const chunks:Uint8Array<ArrayBuffer>[]=[];let n=0;
 while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>=ASSET_LIMIT){await reader.cancel();throw new Error('Asset exceeds the 2 GiB limit.');}chunks.push(new Uint8Array(value));onProgress?.(n,asset.size);}
 if(n!==asset.size)throw new Error('Incomplete download. Expected '+asset.size+' bytes, received '+n+'.');
 return new Blob(chunks);
}

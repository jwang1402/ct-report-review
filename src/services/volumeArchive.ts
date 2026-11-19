import {gunzip,unzip} from 'fflate';
import {ASSET_LIMIT} from './github/releaseAssets';

export function unzipFiles(bytes:Uint8Array) {
  return new Promise<Record<string,Uint8Array>>((resolve,reject) => {
    unzip(bytes,{filter(entry) {
      if(entry.originalSize>=ASSET_LIMIT) throw new Error('Expanded DICOM file exceeds 2 GiB.');
      return true;
    }},(error,files)=>error?reject(error):resolve(files));
  });
}

export function gunzipBytes(bytes:Uint8Array) {
  return new Promise<Uint8Array<ArrayBuffer>>((resolve,reject) => {
    gunzip(bytes,(error,output)=>error?reject(error):resolve(new Uint8Array(output)));
  });
}

/** Stream decompression into a browser-backed Blob instead of retaining complete
 * compressed and expanded buffers on the JavaScript heap at the same time. */
export async function prepareNiftiBlob(file:Blob,signal:AbortSignal):Promise<Blob> {
  signal.throwIfAborted();
  const signature=new Uint8Array(await file.slice(0,2).arrayBuffer());
  let source=file;
  if(signature[0]===31 && signature[1]===139) {
    if(typeof DecompressionStream==='function') {
      let size=0;
      const bounded=new TransformStream<Uint8Array,Uint8Array>({
        transform(part,controller) {
          size+=part.byteLength;
          if(size>=ASSET_LIMIT)throw new Error('Expanded NIfTI exceeds 2 GiB.');
          controller.enqueue(part);
        }
      });
      const expanded=file.stream().pipeThrough(new DecompressionStream('gzip'),{signal}).pipeThrough(bounded,{signal});
      source=await new Response(expanded).blob();
    } else {
      source=new Blob([await gunzipBytes(new Uint8Array(await file.arrayBuffer()))]);
    }
  }
  signal.throwIfAborted();
  if(source.size>=ASSET_LIMIT)throw new Error('Expanded NIfTI exceeds 2 GiB.');
  // The metadata reader uses a 540-byte prefix for both NIfTI-1 and NIfTI-2.
  if(source.size<540)throw new Error('The CT file is too short for the NIfTI image reader.');
  return source;
}

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

import {expect,it} from 'vitest';
import {gzipSync} from 'fflate';
import {prepareNiftiBlob} from './volumeArchive';

it('expands gzip CT bytes exactly and leaves plain CT bytes in their original blob',async()=>{
  const original=Uint8Array.from({length:2000},(_,i)=>i%251);
  const signal=new AbortController().signal;
  const plain=new Blob([original]);
  expect(await prepareNiftiBlob(plain,signal)).toBe(plain);
  const zipped=new Blob([new Uint8Array(gzipSync(original))]);
  const decoded=await prepareNiftiBlob(zipped,signal);
  expect(new Uint8Array(await decoded.arrayBuffer())).toEqual(original);
});

it('stops on case changes and rejects truncated input before handing it to the renderer',async()=>{
  const short=new Blob([new Uint8Array(256)]);
  await expect(prepareNiftiBlob(short,new AbortController().signal)).rejects.toThrow('too short');
  await expect(prepareNiftiBlob(short,AbortSignal.abort())).rejects.toMatchObject({name:'AbortError'});
  const broken=new Blob([Uint8Array.of(31,139,1,2)]);
  await expect(prepareNiftiBlob(broken,new AbortController().signal)).rejects.toThrow();
});

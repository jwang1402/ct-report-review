import {afterEach,expect,it,vi} from 'vitest';
import {driveMediaUrl} from './releases';
import {downloadAsset} from './releaseAssets';
afterEach(()=>vi.unstubAllGlobals());
it('builds only official Drive URLs and rejects path injection',()=>{
 const u=new URL(driveMediaUrl('17up7GiGsOsiP1Klbb39hutBLx9jzhQWG','test-key'));
 expect(u.origin).toBe('https://www.googleapis.com');expect(u.searchParams.get('alt')).toBe('media');
 expect(()=>driveMediaUrl('../other-host','test-key')).toThrow();
});
it('rejects a same-size corrupted download',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3]))));
 await expect(downloadAsset({id:1,name:'test',size:3,url:'https://www.googleapis.com/test',browser_download_url:'#',state:'uploaded',sha256:'0'.repeat(64)})).rejects.toThrow('checksum mismatch');
});
it('rejects a truncated response before rendering',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2]))));
 await expect(downloadAsset({id:1,name:'test',size:3,url:'https://www.googleapis.com/test',browser_download_url:'#',state:'uploaded'})).rejects.toThrow('Incomplete download');
});

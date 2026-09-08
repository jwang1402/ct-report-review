import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
async function service(){vi.stubEnv('VITE_GOOGLE_CLIENT_ID','123-test.apps.googleusercontent.com');vi.stubGlobal('window',{google:{accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:(opts:{callback:(r:unknown)=>void})=>({requestAccessToken:()=>opts.callback({access_token:'test-token',expires_in:3600})})}}}});const s=await import('./driveUpload');await s.authorizeDrive();return s;}
it('uploads through a resumable session and verifies returned size',async()=>{
 const s=await service();const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:200,headers:{Location:'https://www.googleapis.com/upload/session'}})).mockResolvedValueOnce(new Response('',{status:308})).mockResolvedValueOnce(new Response(JSON.stringify({id:'new-file-id',size:'3'}),{status:200}));vi.stubGlobal('fetch',fetch);
 const progress=vi.fn(),state={offset:0};expect(await s.uploadDriveBlob(new Blob(['abc']),'test.nii','folder',state,progress,new AbortController().signal)).toBe('new-file-id');expect(fetch.mock.calls[2][1].headers['Content-Range']).toBe('bytes 0-2/3');expect(progress).toHaveBeenLastCalledWith(3);
});
it('resumes from the server acknowledged offset',async()=>{
 const s=await service();const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:308,headers:{Range:'bytes=0-1'}})).mockResolvedValueOnce(new Response(JSON.stringify({id:'resumed-file',size:'3'}),{status:200}));vi.stubGlobal('fetch',fetch);
 await s.uploadDriveBlob(new Blob(['abc']),'test.nii','folder',{offset:0,url:'https://www.googleapis.com/upload/session'},()=>{},new AbortController().signal);expect(fetch.mock.calls[1][1].headers['Content-Range']).toBe('bytes 2-2/3');
});
it('rejects upload-session URLs outside Google',async()=>{
 const s=await service();vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{headers:{Location:'https://example.com/capture'}})));
 await expect(s.uploadDriveBlob(new Blob(['a']),'t','f',{offset:0},()=>{},new AbortController().signal)).rejects.toThrow('usable upload session');
});
it('rejects malformed acknowledgement and clears authorization on disconnect',async()=>{
 const s=await service();expect(()=>s.acknowledgedOffset('bytes=0-100',10)).toThrow();s.disconnectDrive();await expect(s.verifyFolder('folder')).rejects.toThrow('expired');
});

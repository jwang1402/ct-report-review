import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {downloadPublicDriveCase,verifyPublicDriveCase,type DriveImageProgress} from './publicDriveMedia';
import {hashBlob} from './fileHash';
vi.mock('./session',()=>({apiBase:'https://review.example',sessionToken:()=>'fixture-session'}));

const bytes=new Uint8Array([31,139,1,2,3]);
const id='fixture-only-ct-file',key='fixture_resource_key';
const link='https://drive.google.com/file/d/'+id+'/view?resourcekey='+key;
const signal=new AbortController().signal;
const fetchMock=vi.fn<typeof fetch>();
beforeEach(()=>{vi.stubEnv('VITE_DRIVE_API_KEY','test-key');vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});

it('checks the sharing link and actual media anonymously before opening the study',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  fetchMock.mockResolvedValueOnce(Response.json({id,size:'5',sha256Checksum:expected.sha256,capabilities:{canDownload:true}}))
    .mockResolvedValueOnce(new Response(bytes.subarray(0,2),{status:206}));
  await verifyPublicDriveCase(link,expected,signal);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for(const [url,init] of fetchMock.mock.calls) {
    expect(String(url)).toMatch(/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\//);
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(new Headers(init?.headers).get('X-Goog-Drive-Resource-Keys')).toBe(id+'/'+key);
  }
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Range')).toBe('bytes=0-1');
});
it('fails when the file requires sign-in or the downloaded CT differs from the expected bytes',async()=>{
  const expected={size:bytes.length,sha256:'0'.repeat(64)};
  fetchMock.mockResolvedValueOnce(new Response(null,{status:403}));
  await expect(verifyPublicDriveCase(link,expected,signal)).rejects.toThrow('anonymously');
  fetchMock.mockResolvedValueOnce(new Response(bytes));
  await expect(downloadPublicDriveCase(link,expected,signal)).rejects.toThrow('does not match');
});
it('can verify a public file by reading it when Drive omits its checksum',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  fetchMock.mockResolvedValueOnce(Response.json({id,size:'5'})).mockResolvedValueOnce(new Response(bytes));
  await verifyPublicDriveCase(link,expected,signal);
});
it('reports streamed bytes against the case size without Content-Length, then verifies the file',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  const progress:DriveImageProgress[]=[];
  const response=new Response(new ReadableStream({start(controller){
    controller.enqueue(bytes.subarray(0,2));
    controller.enqueue(bytes.subarray(2));
    controller.close();
  }}));
  fetchMock.mockResolvedValueOnce(response);
  vi.spyOn(performance,'now').mockReturnValue(500);
  try {
    const output=await downloadPublicDriveCase(link,expected,signal,x=>progress.push(x));
    expect(output.size).toBe(5);
    expect(progress).toEqual([
      {stage:'download',received:0,total:5}, {stage:'download',received:2,total:5},
      {stage:'download',received:5,total:5}, {stage:'verify',percent:0}, {stage:'verify',percent:100}
    ]);
  } finally {vi.restoreAllMocks();}
});

it('downloads a healthy large CT directly with a single GET and no relay request',async()=>{
  const scan=new Uint8Array(9*1024*1024+21);
  scan.set(bytes);
  const expected={size:scan.length,sha256:await hashBlob(new Blob([scan]))};
  fetchMock.mockResolvedValueOnce(new Response(scan));
  const file=await downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01');
  expect(file.size).toBe(scan.length);expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url,init]=fetchMock.mock.calls[0];
  expect(String(url)).toContain('https://www.googleapis.com/drive/v3/files/');
  expect(new Headers(init?.headers).has('Range')).toBe(false);
  expect(new Headers(init?.headers).has('Authorization')).toBe(false);
});

it('resumes a dropped direct stream at the exact received byte, including a partial range',async()=>{
  const stride=4*1024*1024;
  const scan=new Uint8Array(stride+5),offset=stride+2;
  scan.set(bytes);scan.set([3,9,7],stride);
  const expected={size:scan.length,sha256:await hashBlob(new Blob([scan]))};
  let sent=0;
  fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({pull(controller){
    if(sent===0)controller.enqueue(scan.subarray(0,stride));
    else if(sent===1)controller.enqueue(scan.subarray(stride,offset));
    else controller.error(new TypeError('Stream interrupted'));
    sent++;
  }}))).mockResolvedValueOnce(new Response(scan.subarray(offset),{status:206,
    headers:{'Content-Range':'bytes '+offset+'-'+(scan.length-1)+'/'+scan.length}}));
  const output=await downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01');
  expect(output.size).toBe(scan.length);
  expect(fetchMock.mock.calls.map(([,init])=>new Headers(init?.headers).get('Range'))).toEqual(
    [null,'bytes=4194306-4194308']);
  const sources=fetchMock.mock.calls;
  expect(new Headers(sources[0][1]?.headers).has('Authorization')).toBe(false);
  expect(sources[1][0]).toBe('https://review.example/blind/cases/Study-Case01/image?part=4194306-4194308');
  expect(new Headers(sources[1][1]?.headers).get('Authorization')).toBe('Bearer fixture-session');
});

it('switches to the authorized service if Drive stops sending bytes, without a competing transfer',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  fetchMock.mockImplementationOnce(async(_url,init)=>new Response(new ReadableStream({start(controller){
    controller.enqueue(bytes.subarray(0,2));
    init?.signal?.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
  }}))).mockResolvedValueOnce(new Response(bytes.subarray(2),{status:206,headers:{'Content-Range':'bytes 2-4/5'}}));
  vi.useFakeTimers();
  try {
    const pending=downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01');
    await vi.advanceTimersByTimeAsync(7900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101);
    const output=await pending;
    expect(output.size).toBe(5);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('Range')).toBe('bytes=2-4');
  } finally {vi.useRealTimers();}
});

it('falls back when Drive never starts responding and stops altogether when the reader leaves',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  const noResponse:typeof fetch=(_url,init)=>new Promise((_resolve,reject)=>{
    init?.signal?.addEventListener('abort',()=>reject(init.signal?.reason),{once:true});
  });
  fetchMock.mockImplementationOnce(noResponse).mockResolvedValueOnce(new Response(bytes));
  vi.useFakeTimers();
  try {
    const waiting=downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01');
    await vi.advanceTimersByTimeAsync(8001);
    expect((await waiting).size).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementationOnce(noResponse);
    const leave=new AbortController();
    const abandoned=downloadPublicDriveCase(link,expected,leave.signal,undefined,'Study-Case02');
    leave.abort();
    await expect(abandoned).rejects.toMatchObject({name:'AbortError'});
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  } finally {vi.useRealTimers();}
});

it('does not accept a different file from the review service or reuse a restricted session',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response(new Uint8Array(bytes.length)));
  await expect(downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01')).rejects.toThrow('does not match');
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json({error:'Case not found.'},{status:404}));
  await expect(downloadPublicDriveCase(link,expected,signal,undefined,'Other-Case02')).rejects.toThrow('Case not found');
});

it('recovers from a temporary transfer failure with a smaller range at the same offset',async()=>{
  const stride=4*1024*1024;
  const scan=new Uint8Array(stride*2+7);
  scan.set(bytes);scan.set(bytes,stride);
  const expected={size:scan.length,sha256:await hashBlob(new Blob([scan]))};
  let interrupted=false;
  const ranges:string[]=[];
  fetchMock.mockImplementation(async(input,init)=>{
    if(String(input).startsWith('https://www.googleapis.com/'))throw new TypeError('Failed to fetch');
    const range=new Headers(init?.headers).get('Range')!;
    ranges.push(range);
    if(range.startsWith('bytes='+stride+'-')&&!interrupted){
      interrupted=true;return new Response(null,{status:503});
    }
    const [start,end]=range.slice(6).split('-').map(Number);
    return new Response(scan.subarray(start,end+1),{status:206,headers:{'Content-Range':'bytes '+start+'-'+end+'/'+scan.length}});
  });
  const progress:DriveImageProgress[]=[];
  const file=await downloadPublicDriveCase(link,expected,signal,x=>progress.push(x),'Study-Case01');
  expect(file.size).toBe(scan.length);
  expect(ranges).toEqual(['bytes=0-4194303','bytes=4194304-8388607','bytes=4194304-6291455','bytes=6291456-8388607','bytes=8388608-8388614']);
  expect(progress).toContainEqual({stage:'download',received:stride,total:scan.length,reconnecting:true});
});

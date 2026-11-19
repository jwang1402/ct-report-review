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

it('keeps completed ranges when a different origin must supply the remainder',async()=>{
  const stride=4*1024*1024;
  const scan=new Uint8Array(stride+3);
  scan.set(bytes);scan.set([3,9,7],stride);
  const expected={size:scan.length,sha256:await hashBlob(new Blob([scan]))};
  const partial=(first:number,last:number)=>new Response(scan.subarray(first,last+1),{status:206,
    headers:{'Content-Range':'bytes '+first+'-'+last+'/'+scan.length}});
  fetchMock.mockResolvedValueOnce(partial(0,stride-1)).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(partial(stride,scan.length-1));
  const output=await downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01');
  expect(output.size).toBe(scan.length);
  expect(fetchMock.mock.calls.map(([,init])=>new Headers(init?.headers).get('Range'))).toEqual(
    ['bytes=0-4194303','bytes=4194304-4194306','bytes=4194304-4194306']);
  const sources=fetchMock.mock.calls;
  expect(new Headers(sources[0][1]?.headers).has('Authorization')).toBe(false);
  expect(sources[2][0]).toBe('https://review.example/blind/cases/Study-Case01/image');
  expect(new Headers(sources[2][1]?.headers).get('Authorization')).toBe('Bearer fixture-session');
});

it('does not accept a different file from the review service or reuse a restricted session',async()=>{
  const expected={size:bytes.length,sha256:await hashBlob(new Blob([bytes]))};
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(new Response(new Uint8Array(bytes.length)));
  await expect(downloadPublicDriveCase(link,expected,signal,undefined,'Study-Case01')).rejects.toThrow('does not match');
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json({error:'Case not found.'},{status:404}));
  await expect(downloadPublicDriveCase(link,expected,signal,undefined,'Other-Case02')).rejects.toThrow('Case not found');
});

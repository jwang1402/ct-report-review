import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {downloadPublicDriveCase,verifyPublicDriveCase} from './publicDriveMedia';
import {hashBlob} from './fileHash';

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

import {beforeEach,expect,it,vi} from 'vitest';
import {api} from './session';
import type {StudyPackets} from './studyPackets';
import {uploadStudy} from './studyUpload';

vi.mock('./session',()=>({api:vi.fn()}));
const apiMock=vi.mocked(api);
const caseData=(case_id:string,size:number)=>({case_id,case_name:case_id,size,sha256:'0'.repeat(64),part_sha256:['0'.repeat(64)],reports:[]});
const packets:StudyPackets={
  cases:[caseData('Case01',4),caseData('Case02',10)],
  getImage:vi.fn(async()=>new Blob(['0123456789'])),
};
const signal=new AbortController().signal;
beforeEach(()=>{vi.clearAllMocks();apiMock.mockReset();});

it('resumes a draft from the server-side part list and publishes only after images are complete',async()=>{
  apiMock.mockResolvedValueOnce({batch_id:'draft',state:'draft',part_size:8,images:[
    {case_id:'Case01',ready:true,parts:[]},{case_id:'Case02',ready:false,parts:[1]}
  ]}).mockResolvedValue({ok:true});
  const progress=vi.fn();
  await expect(uploadStudy(packets,'study',['reader01'],signal,progress)).resolves.toBe('published');
  const calls=apiMock.mock.calls;
  expect(calls.map(c=>c[0])).toEqual(['/admin/batches','/admin/batches/draft/images/Case02/parts/2',
    '/admin/batches/draft/images/Case02/complete','/admin/batches/draft/publish']);
  expect(packets.getImage).toHaveBeenCalledExactlyOnceWith('Case02');
  expect(await (calls[1][1]?.body as Blob).text()).toBe('89');
  expect(JSON.parse(String(calls[3][1]?.body))).toEqual({doctors:['reader01']});
  expect(progress.mock.calls.at(-1)?.[0].bytes).toBe(14);
});

it('does not publish an incomplete study when an image part fails',async()=>{
  apiMock.mockResolvedValueOnce({batch_id:'draft',state:'draft',part_size:8,images:[
    {case_id:'Case01',ready:true,parts:[]},{case_id:'Case02',ready:false,parts:[]}
  ]}).mockRejectedValueOnce(new Error('Connection interrupted'));
  await expect(uploadStudy(packets,'study',[],signal,vi.fn())).rejects.toThrow('Connection interrupted');
  expect(apiMock.mock.calls.map(c=>c[0])).toEqual(['/admin/batches','/admin/batches/draft/images/Case02/parts/1']);
});

it('recognizes a successful prior publish after a lost response',async()=>{
  apiMock.mockResolvedValueOnce({batch_id:'draft',state:'published',part_size:8,images:[]});
  await expect(uploadStudy(packets,'study',[],signal,vi.fn())).resolves.toBe('existing');
  expect(apiMock).toHaveBeenCalledTimes(1);
  expect(packets.getImage).not.toHaveBeenCalled();
});

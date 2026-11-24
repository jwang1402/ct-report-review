import {expect,it} from 'vitest';
import {gzipSync} from 'fflate';
import {hashBlob} from './fileHash';
import {blankCase} from './studyB';
import {prepareStudyBUpload} from './studyBBulkUpload';

const scan=(id:string,content=id)=>new File([new Uint8Array(gzipSync(new TextEncoder().encode(content)))],id+'.nii.gz');
const signal=()=>new AbortController().signal;

it('matches by exact filename, checks pinned bytes, preserves drafts and supports a partial selection',async()=>{
  const first=scan('B01'), third=scan('B03');
  const expected=await hashBlob(first);
  const rows=[{...blankCase('B01'),draft:'Findings: Clear lungs.',sha256:expected,size:first.size},
              {...blankCase('B02'),reference:'Expert reading.',size:273,sha256:'0'.repeat(64)}];
  const packets=await prepareStudyBUpload([third,first],rows,signal());
  expect(packets.cases.map(x=>x.case_id)).toEqual(['B01','B03']);
  expect(packets.cases[0]).toEqual({case_id:'B01',sha256:expected,size:first.size});
  expect(packets.otherFolderCases).toEqual([{case_id:'B02',size:273,sha256:'0'.repeat(64)}]);
  expect(await packets.getImage('B03')).toBe(third);
  await expect(packets.getImage('B02')).rejects.toThrow('No local CT');
  expect(rows[1].reference).toBe('Expert reading.');
});

it('rejects names, duplicate IDs, duplicate content and conflicting prefilled metadata',async()=>{
  const file=scan('B01');
  for (const invalid of [[],[scan('B00')],[scan('B11')],[scan('Case01')],[file,file],[file,scan('B02','B01')]])
    await expect(prepareStudyBUpload(invalid,[],signal())).rejects.toThrow();
  await expect(prepareStudyBUpload([file],[{...blankCase('B01'),size:file.size+1}],signal())).rejects.toThrow('size');
  await expect(prepareStudyBUpload([file],[{...blankCase('B01'),sha256:'0'.repeat(64)}],signal())).rejects.toThrow('checksum');
  await expect(prepareStudyBUpload([file],[{...blankCase('B02'),sha256:await hashBlob(file)}],signal())).rejects.toThrow('same CT');
  await expect(prepareStudyBUpload([new File(['wrong'],'B01.nii.gz')],[],signal())).rejects.toThrow('gzip');
});

it('stops preflight when cancelled',async()=>{
  const ctrl=new AbortController();ctrl.abort();
  await expect(prepareStudyBUpload([scan('B01')],[],ctrl.signal)).rejects.toThrow();
});

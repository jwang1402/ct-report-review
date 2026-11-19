import {beforeEach,expect,it,vi} from 'vitest';
import {uploadPrivateFolder} from './privateDriveFolder';
import {readDriveMetadata,uploadDriveBlob} from './driveUpload';
import type {StudyPackets} from './studyPackets';

vi.mock('./driveUpload',()=>({readDriveMetadata:vi.fn(),uploadDriveBlob:vi.fn(),verifyFolder:vi.fn()}));
const folder='restricted_folder_01', fileId='verified_casefile01';
const c={case_id:'Case01',case_name:'Case01',size:3,sha256:'a'.repeat(64),part_sha256:[],reports:[]};
const file={id:fileId,name:'Case01.nii.gz',size:'3',sha256Checksum:c.sha256,parents:[folder]};
const packets:StudyPackets={cases:[c],getImage:vi.fn(async()=>new Blob(['ct!']))};
function run(){return uploadPrivateFolder(packets,folder,new Map(),new AbortController().signal,()=>{});}
beforeEach(()=>vi.resetAllMocks());
function service(initialFiles=Array<typeof file>(),acl:Record<string,string[]>={}) {
  const saved=[...initialFiles];
  vi.mocked(readDriveMetadata).mockImplementation(async(path:string)=>{
    if(path==='files')return {files:saved};
    const id=path.split('/')[1];
    if(path.endsWith('/permissions'))return {permissions:(acl[id]??['user']).map(type=>({type}))};
    return saved.find(f=>f.id===id);
  });
  vi.mocked(uploadDriveBlob).mockImplementation(async()=>{saved.push(file);return file.id;});
  vi.mocked(packets.getImage).mockResolvedValue(new Blob(['ct!']));
}
it('uploads only missing CTs then reuses matching bytes in a restricted folder',async()=>{
  service();
  const links={Case01:'https://drive.google.com/file/d/'+file.id+'/view'};
  expect(await run()).toEqual(links);
  expect(await run()).toEqual(links);
  expect(uploadDriveBlob).toHaveBeenCalledTimes(1);
  expect(readDriveMetadata).toHaveBeenCalledWith('files/'+file.id,expect.anything(),expect.anything());
});
it.each(['anyone','domain',''])('refuses public, domain-wide or unverifiable sharing (%s)',async(type)=>{
  service([],{[folder]:type?[type]:[]});
  await expect(run()).rejects.toThrow(/restricted study folder|could not be verified/);
  expect(uploadDriveBlob).not.toHaveBeenCalled();
});
it('refuses public individual file grants even when the folder is restricted',async()=>{
  service([file],{[fileId]:['user','anyone']});
  await expect(run()).rejects.toThrow('restricted study folder');expect(uploadDriveBlob).not.toHaveBeenCalled();
});
it('accepts link-viewer permission only in public mode and passes the resource key on to readers',async()=>{
  const saved={...file,resourceKey:'test_resource_key'};
  vi.mocked(readDriveMetadata).mockImplementation(async(path:string)=>{
    if(path==='files')return {files:[saved]};
    return {permissions:[{type:'user',role:'owner'},{type:'anyone',role:'reader',allowFileDiscovery:false}]};
  });
  const result=await uploadPrivateFolder(packets,folder,new Map(),new AbortController().signal,()=>{},true);
  expect(result.Case01).toBe('https://drive.google.com/file/d/'+file.id+'/view?resourcekey=test_resource_key');
  expect(uploadDriveBlob).not.toHaveBeenCalled();
});
it('requires public read access before an approved upload',async()=>{
  service();
  await expect(uploadPrivateFolder(packets,folder,new Map(),new AbortController().signal,()=>{},true)).rejects.toThrow('Anyone with the link');
  expect(uploadDriveBlob).not.toHaveBeenCalled();
});
it.each([[{...file,sha256Checksum:'invalid'}],[{...file,name:'Other.nii.gz'}],[file,file]])(
  'refuses mismatched hashes, names and duplicate files before uploading',async(...files)=>{
    service(files);await expect(run()).rejects.toThrow();expect(uploadDriveBlob).not.toHaveBeenCalled();
  });

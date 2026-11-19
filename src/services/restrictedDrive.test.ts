import {describe,it,expect} from 'vitest';
import {driveFileId,parseDriveLinksTable,validateDriveLinks,verifyCaseVolume} from './restrictedDrive';
import {hashBlob} from './fileHash';

const first='https://drive.google.com/file/d/Case01abcdefgh/view?usp=sharing&resourcekey=123';
const second='https://drive.google.com/open?id=Case02abcdefgh';
describe('Drive files for a blinded study',()=>{
  it('pairs file links with case aliases and supports pasted spreadsheet rows',()=>{
    const ids=['Case01','Case02'];
    const links=parseDriveLinksTable('Case02\t'+second+'\nCase01,'+first,ids);
    expect(links).toEqual({Case01:first,Case02:second});
    expect(()=>validateDriveLinks(ids,links)).not.toThrow();
    expect(()=>validateDriveLinks(ids,{Case01:first,Case02:first.replace('usp=sharing','usp=copy')})).toThrow(/different CT/);
    expect(()=>validateDriveLinks(ids,{Case01:first})).toThrow(/Case02/);
    expect(()=>parseDriveLinksTable('Case03 '+first,ids)).toThrow();
    expect(()=>parseDriveLinksTable('Case01 '+second+'\nCase01 '+first,ids)).toThrow();
  });
  it('accepts only HTTPS Google Drive files',()=>{
    for(const link of ['http://drive.google.com/file/d/Case01abcdefgh/view',
      'https://other.example/file/d/Case01abcdefgh/view','https://drive.google.com/drive/folders/Case01abcdefgh',
      'https://name@drive.google.com/file/d/Case01abcdefgh/view','javascript:void(0)'])expect(driveFileId(link)).toBeNull();
  });
  it('matches the selected local CT by bytes and digest, regardless of the download filename',async()=>{
    const file=new Blob(['synthetic CT example']);
    const expected={size:file.size,sha256:await hashBlob(file)};
    await expect(verifyCaseVolume(file,expected)).resolves.toBeUndefined();
    await expect(verifyCaseVolume(new Blob(['synthetic CT another']),expected)).rejects.toThrow(/does not match/);
    await expect(verifyCaseVolume(file,{size:file.size})).rejects.toThrow(/checksum/);
  });
});

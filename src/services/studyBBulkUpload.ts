import {hashBlob} from './fileHash';
import type {DriveCaseImage,DriveImagePackets} from './privateDriveFolder';
import type {CaseConfig} from './studyB';

/** Prepare only the selected CTs. The editor applies their verified metadata
 * without replacing drafts, expert references or other case configuration. */
export async function prepareStudyBUpload(
  files:readonly File[], rows:readonly CaseConfig[], signal:AbortSignal,
  progress?:(message:string)=>void
):Promise<DriveImagePackets> {
  signal.throwIfAborted();
  if (!files.length || files.length>10) throw new Error('Choose one to ten Study B CT files.');
  const selected=new Map<string,File>();
  const configured=new Map(rows.map(row=>[row.case_id,row]));
  for (const file of files) {
    const id=/^(B0[1-9]|B10)\.nii\.gz$/.exec(file.name)?.[1];
    if (!id) throw new Error('Use case filenames B01.nii.gz through B10.nii.gz.');
    if (selected.has(id)) throw new Error('More than one CT was selected for '+id+'.');
    if (file.size<3 || file.size>=2**31) throw new Error('Choose a compressed NIfTI under 2 GiB for '+id+'.');
    const size=configured.get(id)?.size;
    if (size && size!==file.size) throw new Error('The CT size does not match the configuration for '+id+'.');
    selected.set(id,file);
  }
  const hashes=new Map<string,string>();
  const otherFolderCases:DriveCaseImage[]=[];
  for (const row of rows) {
    if (!row.sha256) continue;
    const digest=row.sha256.toLowerCase();
    if (hashes.has(digest)) throw new Error('Each Study B case must have a different CT checksum.');
    hashes.set(digest,row.case_id);
    if (row.size && !selected.has(row.case_id))
      otherFolderCases.push({case_id:row.case_id,size:row.size,sha256:digest});
  }
  const cases:DriveCaseImage[]=[];
  for (const id of Array.from(selected.keys()).sort()) {
    signal.throwIfAborted();
    const file=selected.get(id)!;
    const signature=new Uint8Array(await file.slice(0,3).arrayBuffer());
    if (signature[0]!==31 || signature[1]!==139 || signature[2]!==8)
      throw new Error('Expected a gzip-compressed CT for '+id+'.');
    const sha256=await hashBlob(file,signal,p=>progress?.('Checking '+id+' · '+p+'%'));
    const expected=configured.get(id)?.sha256;
    if (expected && sha256!==expected.toLowerCase()) throw new Error('The CT checksum does not match the configuration for '+id+'.');
    const owner=hashes.get(sha256);
    if (owner && owner!==id) throw new Error('The same CT is assigned to '+owner+' and '+id+'.');
    hashes.set(sha256,id);
    cases.push({case_id:id,sha256,size:file.size});
  }
  return {cases,otherFolderCases,async getImage(id){
    const file=selected.get(id);
    if (!file) throw new Error('No local CT selected for '+id+'.');
    return file;
  }};
}

import {readDriveMetadata,uploadDriveBlob,verifyFolder,type UploadSession} from './driveUpload';
import type {PacketCase,StudyPackets} from './studyPackets';

interface DriveFile {id:string;name:string;size:string;sha256Checksum?:string;parents?:string[]}
const fileFields='id,name,size,sha256Checksum,parents';
const validId=/^[A-Za-z0-9_-]{10,200}$/;

async function requireRestricted(id:string,signal:AbortSignal) {
  let pageToken='', active=0;
  do {
    const page=await readDriveMetadata<{permissions:{type:string;deleted?:boolean}[];nextPageToken?:string}>(
      'files/'+id+'/permissions',{fields:'permissions(type,deleted),nextPageToken',pageSize:'100',...(pageToken?{pageToken}:{})},signal);
    if(!Array.isArray(page.permissions))throw new Error('Drive sharing permissions could not be verified.');
    for(const p of page.permissions){
      if(p.deleted)continue;
      if(p.type!=='user'&&p.type!=='group')throw new Error('Select a restricted study folder shared only with named readers or groups. Check individual file sharing as well.');
      active++;
    }
    pageToken=page.nextPageToken??'';
  } while(pageToken);
  if(!active)throw new Error('Drive sharing permissions could not be verified.');
}

function verifyFile(file:DriveFile,c:PacketCase,folder:string) {
  if(!validId.test(file.id)||file.name!==c.case_id+'.nii.gz'||!file.parents?.includes(folder)||
    Number(file.size)!==c.size||file.sha256Checksum!==c.sha256)
    throw new Error('Drive could not confirm the name, size and SHA-256 for '+c.case_id+'. Select a dedicated study folder containing the original scans.');
}

async function inventory(folder:string,cases:PacketCase[],signal:AbortSignal) {
  const expected=new Map(cases.map(c=>[c.case_id+'.nii.gz',c]));
  const found=new Map<string,string>();
  let pageToken='';
  do {
    const page=await readDriveMetadata<{files:DriveFile[];nextPageToken?:string;incompleteSearch?:boolean}>('files',{
      q:"'"+folder+"' in parents and trashed = false",fields:'nextPageToken,incompleteSearch,files('+fileFields+')',
      includeItemsFromAllDrives:'true',pageSize:'100',...(pageToken?{pageToken}:{})
    },signal);
    if(page.incompleteSearch||!Array.isArray(page.files))throw new Error('Drive returned an incomplete file list. Select a dedicated study folder.');
    for(const file of page.files){
      const c=expected.get(file.name);
      if(!c||found.has(c.case_id))throw new Error('This folder contains unexpected or duplicate files. Select a separate study folder.');
      verifyFile(file,c,folder);
      found.set(c.case_id,file.id);
    }
    pageToken=page.nextPageToken??'';
  }while(pageToken);
  return found;
}

export async function uploadPrivateFolder(packets:StudyPackets,folder:string,sessions:Map<string,UploadSession>,
  signal:AbortSignal,progress:(text:string)=>void):Promise<Record<string,string>> {
  if(!validId.test(folder))throw new Error('Select a valid Google Drive folder.');
  await verifyFolder(folder);
  await requireRestricted(folder,signal);
  const existing=await inventory(folder,packets.cases,signal);
  const links:Record<string,string>={};
  for(const [index,c] of packets.cases.entries()){
    signal.throwIfAborted();
    const label=c.case_id+' ('+(index+1)+'/'+packets.cases.length+')';
    let id=existing.get(c.case_id);
    if(!id){
      await requireRestricted(folder,signal);
      const blob=await packets.getImage(c.case_id);
      if(blob.size!==c.size)throw new Error('The verified CT file size changed for '+c.case_id+'.');
      const session=sessions.get(c.case_id)??{offset:0};
      sessions.set(c.case_id,session);
      id=await uploadDriveBlob(blob,c.case_id+'.nii.gz',folder,session,n=>progress('Uploading '+label+' · '+Math.round(n*100/c.size)+'%'),signal);
      if(!validId.test(id))throw new Error('Drive did not return a valid file ID.');
      const remote=await readDriveMetadata<DriveFile>('files/'+id,{fields:fileFields},signal);
      verifyFile(remote,c,folder);
    }
    progress('Verifying '+label+'…');
    await requireRestricted(id,signal);
    links[c.case_id]='https://drive.google.com/file/d/'+id+'/view';
  }
  const final=await inventory(folder,packets.cases,signal);
  if(packets.cases.some(c=>links[c.case_id]!=='https://drive.google.com/file/d/'+final.get(c.case_id)+'/view'))
    throw new Error('The files in this folder changed during verification. Retry to confirm the links.');
  return links;
}

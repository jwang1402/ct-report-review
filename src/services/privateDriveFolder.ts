import {readDriveMetadata,uploadDriveBlob,verifyFolder,type UploadSession} from './driveUpload';
import type {PacketCase,StudyPackets} from './studyPackets';

interface DriveFile {id:string;name:string;size:string;sha256Checksum?:string;parents?:string[];resourceKey?:string}
const fileFields='id,name,size,sha256Checksum,parents,resourceKey';
const validId=/^[A-Za-z0-9_-]{10,200}$/;

async function checkSharing(id:string,signal:AbortSignal,publicAccess:boolean) {
  let pageToken='', active=0, linkViewer=false;
  do {
    const page=await readDriveMetadata<{permissions:{type:string;role?:string;allowFileDiscovery?:boolean;deleted?:boolean}[];nextPageToken?:string}>(
      'files/'+id+'/permissions',{fields:'permissions(type,role,allowFileDiscovery,deleted),nextPageToken',pageSize:'100',...(pageToken?{pageToken}:{})},signal);
    if(!Array.isArray(page.permissions))throw new Error('Drive sharing permissions could not be verified.');
    for(const p of page.permissions){
      if(p.deleted)continue;
      if(publicAccess && p.type==='anyone'){
        if(p.role!=='reader'||p.allowFileDiscovery===true)throw new Error('Choose Anyone with the link with Viewer permission for this study.');
        linkViewer=true;
      }else if(p.type!=='user'&&p.type!=='group'&&!(publicAccess&&p.type==='domain')){
        throw new Error('Select a restricted study folder shared only with named readers or groups. Check individual file sharing as well.');
      }
      active++;
    }
    pageToken=page.nextPageToken??'';
  } while(pageToken);
  if(!active)throw new Error('Drive sharing permissions could not be verified.');
  if(publicAccess&&!linkViewer)throw new Error('Set the dedicated Drive folder to Anyone with the link (Viewer) before uploading the approved public cases.');
}

function verifyFile(file:DriveFile,c:PacketCase,folder:string) {
  if(!validId.test(file.id)||file.name!==c.case_id+'.nii.gz'||!file.parents?.includes(folder)||
    Number(file.size)!==c.size||file.sha256Checksum!==c.sha256)
    throw new Error('Drive could not confirm the name, size and SHA-256 for '+c.case_id+'. Select a dedicated study folder containing the original scans.');
}

async function inventory(folder:string,cases:PacketCase[],signal:AbortSignal) {
  const expected=new Map(cases.map(c=>[c.case_id+'.nii.gz',c]));
  const found=new Map<string,DriveFile>();
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
      found.set(c.case_id,file);
    }
    pageToken=page.nextPageToken??'';
  }while(pageToken);
  return found;
}

function fileLink(file:DriveFile) {
  const url=new URL('https://drive.google.com/file/d/'+file.id+'/view');
  if(file.resourceKey)url.searchParams.set('resourcekey',file.resourceKey);
  return url.href;
}

export async function uploadPrivateFolder(packets:StudyPackets,folder:string,sessions:Map<string,UploadSession>,
  signal:AbortSignal,progress:(text:string)=>void,publicAccess=false):Promise<Record<string,string>> {
  if(!validId.test(folder))throw new Error('Select a valid Google Drive folder.');
  await verifyFolder(folder);
  await checkSharing(folder,signal,publicAccess);
  const existing=await inventory(folder,packets.cases,signal);
  const links:Record<string,string>={};
  for(const [index,c] of packets.cases.entries()){
    signal.throwIfAborted();
    const label=c.case_id+' ('+(index+1)+'/'+packets.cases.length+')';
    let file=existing.get(c.case_id);
    if(!file){
      await checkSharing(folder,signal,publicAccess);
      const blob=await packets.getImage(c.case_id);
      if(blob.size!==c.size)throw new Error('The verified CT file size changed for '+c.case_id+'.');
      const session=sessions.get(c.case_id)??{offset:0};
      sessions.set(c.case_id,session);
      const id=await uploadDriveBlob(blob,c.case_id+'.nii.gz',folder,session,n=>progress('Uploading '+label+' · '+Math.round(n*100/c.size)+'%'),signal);
      if(!validId.test(id))throw new Error('Drive did not return a valid file ID.');
      file=await readDriveMetadata<DriveFile>('files/'+id,{fields:fileFields},signal);
      verifyFile(file,c,folder);
    }
    progress('Verifying '+label+'…');
    await checkSharing(file.id,signal,publicAccess);
    links[c.case_id]=fileLink(file);
  }
  const final=await inventory(folder,packets.cases,signal);
  if(packets.cases.some(c=>!final.has(c.case_id)||links[c.case_id]!==fileLink(final.get(c.case_id)!)))
    throw new Error('The files in this folder changed during verification. Retry to confirm the links.');
  return links;
}

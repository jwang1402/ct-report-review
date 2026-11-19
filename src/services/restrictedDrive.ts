import {hashBlob} from './fileHash';

export function driveFileId(link:string) {
  try {
    const url=new URL(link.trim());
    if (url.origin!=='https://drive.google.com'||url.username||url.password) return null;
    const id=url.pathname==='/open'?url.searchParams.get('id')
      :/^\/file\/d\/([A-Za-z0-9_-]+)\/view\/?$/.exec(url.pathname)?.[1];
    return id&&/^[A-Za-z0-9_-]{10,200}$/.test(id)?id:null;
  } catch {return null;}
}

export function validateDriveLinks(caseIds:string[],links:Record<string,string>) {
  const seen=new Set<string>();
  for (const caseId of caseIds) {
    const id=driveFileId(links[caseId]??'');
    if (!id) throw new Error('Add a Google Drive file link for '+caseId+'.');
    if (seen.has(id)) throw new Error('Each case needs a different CT file. Check '+caseId+'.');
    seen.add(id);
  }
}

export function parseDriveLinksTable(text:string,caseIds:string[]) {
  const links:Record<string,string>={};
  for (const line of text.trim().split(/\r?\n/)) {
    const [alias,link,...rest]=line.trim().split(/[,\s]+/u);
    if (!caseIds.includes(alias)||!link||rest.length||!driveFileId(link)) {
      throw new Error('Use one case and one Drive file link per row, for example Case01 followed by its link.');
    }
    if (links[alias]) throw new Error('The list contains '+alias+' twice.');
    links[alias]=link;
  }
  return links;
}

export async function verifyCaseVolume(file:Blob,imaging:{size:number;sha256?:string},signal?:AbortSignal,onProgress?:(percent:number)=>void) {
  if (!imaging.sha256) throw new Error('The case checksum is missing. Contact the coordinator.');
  if (file.size!==imaging.size || await hashBlob(file,signal,onProgress)!==imaging.sha256) {
    throw new Error('This file does not match this case. Select the original .nii.gz from the case link.');
  }
}

import {BlobReader,ZipReader} from '@zip.js/zip.js';
import {filesIn,readText,scanBlob} from './studyPackets';
import {caseIds,readConfiguration} from './studyBImport';
import type {CaseConfig} from './studyB';

export function mergeStudyBCaseFiles(current:CaseConfig[],incoming:CaseConfig[]):CaseConfig[] {
  const merged=new Map(current.map(row=>[row.case_id,row]));
  for(const next of incoming){
    const old=merged.get(next.case_id);
    if(old&&((old.sha256&&next.sha256&&old.sha256!==next.sha256)||(old.size&&next.size&&old.size!==next.size)))
      throw new Error('The CT for '+next.case_id+' differs from its current configuration.');
    merged.set(next.case_id,old?{
      ...old,size:old.size||next.size,sha256:old.sha256||next.sha256,draft:old.draft||next.draft,
      drive_url:old.drive_url||next.drive_url,reference:old.reference||next.reference,
      reference_findings:old.reference_findings.length?old.reference_findings:next.reference_findings,
      draft_errors:old.draft_errors.length?old.draft_errors:next.draft_errors,
    }:next);
  }
  return [...merged.values()].sort((a,b)=>a.case_id.localeCompare(b.case_id));
}

export async function readStudyBBundle(archive:File,signal:AbortSignal) {
  const zip=new ZipReader(new BlobReader(archive));
  try {
    const entries=await filesIn(zip,signal);
    const rows=readConfiguration(await readText(entries,'Study_B_admin_import.json',signal));
    if(rows.length!==caseIds.length||entries.size!==1+rows.length)
      throw new Error('The Study B ZIP must contain its configuration and ten CT files.');
    const files:File[]=[];
    for(const row of rows){
      const filename=row.case_id+'.nii.gz';
      const entry=entries.get('images/'+filename);
      if(!entry||!row.draft.trim()||!row.size||row.size!==entry.uncompressedSize||!/^[a-f0-9]{64}$/.test(row.sha256))
        throw new Error('Check the CT, checksum and report for '+row.case_id+' in the Study B ZIP.');
      const blob=await scanBlob(archive,entry,signal);
      files.push(new File([blob],filename,{type:'application/gzip'}));
    }
    return {rows,files};
  } finally {await zip.close();}
}

import {driveFileId} from './restrictedDrive';
import type {CaseConfig} from './studyB';

export function isStudyBCaseUploaded(c:CaseConfig):boolean {
  return Boolean(driveFileId(c.drive_url)) && Number.isSafeInteger(c.size) && c.size>2 && c.size<2**31
    && /^[a-f0-9]{64}$/.test(c.sha256) && c.draft.trim().length>0;
}

export function studyBUploadCount(cases:readonly CaseConfig[]):number {
  return cases.filter(isStudyBCaseUploaded).length;
}

import {describe, expect, it} from 'vitest';
import {gzipSync, strToU8, zipSync, type Zippable} from 'fflate';
import {blankCase, type CaseConfig} from '../services/studyB';
import {caseIds} from '../services/studyBImport';
import {mergeStudyBCaseFiles, readStudyBBundle} from '../services/studyBBundle';

async function bundleFixture() {
  const entries: Zippable = {};
  const rows: CaseConfig[] = [];
  for (const id of caseIds) {
    const bytes = gzipSync(strToU8('Synthetic volume ' + id));
    const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
    const sha256 = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    rows.push({...blankCase(id), draft: 'Draft for ' + id, size: bytes.length, sha256});
    entries['images/' + id + '.nii.gz'] = [bytes, {level: 0}];
  }
  entries['Study_B_admin_import.json'] = strToU8(JSON.stringify({cases: rows}));
  return {entries, rows};
}

function readBundle(entries: Zippable) {
  const contents = Uint8Array.from(zipSync(entries)).buffer;
  return readStudyBBundle(new File([contents], 'study-b.zip'), new AbortController().signal);
}

describe('Study B admin batch import', () => {
  it('matches all ten CT files to case-specific drafts and preserves coordinator edits on repeated import', async () => {
    const {entries, rows} = await bundleFixture();
    const {rows: imported, files} = await readBundle(entries);
    expect(imported).toEqual(rows);
    expect(files.map(file => file.name)).toEqual(caseIds.map(id => id + '.nii.gz'));
    for (const [i, file] of files.entries()) {
      const bytes = await file.arrayBuffer();
      expect(bytes.byteLength).toBe(rows[i].size);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      expect(Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')).toBe(rows[i].sha256);
    }
    const b03 = {...rows[2], draft:'Coordinator-selected draft', drive_url:'https://drive.google.com/file/d/fixture/view',
      reference:'Independent report', reference_findings:[{id:'r1', description:'Left effusion'}],
      draft_errors:[{id:'e1', description:'Omission'}]};
    const merged = mergeStudyBCaseFiles([b03], imported);
    expect(merged.map(row => row.case_id)).toEqual(caseIds);
    expect(merged[2]).toEqual(b03);
    expect(merged.filter(row => row.case_id !== 'B03')).toEqual(rows.filter(row => row.case_id !== 'B03'));
    expect(mergeStudyBCaseFiles(merged, imported)).toEqual(merged);
  });

  it('rejects a bundle missing one CT or containing an unexpected extra CT', async () => {
    const {entries} = await bundleFixture();
    await expect(readBundle({...entries, 'images/B11.nii.gz':strToU8('extra')})).rejects.toThrow();
    delete entries['images/B08.nii.gz'];
    await expect(readBundle(entries)).rejects.toThrow();
  });

  it('rejects CT identity changes while retaining an existing reviewed case', () => {
    const prior = {...blankCase('B01'), sha256:'1'.repeat(64), size:72, reference:'Frozen reference text'};
    expect(() => mergeStudyBCaseFiles([prior], [{...prior, sha256:'0'.repeat(64)}])).toThrow('B01');
    expect(() => mergeStudyBCaseFiles([prior], [{...prior, size:73}])).toThrow('B01');
    expect(prior.reference).toBe('Frozen reference text');
  });
});

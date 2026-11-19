import { describe, expect, test } from 'vitest';
import { gzipSync, strToU8, zipSync, type Zippable } from 'fflate';
import { parseStudyPackets } from './studyPackets';

const rootCase = 'Case02', otherCase = 'Case01';
const order = [rootCase, otherCase];
const ids = ['model-a', 'model-b', 'model-c', 'model-d'];
// Two incompressible members keep the ZIP larger than the 65,557-byte EOCD search window.
const imageBytes = gzipSync(crypto.getRandomValues(new Uint8Array(48 * 1024)));
const letters = ['A', 'B', 'C', 'D'];
const buffer = (u: Uint8Array) => Uint8Array.from(u).buffer;

async function sha(b: Blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()));
  return Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
}

async function fixture(options: {duplicateModel?: boolean; invalidImage?: boolean; largeMember?: Uint8Array} = {}) {
  const reportFiles: Zippable = {'最佳报告.csv': strToU8('病例编号,备注\r\nCase02,"a, b"\r\nCase01,\r\n')};
  const key = ['reader,case,report,model'];
  for (const [position, id] of order.entries()) {
    const blocks = letters.map((letter, i) => {
      key.push(['Reader01', id, letter, ids[options.duplicateModel ? 0 : (i + position) % 4]].join(','));
      return '报告 ' + letter + '\n\n中文参考译文\n研究示例\n\n英文原文\nSynthetic ' + id + ' findings ' + letter + '.';
    });
    reportFiles['reports/' + id + '.txt'] = strToU8(id + '\n\n' + blocks.join('\n\n' + '━'.repeat(30) + '\n\n') + '\n');
  }
  const reader = new File([buffer(zipSync(reportFiles))], 'Reader01.zip');
  // Exercise the usual stored-NIfTI path as well as a recompressed entry.
  const z = zipSync({'Case01.nii.gz': [options.largeMember ?? imageBytes, {level: 0}], 'Case02.nii.gz': imageBytes});
  const images = new File([buffer(z)], 'Reader_Images.zip');
  const manifest = {cases: order.length, reports: order.length * 4, models: ids,
    reader_zips_sha256: {'Reader01.zip': await sha(reader)}, images_sha256: options.invalidImage ? '0'.repeat(64) : await sha(images)};
  const coordinator = new File([buffer(zipSync({
    'manifest.json': strToU8(JSON.stringify(manifest)), 'unblinding_key.csv': strToU8(key.join('\n') + '\n')
  }))], 'Coordinator_ONLY.zip');
  Object.defineProperty(images, 'arrayBuffer', {value: () => { throw Error('Tried to read the entire image archive at once'); }});
  return {coordinator, reader, images};
}

describe('shared reader packet import', () => {
  test('keeps the frozen case/letter order, the reports and exact original compressed NIfTI bytes', async () => {
    const packets = await parseStudyPackets(await fixture());
    expect(packets.cases.map(c => c.case_id)).toEqual(order);
    expect(packets.cases[0].reports.map(r => r.model_name)).toEqual(ids);
    expect(packets.cases[1].reports.map(r => r.model_name)).toEqual([...ids.slice(1), ids[0]]);
    for (const c of packets.cases) {
      expect(c.reports.map(r => r.letter)).toEqual(letters);
      expect(c.reports[2].text).toBe('Synthetic ' + c.case_id + ' findings C.');
      expect(c.size).toBe(imageBytes.length);
      const b = await packets.getImage(c.case_id);
      expect(new Uint8Array(await b.arrayBuffer())).toEqual(imageBytes);
      expect(await sha(b)).toBe(c.sha256);
      expect(c.part_sha256).toEqual([c.sha256]);
    }
    await expect(packets.getImage('unknown')).rejects.toThrow('Unknown study case');
  });
  test('rejects a reader packet from another export', async () => {
    const files = await fixture();
    files.reader = new File(['mismatch'], 'Reader01.zip');
    await expect(parseStudyPackets(files)).rejects.toThrow('Reader01.zip');
  });
  test('rejects a mislabeled image archive before returning cases', async () => {
    await expect(parseStudyPackets(await fixture({invalidImage: true}))).rejects.toThrow('image archive');
  });
  test('rejects a duplicate true model assigned to two slots', async () => {
    await expect(parseStudyPackets(await fixture({duplicateModel: true}))).rejects.toThrow('Repeated model');
  });
  test('provides exact multipart digests on 8 MiB boundaries', async () => {
    const partSize = 8 * 1024 * 1024;
    const largeMember = gzipSync(new Uint8Array(partSize + 17), {level: 0});
    const packets = await parseStudyPackets(await fixture({largeMember}));
    const b = await packets.getImage(otherCase);
    expect(packets.cases[1].part_sha256).toEqual([await sha(b.slice(0,partSize)), await sha(b.slice(partSize))]);
  });
});

import { BlobReader, BlobWriter, ZipReader, type FileEntry } from '@zip.js/zip.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

type Letter = 'A' | 'B' | 'C' | 'D';
export interface PacketCase {
  case_id: string;
  case_name: string;
  size: number;
  sha256: string;
  part_sha256: string[];
  reports: { letter: Letter; model_name: string; text: string }[];
}
export interface StudyPackets {
  cases: PacketCase[];
  getImage: (caseId: string) => Promise<Blob>;
}
export interface StudyPacketFiles {
  coordinator: File;
  reader: File;
  images: File;
}

const letters: Letter[] = ['A', 'B', 'C', 'D'];
const maxTextBytes = 2 * 1024 * 1024;
const readSize = 8 * 1024 * 1024;
const caseIdPattern = /^Case[0-9]{2,4}$/;
const shaPattern = /^[0-9a-f]{64}$/;
const opts = {useWebWorkers: false, checkSignature: true};

function requireThat(ok: unknown, error: string): asserts ok {
  if (!ok) throw new Error(error);
}

async function hashBlob(blob: Blob, signal?: AbortSignal, progress?: (percent: number) => void, partHashes?: string[]) {
  const hash = sha256.create();
  let lastPercent = -1;
  for (let start = 0; start < blob.size; start += readSize) {
    signal?.throwIfAborted();
    const end = Math.min(start + readSize, blob.size);
    const chunk = await blob.slice(start, end).arrayBuffer();
    hash.update(new Uint8Array(chunk));
    if (partHashes) partHashes.push(bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', chunk))));
    const percent = Math.floor(100 * end / blob.size);
    if (percent !== lastPercent) progress?.(percent);
    lastPercent = percent;
  }
  return bytesToHex(hash.digest());
}

async function filesIn(reader: ZipReader<Blob>, signal?: AbortSignal) {
  const files = new Map<string, FileEntry>();
  for await (const entry of reader.getEntriesGenerator()) {
    signal?.throwIfAborted();
    if (entry.directory) continue;
    requireThat(!entry.encrypted && !files.has(entry.filename), 'The ZIP contains duplicate or encrypted entries.');
    files.set(entry.filename, entry);
  }
  return files;
}

async function readText(files: Map<string, FileEntry>, name: string, signal?: AbortSignal) {
  const entry = files.get(name);
  requireThat(entry && entry.uncompressedSize > 0 && entry.uncompressedSize <= maxTextBytes, 'Missing or oversized packet entry: ' + name);
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let text = '', bytes = 0;
  await entry.getData(new WritableStream<Uint8Array>({
    write(data) {
      bytes += data.length;
      requireThat(bytes <= entry.uncompressedSize, 'Text size exceeds the ZIP directory entry.');
      text += decoder.decode(data, {stream: true});
    }
  }), {...opts, signal});
  requireThat(bytes === entry.uncompressedSize, 'Incomplete text entry: ' + name);
  return (text + decoder.decode()).replace(/\r\n/g, '\n');
}

// The packet builder writes CSV with ordinary quotes, including escaped quotes and multiline fields.
function csv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(field); field = ''; }
    else if (!quoted && c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  requireThat(!quoted, 'A CSV field is incomplete.');
  if (row.length || field) { row.push(field); rows.push(row); }
  return rows;
}

function parseManifest(raw: string) {
  const m = JSON.parse(raw);
  requireThat(m && Number.isSafeInteger(m.cases) && m.cases > 0 && m.reports === m.cases * 4, 'Expected four reports per case.');
  const models: unknown = m.models;
  requireThat(Array.isArray(models) && models.length === 4 && new Set(models).size === 4
    && models.every(x => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= 100), 'Expected four distinct model IDs.');
  const readerHash: unknown = m.reader_zips_sha256?.['Reader01.zip'];
  const imageHash: unknown = m.images_sha256;
  requireThat(typeof readerHash === 'string' && shaPattern.test(readerHash) && typeof imageHash === 'string' && shaPattern.test(imageHash),
    'The coordinator manifest is missing the Reader01 or image archive SHA-256.');
  return {count: Number(m.cases), models: new Set<string>(models), readerHash, imageHash};
}

async function readSharedReports(coordinator: Map<string, FileEntry>, reader: Map<string, FileEntry>, manifest: ReturnType<typeof parseManifest>, signal?: AbortSignal) {
  const [header, ...rows] = csv(await readText(coordinator, 'unblinding_key.csv', signal));
  const cols = ['reader', 'case', 'report', 'model'].map(n => header?.indexOf(n) ?? -1);
  requireThat(cols.every(i => i >= 0), 'Missing fields in the unblinding key.');
  const key = new Map<string, string>();
  for (const row of rows) {
    const [account, id, letter, model] = cols.map(i => row[i]);
    if (account !== 'Reader01') continue;
    const idx = id + '/' + letter;
    requireThat(caseIdPattern.test(id) && letters.includes(letter as Letter) && manifest.models.has(model) && !key.has(idx),
      'Invalid or duplicate Reader01 assignment.');
    key.set(idx, model);
  }
  requireThat(key.size === manifest.count * 4, 'Incomplete Reader01 unblinding key.');
  const [columns, ...orderRows] = csv(await readText(reader, '最佳报告.csv', signal));
  const caseIndex = columns?.indexOf('病例编号') ?? -1;
  const order = orderRows.map(row => row[caseIndex]);
  requireThat(caseIndex >= 0 && order.length === manifest.count && new Set(order).size === order.length
    && order.every(id => caseIdPattern.test(id)), 'The reader packet has an invalid blinded case order.');
  const result: Pick<PacketCase, 'case_id' | 'case_name' | 'reports'>[] = [];
  for (const id of order) {
    const raw = await readText(reader, 'reports/' + id + '.txt', signal);
    const prefix = id + '\n\n';
    requireThat(raw.startsWith(prefix), 'Mismatched report file for ' + id);
    const blocks = raw.slice(prefix.length).replace(/\n$/, '').split('\n\n' + '━'.repeat(30) + '\n\n');
    requireThat(blocks.length === 4, 'Expected four reports for ' + id);
    const reports = letters.map((letter, i) => {
      const title = '报告 ' + letter + '\n\n';
      const model = key.get(id + '/' + letter);
      requireThat(model && blocks[i].startsWith(title), 'Missing or mismatched report letter in ' + id);
      const text = blocks[i].slice(title.length);
      requireThat(text.startsWith('中文参考译文\n') && text.split('\n\n英文原文\n').length === 2, 'Expected bilingual report text in ' + id);
      return {letter, model_name: model, text};
    });
    requireThat(new Set(reports.map(r => r.model_name)).size === 4, 'Repeated model in ' + id);
    result.push({case_id: id, case_name: id, reports});
  }
  return result;
}

async function scanBlob(archive: File, entry: FileEntry, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  requireThat(entry.uncompressedSize >= 2 && entry.uncompressedSize <= 2 * 1024 ** 3, 'Unexpected size for ' + entry.filename);
  if (entry.compressionMethod === 0) {
    // The supplied image ZIP stores already gzipped NIfTI members verbatim. A Blob slice
    // keeps random access to the original File without allocating a full scan in JS.
    const header = new DataView(await archive.slice(entry.offset, entry.offset + 30).arrayBuffer());
    requireThat(header.byteLength === 30 && header.getUint32(0, true) === 0x04034b50 &&
      header.getUint16(8, true) === 0 && entry.uncompressedSize === entry.compressedSize,
      'Invalid stored ZIP entry.');
    const nameSize = header.getUint16(26, true);
    const nameStart = entry.offset + 30;
    const start = nameStart + nameSize + header.getUint16(28, true);
    const localName = await archive.slice(nameStart, nameStart + nameSize).text();
    requireThat(localName === entry.filename && start + entry.compressedSize <= archive.size, 'ZIP image entry does not match its header.');
    return archive.slice(start, start + entry.uncompressedSize, 'application/gzip');
  }
  requireThat(entry.compressionMethod === 8, 'Unsupported ZIP compression for ' + entry.filename);
  const data = await entry.getData(new BlobWriter('application/gzip'), {...opts, signal});
  requireThat(data.size === entry.uncompressedSize, 'Incomplete image entry.');
  return data;
}

export async function parseStudyPackets(files: StudyPacketFiles, progress?: (message: string) => void, signal?: AbortSignal): Promise<StudyPackets> {
  const coordinator = new ZipReader(new BlobReader(files.coordinator));
  const reader = new ZipReader(new BlobReader(files.reader));
  const images = new ZipReader(new BlobReader(files.images));
  try {
    const coordinatorFiles = await filesIn(coordinator, signal);
    const manifest = parseManifest(await readText(coordinatorFiles, 'manifest.json', signal));
    requireThat(await hashBlob(files.reader, signal) === manifest.readerHash, 'Select the unchanged Reader01.zip that belongs to this study.');
    const reports = await readSharedReports(coordinatorFiles, await filesIn(reader, signal), manifest, signal);
    const entries = await filesIn(images, signal);
    requireThat(entries.size === reports.length && reports.every(r => entries.has(r.case_id + '.nii.gz')), 'The image ZIP and report case sets differ.');
    requireThat(await hashBlob(files.images, signal, n => progress?.('Checking image archive · ' + n + '%')) === manifest.imageHash,
      'The image archive does not match the checksum in Coordinator_ONLY.zip.');
    const cases: PacketCase[] = [];
    for (const r of reports) {
      progress?.('Checking ' + r.case_id + ' · ' + (cases.length + 1) + ' / ' + reports.length);
      const data = await scanBlob(files.images, entries.get(r.case_id + '.nii.gz')!, signal);
      const marker = new Uint8Array(await data.slice(0, 2).arrayBuffer());
      requireThat(marker[0] === 31 && marker[1] === 139, 'Expected a gzipped NIfTI image for ' + r.case_id);
      const partHashes: string[] = [];
      const digest = await hashBlob(data, signal, undefined, partHashes);
      cases.push({...r, size: data.size, sha256: digest, part_sha256: partHashes});
    }
    return {cases, async getImage(id) {
      const entry = entries.get(id + '.nii.gz');
      requireThat(entry, 'Unknown study case.');
      return scanBlob(files.images, entry);
    }};
  } finally {
    await Promise.all([coordinator.close(), reader.close(), images.close()]);
  }
}

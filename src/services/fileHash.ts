import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex} from '@noble/hashes/utils.js';

export async function hashBlob(blob: Blob, signal?: AbortSignal, progress?: (percent: number) => void, partHashes?: string[]) {
  const hash = sha256.create();
  const readSize = 8 * 1024 * 1024;
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
  signal?.throwIfAborted();
  return bytesToHex(hash.digest());
}

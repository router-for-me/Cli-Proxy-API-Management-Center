import type { AuthFileItem } from '@/types/authFile';

type RecordLike = Record<string, unknown>;

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const readString = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value).trim();

const readAnyString = (entry: RecordLike, keys: string[]): string => {
  for (const key of keys) {
    const value = readString(entry[key]);
    if (value) return value;
  }
  return '';
};

const rightRotate = (value: number, bits: number): number =>
  (value >>> bits) | (value << (32 - bits));

export const stableAuthIndexFromSeed = (seed: string): string => {
  const trimmed = seed.trim();
  if (!trimmed) return '';

  const bytes = new TextEncoder().encode(trimmed);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;

  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ]);
  const words = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 =
        rightRotate(words[index - 15], 7) ^
        rightRotate(words[index - 15], 18) ^
        (words[index - 15] >>> 3);
      const s1 =
        rightRotate(words[index - 2], 17) ^
        rightRotate(words[index - 2], 19) ^
        (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return [hash[0], hash[1]].map((value) => value.toString(16).padStart(8, '0')).join('');
};

const isUsableSourceCandidate = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const lowered = trimmed.toLowerCase();
  if (lowered === 'file' || lowered === 'memory') return false;
  return lowered.endsWith('.json') || trimmed.includes('/') || trimmed.includes('\\');
};

const buildLegacyConfigSeed = (input: {
  providerKey: string;
  compatName?: string;
  baseURL?: string;
  proxyURL?: string;
  apiKey?: string;
  source?: string;
}) => {
  const providerKey = input.providerKey.trim().toLowerCase();
  if (!providerKey) return '';

  const parts = [`provider=${providerKey}`];
  if (input.compatName) parts.push(`compat=${input.compatName.trim().toLowerCase()}`);
  if (input.baseURL) parts.push(`base=${input.baseURL.trim()}`);
  if (input.proxyURL) parts.push(`proxy=${input.proxyURL.trim()}`);
  if (input.apiKey) parts.push(`api_key=${input.apiKey.trim()}`);
  if (input.source) parts.push(`source=${input.source.trim()}`);

  return parts.length > 1 ? `config:${parts.join('\x00')}` : '';
};

export const buildLegacyAuthIndexAliases = (entry: AuthFileItem): string[] => {
  const record = entry as RecordLike;
  const seeds = new Set<string>();
  const name = readAnyString(record, ['name']);
  const id = readAnyString(record, ['id']);
  const providerKey = readAnyString(record, ['provider_key', 'providerKey', 'provider', 'type']);
  const compatName = readAnyString(record, ['compat_name', 'compatName']);
  const baseURL = readAnyString(record, ['base_url', 'baseUrl', 'base-url']);
  const proxyURL = readAnyString(record, ['proxy_url', 'proxyUrl', 'proxy-url']);
  const apiKey = readAnyString(record, ['api_key', 'apiKey', 'api-key']);

  [name, id].forEach((value) => {
    if (value) seeds.add(`file:${value}`);
  });
  if (id) seeds.add(`id:${id}`);

  const sourceCandidates = [
    readAnyString(record, ['path']),
    readAnyString(record, ['source']),
    readAnyString(record, ['file']),
  ].filter(isUsableSourceCandidate);

  sourceCandidates.forEach((source) => {
    const seed = buildLegacyConfigSeed({
      providerKey,
      compatName,
      baseURL,
      proxyURL,
      apiKey,
      source,
    });
    if (seed) seeds.add(seed);
  });

  if (apiKey || baseURL || proxyURL || compatName) {
    const seed = buildLegacyConfigSeed({
      providerKey,
      compatName,
      baseURL,
      proxyURL,
      apiKey,
    });
    if (seed) seeds.add(seed);
  }

  return Array.from(seeds)
    .map(stableAuthIndexFromSeed)
    .filter(Boolean);
};

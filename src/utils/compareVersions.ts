const versionPattern = /^v?(\d+(?:\.\d+)*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;

const parseVersion = (version?: string | null) => {
  const match = version?.trim().match(versionPattern);
  if (!match) return null;
  return {
    core: match[1].split('.').map(BigInt),
    // Accept compact release candidates (rc10) as well as dotted ones (rc.10).
    prerelease: match[2]?.replace(/^rc(\d+)(?=\.|$)/, 'rc.$1').split('.'),
  };
};

export const compareVersions = (latest?: string | null, current?: string | null) => {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const left = a.core[i] ?? 0n;
    const right = b.core[i] ?? 0n;
    if (left !== right) return left > right ? 1 : -1;
  }

  if (!a.prerelease) return b.prerelease ? 1 : 0;
  if (!b.prerelease) return -1;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    if (!leftNumeric) return left > right ? 1 : -1;
    const diff = BigInt(left) - BigInt(right);
    if (diff !== 0n) return diff > 0n ? 1 : -1;
  }
  return 0;
};

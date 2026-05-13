import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_INVISIBLE_CODE_POINTS = new Set([
  0x200b,
  0x200c,
  0x200d,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2060,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0xfeff,
]);

const DEFAULT_CHANGED_FILES_BASE = 'origin/main...HEAD';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const toLineColumn = (text, index) => {
  const prior = text.slice(0, index);
  const lines = prior.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
};

const findForbiddenUnicode = (text) => {
  const hits = [];

  for (let index = 0; index < text.length; index += 1) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) continue;

    if (!FORBIDDEN_INVISIBLE_CODE_POINTS.has(codePoint)) {
      if (codePoint > 0xffff) index += 1;
      continue;
    }

    const char = String.fromCodePoint(codePoint);
    const formattedCodePoint = codePoint.toString(16).toUpperCase().padStart(4, '0');
    const { line, column } = toLineColumn(text, index);
    hits.push({ char, codePoint: formattedCodePoint, line, column });

    if (codePoint > 0xffff) index += 1;
  }

  return hits;
};

const isChangedTextPath = (relativePath) => {
  const absolutePath = path.resolve(repoRoot, relativePath);
  if (!existsSync(absolutePath)) return false;

  try {
    const fileBuffer = readFileSync(absolutePath);
    return !fileBuffer.includes(0);
  } catch {
    return false;
  }
};

const getChangedFilesBase = () =>
  process.env.CPA_MANAGER_CHANGED_FILES_BASE?.trim() || DEFAULT_CHANGED_FILES_BASE;

const hasGitDiffBase = (diffBase) => {
  const refs = diffBase.split('...');
  if (refs.length === 0 || refs.some((ref) => ref.trim() === '')) return false;

  return refs.every((ref) => {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref.trim()], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  });
};

const listChangedTextFiles = (changedFilesOutput, diffBase = getChangedFilesBase()) => {
  const output = changedFilesOutput ?? (() => {
    if (!hasGitDiffBase(diffBase)) {
      throw new Error(`Changed-file diff base is unavailable: ${diffBase}`);
    }

    return execFileSync('git', ['diff', '--name-only', diffBase], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  })();

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isChangedTextPath);
};

describe('repo source integrity', () => {
  it('uses the merge-base PR diff range for changed-file scanning', () => {
    expect(DEFAULT_CHANGED_FILES_BASE).toBe('origin/main...HEAD');
  });

  it('detects bidi override and zero-width characters', () => {
    const source = `safe\u202Etext and hidden\u200Bspace`;

    const hits = findForbiddenUnicode(source);

    expect(hits.map((hit) => hit.codePoint)).toEqual(['202E', '200B']);
  });

  it('keeps changed text files free of hidden control unicode', () => {
    const changedTextFiles = listChangedTextFiles();

    const violations = changedTextFiles.flatMap((relativePath) => {
      const absolutePath = path.resolve(repoRoot, relativePath);
      const fileText = readFileSync(absolutePath, 'utf8');
      const hits = findForbiddenUnicode(fileText);

      return hits.map(
        (hit) => `${relativePath}:${hit.line}:${hit.column} contains U+${hit.codePoint} (${JSON.stringify(hit.char)})`
      );
    });

    expect(violations).toEqual([]);
  }, 15_000);

  it('allows an empty changed-file list after the PR branch is merged', () => {
    expect(listChangedTextFiles('')).toEqual([]);
  });

  it('fails closed when the diff base is unavailable', () => {
    expect(() => listChangedTextFiles(undefined, 'missing-base-ref...HEAD')).toThrow(
      'Changed-file diff base is unavailable'
    );
  });

  it('scans changed markdown and shell files when they are text files', () => {
    const changedTextFiles = listChangedTextFiles([
      'tests/repoSourceIntegrity.test.mjs',
      'package.json',
      'README.md',
      'bin/release/package-native.sh',
      'missing-file.md',
      '',
    ].join('\n'));

    expect(changedTextFiles).toContain('tests/repoSourceIntegrity.test.mjs');
    expect(changedTextFiles).toContain('package.json');
    expect(changedTextFiles).toContain('README.md');
    expect(changedTextFiles).toContain('bin/release/package-native.sh');
    expect(changedTextFiles).not.toContain('missing-file.md');
  });
});

import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});
test('installed job script sends exact JSON and keeps the bearer out of argv', () => {
  root = mkdtempSync('/dev/shm/prox-job-script-');
  const key = 'synthetic-private-job-key-$"x';
  const config = join(root, '.config/proxd');
  const bin = join(root, 'bin');
  mkdirSync(config, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(config, 'management-key'), `${key}\n`, { mode: 0o600 });
  symlinkSync(resolve(import.meta.dir, 'fixtures/usage-job-curl.sh'), join(bin, 'curl'));
  const run = Bun.spawnSync(
    ['/bin/sh', resolve(import.meta.dir, '../deploy/prox-usage-job.sh'), 'prune'],
    {
      env: { ...process.env, HOME: root, JOB_TEST_ROOT: root, PATH: `${bin}:${process.env.PATH}` },
    }
  );
  expect(run.exitCode).toBe(0);
  const argv = readFileSync(join(root, 'argv'), 'utf8').trimEnd().split('\n');
  expect(argv[argv.indexOf('--data') + 1]).toBe('{"kind":"prune"}');
  expect(argv.join('\n')).not.toContain(key);
  expect(argv[argv.indexOf('--header') + 1]).toBe('@-');
  expect(argv[argv.length - 1]).toBe('http://127.0.0.1:18320/v1/jobs');
  expect(readFileSync(join(root, 'headers'), 'utf8')).toBe(`Authorization: Bearer ${key}\n`);
});

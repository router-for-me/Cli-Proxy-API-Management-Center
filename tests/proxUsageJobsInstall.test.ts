import { afterEach, expect, test } from 'bun:test';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from '../scripts/usage-parity';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const temp = () => {
  const root = mkdtempSync('/dev/shm/prox-usage-jobs-');
  roots.push(root);
  return root;
};
const INSTALLED = '%h/.local/share/prox/usage-jobs';
const deploy = readFileSync('scripts/deploy-homelab.sh', 'utf8');

test('usage units run the installed artefacts, never a mutable checkout', () => {
  for (const [file, artefact] of [
    ['deploy/prox-usage-nightly.service', 'usage-nightly.js'],
    ['deploy/prox-usage-parity.service', 'usage-parity.js'],
  ] as const) {
    const unit = readFileSync(file, 'utf8');
    expect(unit).not.toContain('src/prox');
    const execStart = unit.split('\n').find((line) => line.startsWith('ExecStart='))!;
    expect(execStart).toContain(`bun ${INSTALLED}/${artefact}`);
    expect(unit).toContain(`WorkingDirectory=${INSTALLED}`);
    // Evidence belongs under the data directory, not in the (replaceable) install directory.
    expect(unit).toContain('Environment=PROX_USAGE_EVIDENCE_DIR=%h/.local/share/prox/usage-evidence');
  }
});

test('the build step bundles every entry point and verify covers it', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
  expect(pkg['build:usage-jobs']).toContain('./scripts/usage-nightly.ts');
  expect(pkg['build:usage-jobs']).toContain('./scripts/usage-parity.ts');
  expect(pkg['build:usage-jobs']).toContain('./scripts/usage-restore-check.ts');
  expect(pkg['build:usage-jobs']).toContain('--target=bun');
  expect(pkg.build).toContain('bun run build:usage-jobs');
  expect(pkg.verify).toContain('bun run build');
});

test('deploy installs the artefacts atomically before daemon-reload', () => {
  const install = deploy.indexOf('# Install the self-contained usage job bundles');
  const reload = deploy.indexOf('systemctl --user daemon-reload');
  const verify = deploy.indexOf('bun run verify');
  expect(verify).toBeGreaterThan(-1);
  expect(install).toBeGreaterThan(verify);
  expect(reload).toBeGreaterThan(install);
  expect(deploy.indexOf('install -D -m 644 deploy/prox-usage-nightly.service')).toBeGreaterThan(
    install
  );
  expect(deploy).not.toContain('src/prox');
});

function runInstallBlock(root: string, dist: Record<string, string>) {
  const start = deploy.indexOf('# Install the self-contained usage job bundles');
  const end = deploy.indexOf('# Fail the deploy now');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'dist/usage-jobs'), { recursive: true });
  for (const [name, text] of Object.entries(dist))
    writeFileSync(join(repo, 'dist/usage-jobs', name), text);
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const result = Bun.spawnSync(
    ['bash', '-euo', 'pipefail', '-c', deploy.slice(start, end)],
    { cwd: repo, env: { PATH: process.env.PATH!, HOME: home } }
  );
  return { result, dir: join(home, '.local/share/prox/usage-jobs') };
}

test('the install block replaces artefacts by rename and leaves no temp files', () => {
  const root = temp();
  const set = (version: string) => ({
    'usage-nightly.js': `nightly ${version}`,
    'usage-parity.js': `parity ${version}`,
    'usage-restore-check.js': `restore ${version}`,
  });
  const first = runInstallBlock(root, set('v1'));
  expect(first.result.exitCode).toBe(0);
  expect(readFileSync(join(first.dir, 'usage-nightly.js'), 'utf8')).toBe('nightly v1');
  expect(readFileSync(join(first.dir, 'usage-parity.js'), 'utf8')).toBe('parity v1');
  expect(readFileSync(join(first.dir, 'usage-restore-check.js'), 'utf8')).toBe('restore v1');
  // Redeploy over the existing files.
  const second = runInstallBlock(root, set('v2'));
  expect(second.result.exitCode).toBe(0);
  expect(readFileSync(join(second.dir, 'usage-nightly.js'), 'utf8')).toBe('nightly v2');
  expect(readFileSync(join(second.dir, 'usage-parity.js'), 'utf8')).toBe('parity v2');
  expect(readFileSync(join(second.dir, 'usage-restore-check.js'), 'utf8')).toBe('restore v2');
  expect(readdirSync(second.dir).sort()).toEqual([
    'usage-nightly.js',
    'usage-parity.js',
    'usage-restore-check.js',
  ]);
});

test('a missing bundle fails the install instead of shipping a half set', () => {
  const root = temp();
  const run = runInstallBlock(root, { 'usage-nightly.js': 'nightly only' });
  expect(run.result.exitCode).not.toBe(0);
  expect(existsSync(join(run.dir, 'usage-nightly.js'))).toBe(false);
});

test('built nightly artefact resolves the parity artefact from its own directory', () => {
  const root = temp();
  const dist = join(root, 'dist');
  const built = Bun.spawnSync([
    'bun',
    'build',
    './scripts/usage-nightly.ts',
    './scripts/usage-parity.ts',
    '--target=bun',
    '--outdir',
    dist,
    '--entry-naming',
    '[name].js',
  ]);
  expect(built.exitCode).toBe(0);
  const installed = join(root, 'installed');
  mkdirSync(installed);
  for (const name of ['usage-nightly.js', 'usage-parity.js'])
    copyFileSync(join(dist, name), join(installed, name));
  // A different cwd and an empty HOME: nothing may be found relative to either.
  const cwd = join(root, 'elsewhere');
  mkdirSync(cwd);
  const run = (nightly: string) =>
    Bun.spawnSync([process.execPath, nightly, '--check-install'], {
      cwd,
      env: { PATH: process.env.PATH!, HOME: root },
    });
  const ok = run(join(installed, 'usage-nightly.js'));
  expect(ok.stderr.toString()).toBe('');
  expect(ok.exitCode).toBe(0);
  expect(JSON.parse(ok.stdout.toString())).toEqual({
    parity: join(installed, 'usage-parity.js'),
    ok: true,
  });
  rmSync(join(installed, 'usage-parity.js'));
  const missing = run(join(installed, 'usage-nightly.js'));
  expect(missing.exitCode).toBe(1);
});

test('parity evidence defaults to an absolute configurable directory', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  const previous = process.env.PROX_USAGE_EVIDENCE_DIR;
  try {
    process.env.PROX_USAGE_EVIDENCE_DIR = '/tmp/prox-evidence-test';
    const options = parseArgs(['--previous-utc-day'], now);
    expect(options.output.startsWith('/tmp/prox-evidence-test/')).toBe(true);
    expect(options.output.endsWith('-quick')).toBe(true);
    delete process.env.PROX_USAGE_EVIDENCE_DIR;
    expect(parseArgs(['--previous-utc-day'], now).output).toBe(
      join(process.cwd(), 'docs/evidence/prox-usage-parity', options.output.split('/').pop()!)
    );
  } finally {
    if (previous === undefined) delete process.env.PROX_USAGE_EVIDENCE_DIR;
    else process.env.PROX_USAGE_EVIDENCE_DIR = previous;
  }
});

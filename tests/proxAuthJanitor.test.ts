import { afterEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const scriptPath = join(root, 'deploy/prox-auth-janitor.sh');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const MINUTE_S = 60;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function authDir() {
  const dir = mkdtempSync(join(tmpdir(), 'prox-janitor-test-'));
  dirs.push(dir);
  return dir;
}
function write(dir: string, name: string, minutesAgo = 0, content = 'synthetic') {
  const path = join(dir, name);
  writeFileSync(path, content);
  const at = Date.now() / 1000 - minutesAgo * MINUTE_S;
  utimesSync(path, at, at);
  return path;
}
function run(dirsToClean: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(['bash', scriptPath, ...dirsToClean], {
    env: { ...process.env, ...env },
  });
  return {
    code: result.exitCode,
    out: result.stdout.toString(),
    err: result.stderr.toString(),
  };
}

describe('prox auth janitor script', () => {
  test('removes an old orphan lock and reports its basename', () => {
    const dir = authDir();
    const lock = write(dir, 'gone.json.lock', 11);
    const result = run([dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('gone.json.lock\n');
    expect(existsSync(lock)).toBe(false);
  });

  test('keeps a fresh orphan lock', () => {
    const dir = authDir();
    const lock = write(dir, 'writing.json.lock', 0);
    const result = run([dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('');
    expect(existsSync(lock)).toBe(true);
  });

  test('keeps an old lock that still has its json', () => {
    const dir = authDir();
    write(dir, 'live.json', 30);
    const lock = write(dir, 'live.json.lock', 30);
    const result = run([dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('');
    expect(existsSync(lock)).toBe(true);
  });

  test('never touches json files', () => {
    const dir = authDir();
    const live = write(dir, 'live.json', 60, '{"a":1}');
    write(dir, 'live.json.lock', 60);
    const lonely = write(dir, 'lonely.json', 60, '{"b":2}');
    write(dir, 'orphan.json.lock', 60);
    const before = [live, lonely].map((path) => statSync(path).mtimeMs);
    expect(run([dir]).code).toBe(0);
    expect(readFileSync(live, 'utf8')).toBe('{"a":1}');
    expect(readFileSync(lonely, 'utf8')).toBe('{"b":2}');
    expect([live, lonely].map((path) => statSync(path).mtimeMs)).toEqual(before);
  });

  test('keeps non-lock files and locks not named json.lock', () => {
    const dir = authDir();
    const kept = [
      write(dir, 'notes.txt', 60),
      write(dir, 'x.lock', 60),
      write(dir, 'x.json.lock.bak', 60),
      write(dir, 'x.json.lockx', 60),
    ];
    const result = run([dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('');
    for (const path of kept) expect(existsSync(path)).toBe(true);
  });

  test('skips a missing directory without failing', () => {
    const dir = authDir();
    const lock = write(dir, 'gone.json.lock', 60);
    const result = run([join(dir, 'does-not-exist'), dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('gone.json.lock\n');
    expect(existsSync(lock)).toBe(false);
    expect(run([join(dir, 'does-not-exist')]).code).toBe(0);
  });

  test('cleans every directory given', () => {
    const [a, b] = [authDir(), authDir()];
    const locks = [write(a, 'a.json.lock', 60), write(b, 'b.json.lock', 60)];
    const result = run([a, b]);
    expect(result.code).toBe(0);
    expect(result.out.split('\n').sort()).toEqual(['', 'a.json.lock', 'b.json.lock']);
    for (const lock of locks) expect(existsSync(lock)).toBe(false);
  });

  test('a directory that cannot be scanned does not stop the next one', () => {
    const [a, b] = [authDir(), authDir()];
    const lock = write(b, 'b.json.lock', 60);
    chmodSync(a, 0o300); // enterable but not listable: find exits non-zero
    try {
      const result = run([a, b]);
      expect(result.out).toBe('b.json.lock\n');
      expect(existsSync(lock)).toBe(false);
    } finally {
      chmodSync(a, 0o700);
    }
  });

  test('a directory it cannot enter is skipped, never cleaned from the working directory', () => {
    const [blocked, cwd, next] = [authDir(), authDir(), authDir()];
    const bystander = write(cwd, 'x.json.lock', 60);
    const lock = write(next, 'n.json.lock', 60);
    chmodSync(blocked, 0o600); // no execute bit: cd fails
    try {
      const result = Bun.spawnSync(['bash', scriptPath, blocked, next], { cwd });
      expect(result.stdout.toString()).toBe('n.json.lock\n');
      expect(existsSync(bystander)).toBe(true);
      expect(existsSync(lock)).toBe(false);
    } finally {
      chmodSync(blocked, 0o700);
    }
  });

  test('handles names with spaces and leading dashes', () => {
    const dir = authDir();
    const spaced = write(dir, 'my account.json.lock', 60);
    const dashed = write(dir, '-rf.json.lock', 60);
    const spacedLive = write(dir, 'kept one.json.lock', 60);
    write(dir, 'kept one.json', 60);
    const result = run([dir]);
    expect(result.code).toBe(0);
    expect(result.out.split('\n').sort()).toEqual(['', '-rf.json.lock', 'my account.json.lock']);
    expect(existsSync(spaced)).toBe(false);
    expect(existsSync(dashed)).toBe(false);
    expect(existsSync(spacedLive)).toBe(true);
  });

  test('does not recurse into subdirectories', () => {
    const dir = authDir();
    const nested = join(dir, 'sub');
    mkdirSync(nested);
    const lock = write(nested, 'deep.json.lock', 60);
    expect(run([dir]).code).toBe(0);
    expect(existsSync(lock)).toBe(true);
  });

  test('keeps a symlink named like a lock and does not touch its target', () => {
    const dir = authDir();
    const outside = authDir();
    const target = write(outside, 'target.txt', 60, 'precious');
    const link = join(dir, 'link.json.lock');
    symlinkSync(target, link);
    const result = run([dir]);
    expect(result.code).toBe(0);
    expect(result.out).toBe('');
    expect(readFileSync(target, 'utf8')).toBe('precious');
    expect(existsSync(link)).toBe(true);
  });

  test('honours PROX_JANITOR_MIN_AGE_MINUTES and rejects a non-numeric value', () => {
    const dir = authDir();
    const lock = write(dir, 'age.json.lock', 3);
    expect(run([dir]).out).toBe('');
    expect(existsSync(lock)).toBe(true);
    expect(run([dir], { PROX_JANITOR_MIN_AGE_MINUTES: '2' }).out).toBe('age.json.lock\n');
    expect(existsSync(lock)).toBe(false);
    expect(run([dir], { PROX_JANITOR_MIN_AGE_MINUTES: 'soon' }).code).not.toBe(0);
  });
});

describe('prox auth janitor deployment files', () => {
  const installPath = '.local/share/prox/prox-auth-janitor.sh';
  const deploy = read('scripts/deploy-homelab.sh');

  test('service runs the script at the path the deploy script installs to', () => {
    const service = read('deploy/prox-auth-janitor.service');
    expect(service).toContain('Type=oneshot');
    expect(service).toContain(`ExecStart=%h/${installPath}`);
    // A start limit would leave the unit failed and skip cleanups.
    expect(service).toMatch(/^StartLimitIntervalSec=0$/m);
    expect(service).not.toContain('StartLimitBurst');
    expect(deploy).toContain(`deploy/prox-auth-janitor.sh "$HOME/${installPath}"`);
    expect(deploy).toContain(`install -D -m 755 deploy/prox-auth-janitor.sh`);
  });

  test('no path watcher ships: the proxy rewrites the auth directories on nearly every request', () => {
    expect(existsSync(join(root, 'deploy/prox-auth-janitor.path'))).toBe(false);
    expect(deploy).not.toContain('install -D -m 644 deploy/prox-auth-janitor.path');
    expect(deploy).not.toContain('enable --now prox-auth-janitor.path');
  });

  test('timer runs the service every 10 minutes, matching the minimum lock age', () => {
    const timer = read('deploy/prox-auth-janitor.timer');
    expect(timer).toContain('OnBootSec=2min');
    expect(timer).toContain('OnUnitActiveSec=10min');
    expect(timer).toContain('Unit=prox-auth-janitor.service');
    expect(timer).toContain('WantedBy=timers.target');
  });

  test('with no arguments it cleans the codex, claude and gemini ProxD auth directories', () => {
    const home = authDir();
    const locks = ['codex', 'claude', 'gemini'].map((instance) => {
      const dir = join(home, '.local/share/proxd', instance, 'auth');
      mkdirSync(dir, { recursive: true });
      return write(dir, `${instance}-gone.json.lock`, 11);
    });
    const result = run([], { HOME: home });
    expect(result.code).toBe(0);
    expect(result.out.split('\n').filter(Boolean).sort()).toEqual([
      'claude-gone.json.lock',
      'codex-gone.json.lock',
      'gemini-gone.json.lock',
    ]);
    for (const lock of locks) expect(existsSync(lock)).toBe(false);
  });

  test('units describe ProxD, not the old hub name', () => {
    for (const unit of ['service', 'timer']) {
      const text = read(`deploy/prox-auth-janitor.${unit}`);
      expect(text).toContain('ProxD');
      expect(text).not.toMatch(/CLI-?Proxy/i);
    }
  });

  test('deploy script installs the script, service and timer and enables the timer', () => {
    for (const unit of ['service', 'timer']) {
      expect(deploy).toContain(
        `install -D -m 644 deploy/prox-auth-janitor.${unit} ` +
          `"$HOME/.config/systemd/user/prox-auth-janitor.${unit}"`
      );
    }
    expect(deploy).toContain('systemctl --user enable --now prox-auth-janitor.timer');
    const lastInstall = deploy.lastIndexOf('install -D -m 644 deploy/prox-auth-janitor.timer');
    expect(lastInstall).toBeGreaterThan(-1);
    expect(lastInstall).toBeLessThan(deploy.indexOf('systemctl --user daemon-reload'));
    expect(deploy.indexOf('systemctl --user daemon-reload')).toBeLessThan(
      deploy.indexOf('systemctl --user enable --now prox-auth-janitor.timer')
    );
    expect(deploy.match(/systemctl --user daemon-reload/g)).toHaveLength(1);
    expect(deploy).not.toMatch(/restart (prox-auth-janitor|cli-proxy)/);
  });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { UsageCollector } from '../server/usage/collector';
import type { CollectorWriter, IngestGap, UsagePayload } from '../server/usage/writerProtocol';
import { usagePayload } from './fixtures/usagePayloads';
import { eventually, fakeUsageProxy, FakeUsageClock } from './helpers/usageFakeProxy';
import { CredentialLabels } from '../server/usage/labels';
import { RespDecoder, encodeCommand } from '../server/usage/resp';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function setup() {
  const proxy = await fakeUsageProxy();
  cleanup.push(() => proxy.close());
  const clock = new FakeUsageClock();
  const items: UsagePayload[] = [];
  const gaps: IngestGap[] = [];
  const beats: number[] = [];
  const pressure = { backlog: 0 };
  let cursor: import('../server/usage/writerProtocol').UsageCursor | null = null;
  const writer: CollectorWriter = {
    get backlog() {
      return pressure.backlog;
    },
    recovery: async () => {},
    resume: async () => ({ cursor, heartbeat: null }),
    replay: async (_instance, payloads, next, gap) => {
      items.push(...payloads);
      cursor = next;
      if (gap) gaps.push(gap);
    },
    enqueue: (item) => {
      if (item.cursor) cursor = item.cursor;
      items.push(item);
    },
    gap: async (gap) => {
      gaps.push(gap);
    },
    heartbeat: async (_instance, at) => {
      beats.push(at);
    },
  };
  const collector = new UsageCollector(
    {
      instanceId: 'test-proxy',
      label: 'Test',
      aliases: [],
      publicBasePath: '',
      authScope: 'test',
      upstreamOrigin: proxy.origin,
      managementKeyFile: '/synthetic-key',
    },
    writer,
    { clock, readKey: async () => 'synthetic-key' }
  );
  cleanup.push(() => collector.stop());
  return { proxy, collector, writer, pressure, items, gaps, beats, clock };
}

async function ready(env: Awaited<ReturnType<typeof setup>>) {
  env.collector.start();
  await eventually(() => env.collector.status.drainRequests > 0);
}

describe('usage collector with an in-process proxy', () => {
  test('subscribes before non-destructive replay and keeps label snapshots', async () => {
    const env = await setup();
    env.proxy.emit(usagePayload());
    await ready(env);
    await eventually(() => env.collector.status.drainRequests === 1);
    expect(env.proxy.log.slice(0, 3)).toEqual(['AUTH', 'SUBSCRIBE', 'credentials']);
    expect(env.proxy.log.indexOf('SUBSCRIBE')).toBeLessThan(env.proxy.log.indexOf('replay'));
    expect(env.items).toHaveLength(1);
    expect(env.items[0].ingest).toBe(3);
    expect(env.items[0].label).toEqual({
      label: 'Test account',
      account: 'test@example.test',
      file: 'test-account.json',
      provider: '',
      project: '',
    });
    env.proxy.emit(usagePayload({ execution_id: 'live-event' }));
    await eventually(() => env.items.length === 2);
    expect(env.items[1].ingest).toBe(0);
    expect(env.collector.status.lastEventAtMs).toBe(env.clock.now());
  });

  test('reconnects at 1, 2, 4 seconds, capped at 30 seconds without false gaps', async () => {
    const env = await setup();
    await ready(env);
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const auths = env.proxy.log.filter((x) => x === 'AUTH').length;
      env.proxy.drop();
      await eventually(() => env.collector.status.state === 'backoff');
      expect(env.collector.status.retryAtMs).toBe(env.clock.now() + delay);
      await env.clock.advance(delay - 1);
      expect(env.proxy.log.filter((x) => x === 'AUTH')).toHaveLength(auths);
      await env.clock.advance(1);
      await eventually(() => env.collector.status.state === 'subscribed');
      await eventually(() => env.collector.status.drainRequests > auths);
    }
    expect(env.collector.status.reconnects).toBe(7);
    expect(env.gaps).toHaveLength(0);
  });

  test('reads events until UNSUBSCRIBE ack and does not finish shutdown early', async () => {
    const env = await setup();
    await ready(env);
    env.proxy.holdUnsubscribe = true;
    let stopped = false;
    const stop = env.collector.stop().then(() => {
      stopped = true;
    });
    await eventually(() => env.proxy.log.includes('UNSUBSCRIBE'));
    env.proxy.emit(usagePayload({ execution_id: 'before-ack' }));
    await eventually(() => env.items.length === 1);
    expect(stopped).toBe(false);
    env.proxy.ackUnsubscribe();
    await stop;
    expect(env.items).toHaveLength(1);
    expect(env.collector.status.state).toBe('stopped');
  });

  test('drops a subscription above 50,000 queued payloads and pauses for replay', async () => {
    const env = await setup();
    await ready(env);
    env.pressure.backlog = 50_001;
    env.proxy.emit(usagePayload());
    await eventually(() => env.collector.status.state === 'backoff');
    await env.clock.advance(1000);
    await eventually(() => env.collector.status.state === 'paused');
    expect(env.proxy.log.filter((x) => x === 'AUTH')).toHaveLength(1);
    env.pressure.backlog = 0;
    await env.clock.advance(1000);
    await eventually(() => env.collector.status.state === 'subscribed');
  });

  test('AUTH failure makes no HTTP calls and waits at least 60 seconds', async () => {
    const env = await setup();
    env.proxy.authFailures = 1;
    env.collector.start();
    await eventually(() => env.collector.status.state === 'auth-error');
    expect(env.proxy.log).toEqual(['AUTH']);
    await env.clock.advance(59_999);
    expect(env.proxy.log).toEqual(['AUTH']);
    await env.clock.advance(1);
    await eventually(() => env.collector.status.state === 'subscribed');
    expect(env.proxy.log.filter((x) => x === 'AUTH')).toHaveLength(2);
  });

  test('HTTP auth failure also closes the socket and prevents retry/label storms', async () => {
    const env = await setup();
    env.proxy.httpAuthFailures = 1;
    env.collector.start();
    await eventually(() => env.collector.status.state === 'auth-error');
    expect(env.proxy.log).toEqual(['AUTH', 'SUBSCRIBE', 'credentials']);
    await env.clock.advance(59_999);
    expect(env.proxy.log).toHaveLength(3);
    await env.clock.advance(1);
    await eventually(() => env.collector.status.drainRequests > 0);
  });

  test('pings at 30s, detects 40s silence and persists a 10s heartbeat', async () => {
    const env = await setup();
    env.proxy.pong = false;
    env.writer.heartbeat = async (_instance, at) => {
      env.beats.push(at);
      await new Promise<void>(() => {}); // Disk is stalled; keepalive must stay independent.
    };
    await ready(env);
    await env.clock.advance(10_000);
    await eventually(() => env.beats.length === 1);
    await env.clock.advance(20_000);
    await eventually(() => env.proxy.log.includes('PING'));
    await env.clock.advance(9999);
    expect(env.collector.status.state).toBe('subscribed');
    await env.clock.advance(1001);
    await eventually(() => env.collector.status.state === 'backoff');
    expect(env.gaps).toHaveLength(0);
  });

  test('refresh control reloads labels; support_refresh is ignored', async () => {
    const env = await setup();
    await ready(env);
    env.proxy.credentials.files[0].label = 'New label';
    env.proxy.emit({ support_refresh: true });
    env.proxy.emit({ refresh: true });
    await eventually(() => env.proxy.log.filter((x) => x === 'credentials').length === 2);
    await Bun.sleep(5);
    env.proxy.emit(usagePayload());
    await eventually(() => env.items.length === 1);
    expect(env.items[0].label?.label).toBe('New label');
  });
});

test('labels refresh every 5m, unknown indices at most once per 10s; API keys never become accounts', async () => {
  let now = 1000;
  let calls = 0;
  const labels = new CredentialLabels(
    async () => {
      calls += 1;
      return {
        files: [
          { auth_index: '3', account_type: 'api_key', account: 'SYNTHETIC-SECRET', label: 'Safe' },
        ],
      };
    },
    () => now
  );
  await labels.refresh();
  await labels.refresh();
  expect(calls).toBe(1);
  expect(labels.labelFor('3')?.account).toBe('Safe');
  await labels.unknown('missing');
  await labels.unknown('other');
  expect(calls).toBe(2);
  now += 10_000;
  await labels.unknown('other');
  expect(calls).toBe(3);
  now += 300_000;
  await labels.refresh();
  expect(calls).toBe(4);
});

test('RESP parser retains split UTF-8 bytes and multiple frames', () => {
  const decoder = new RespDecoder();
  const frames: unknown[] = [];
  const bytes = Buffer.from(encodeCommand('AUTH', 'é') + '+OK\r\n');
  for (const byte of bytes) decoder.feed(new Uint8Array([byte]), (value) => frames.push(value));
  expect(frames).toEqual([['AUTH', 'é'], 'OK']);
  expect(() => decoder.feed(Buffer.from('$999999999\r\n'), () => {})).toThrow();
});

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnalyticsHandler } from '../server/analytics/handler';
import { dashboardAnalyticsQuery } from '../src/features/dashboard/analyticsTraffic';
import {
  validateSourceManifest,
  publicSourceDiscovery,
} from '../src/domain/providerSources/manifest';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'prox-analytics-'));
  const keyFile = join(directory, 'key');
  writeFileSync(keyFile, 'synthetic-view-key');
  const manifest = validateSourceManifest({
    schemaVersion: 1,
    defaultInstanceId: 'alpha',
    history: { upstreamOrigin: 'http://history.test', managementKeyFile: keyFile },
    analytics: {
      upstreamOrigin: 'http://cpa.test',
      adminKeyFile: '/private/cpa',
      dataset: 'homelab',
    },
    sources: ['alpha', 'beta'].map((id) => ({
      instanceId: id,
      label: id,
      publicBasePath: `/${id}`,
      aliases: [],
      providers: [id === 'alpha' ? 'codex' : 'claude'],
      authScope: 'shared',
      upstreamOrigin: `http://${id}.test`,
      managementKeyFile: `/private/${id}`,
    })),
  });
  const calls: { url: string; key: string; body?: Record<string, unknown> }[] = [];
  let betaFailed = false;
  let cpaStatus = 200;
  let now = 1_000_000_000_000;
  let modelId = 'same-model';
  let cpaGate: Promise<void> | undefined;
  let requestsBody: Record<string, unknown> = {};
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const key = new Headers(init?.headers).get('Authorization') ?? '';
    calls.push({ url, key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    expect(init?.redirect).toBe('error');
    if (url.includes('beta.test') && betaFailed)
      return new Response('private detail', { status: 401 });
    if (url.endsWith('/config/access/api-keys'))
      return Response.json([url.includes('alpha') ? 'alpha-client' : 'beta-client']);
    if (url.endsWith('/v1/models'))
      return Response.json({ data: [{ id: modelId, owned_by: 'publisher' }] });
    await cpaGate;
    if (cpaStatus !== 200)
      return new Response('private cpa credential leak sentinel', { status: cpaStatus });
    const sent = JSON.parse(String(init?.body ?? '{}')) as { catalog?: { id: string }[] };
    return Response.json({
      catalog_ids: [...new Set((sent.catalog ?? []).map((entry) => entry.id))],
      generated_at_ms: calls.filter((call) => call.url.startsWith('http://cpa.test')).length,
      schema_version: 1,
      summary: {},
      coverage: {},
      requests: requestsBody,
      rates: [],
      timeline: [],
    });
  }) as typeof fetch;
  return {
    manifest,
    calls,
    handler: createAnalyticsHandler(
      manifest,
      fetcher,
      async (path) => `key-for-${path}`,
      () => now
    ),
    cpaCalls: () => calls.filter((call) => call.url.startsWith('http://cpa.test')).length,
    catalogCalls: () => calls.filter((call) => !call.url.startsWith('http://cpa.test')).length,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
    now: () => now,
    failBeta: () => {
      betaFailed = true;
    },
    restoreBeta: () => {
      betaFailed = false;
    },
    failCpa: (status: number) => {
      cpaStatus = status;
    },
    register: (id: string) => {
      modelId = id;
    },
    answerRequests: (body: Record<string, unknown>) => {
      requestsBody = body;
    },
    /** Hold CPA answers until the returned release is called. */
    holdCpa: () => {
      let release!: () => void;
      cpaGate = new Promise((resolve) => (release = resolve));
      return () => {
        cpaGate = undefined;
        release();
      };
    },
    clean: () => rmSync(directory, { recursive: true, force: true }),
  };
}

const query = { from_ms: 1000, to_ms: 2000, time_zone: 'UTC', granularity: 'hour', outcome: 'all' };
const request = (body: unknown = query, key = 'synthetic-view-key', headers = {}) =>
  new Request('http://history.test/v1/analytics', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, ...headers },
    body: JSON.stringify(body),
  });

describe('Prox analytics bridge', () => {
  test('authenticates before querying any source', async () => {
    const f = fixture();
    try {
      expect((await f.handler(request(query, 'wrong'))).status).toBe(401);
      expect(f.calls).toHaveLength(0);
    } finally {
      f.clean();
    }
  });
  test('passes the search-matched request fields through untouched', async () => {
    const f = fixture();
    try {
      const item = {
        id: 'synthetic-event',
        fail_summary: 'synthetic failure text',
        header_trace_id: 'synthetic-header-trace',
        auth_file_snapshot: 'synthetic-credential.json',
      };
      f.answerRequests({ items: [item], total_count: 1, has_more: false });
      const body = (await (await f.handler(request())).json()) as {
        requests: { items: unknown[] };
      };
      expect(body.requests.items).toEqual([item]);
    } finally {
      f.clean();
    }
  });
  test('rejects caller destinations/catalog and oversized payloads', async () => {
    const f = fixture();
    try {
      for (const body of [
        { ...query, catalog: [] },
        { ...query, url: 'http://evil.test' },
        { ...query, search: 'x'.repeat(17000) },
      ])
        expect((await f.handler(request(body))).status).toBe(400);
      expect(f.calls).toHaveLength(0);
    } finally {
      f.clean();
    }
  });
  test('pins credentials to their owners and preserves both registered occurrences', async () => {
    const f = fixture();
    try {
      const response = await f.handler(request());
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const data = await response.json();
      expect(data.catalog_sources.map((row: { state: string }) => row.state)).toEqual([
        'ready',
        'ready',
      ]);
      const cpa = f.calls.find((call) => call.url.startsWith('http://cpa.test'))!;
      expect(cpa.key).toBe('Bearer key-for-/private/cpa');
      expect(cpa.body?.catalog).toEqual(
        ['alpha', 'beta'].map((id) => ({
          instance_id: id,
          instance_label: id,
          provider: 'publisher',
          id: 'same-model',
        }))
      );
      expect(
        f.calls.filter((call) => call.url.endsWith('/v1/models')).map((call) => call.key)
      ).toEqual(['Bearer alpha-client', 'Bearer beta-client']);
      expect(JSON.stringify(data)).not.toContain('key-for');
    } finally {
      f.clean();
    }
  });
  test('isolates catalog failure and sanitizes CPA errors', async () => {
    const f = fixture();
    try {
      const bypass = { 'Cache-Control': 'no-cache' };
      f.failBeta();
      const data = await (await f.handler(request(query, undefined, bypass))).json();
      expect(data.catalog_sources.map((row: { state: string }) => row.state)).toEqual([
        'ready',
        'unavailable',
      ]);
      f.failCpa(401);
      const failed = await f.handler(request(query, undefined, bypass));
      expect(failed.status).toBe(503);
      expect(await failed.text()).not.toContain('sentinel');
      f.failCpa(400);
      expect((await f.handler(request(query, undefined, bypass))).status).toBe(400);
    } finally {
      f.clean();
    }
  });
  describe('snapshot cache', () => {
    const DAY = 86_400_000;
    // A rolling window as the page builds it: both ends come from the caller's own clock.
    const live = (f: { now: () => number }, span = 7 * DAY, extra = {}) => ({
      ...query,
      from_ms: f.now() - span,
      to_ms: f.now(),
      ...extra,
    });
    const settle = () => Bun.sleep(10);
    const generation = async (response: Response) => (await response.json()).generated_at_ms;

    test('serves a repeated live view without asking CPA again, whatever the caller clock says', async () => {
      const f = fixture();
      try {
        expect(await generation(await f.handler(request(live(f))))).toBe(1);
        f.advance(5000);
        expect(await generation(await f.handler(request(live(f))))).toBe(1);
        expect(f.cpaCalls()).toBe(1);
      } finally {
        f.clean();
      }
    });
    test('answers a stale view at once and refreshes behind it', async () => {
      const f = fixture();
      try {
        await f.handler(request(live(f)));
        f.advance(5 * 60_000);
        expect(await generation(await f.handler(request(live(f))))).toBe(1);
        await settle();
        expect(f.cpaCalls()).toBe(2);
        expect(await generation(await f.handler(request(live(f))))).toBe(2);
      } finally {
        f.clean();
      }
    });
    test('shares one CPA query between concurrent first requests', async () => {
      const f = fixture();
      try {
        const responses = await Promise.all([
          f.handler(request(live(f))),
          f.handler(request(live(f))),
          f.handler(request(live(f))),
        ]);
        expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
        expect(f.cpaCalls()).toBe(1);
      } finally {
        f.clean();
      }
    });
    test('recomputes when the caller asks for fresh data', async () => {
      const f = fixture();
      try {
        await f.handler(request(live(f)));
        const bypass = { 'Cache-Control': 'no-cache' };
        expect(await generation(await f.handler(request(live(f), undefined, bypass)))).toBe(2);
        expect(await generation(await f.handler(request(live(f))))).toBe(2);
      } finally {
        f.clean();
      }
    });
    test('keeps distinct views apart and never shares a cursor page or a fixed window', async () => {
      const f = fixture();
      try {
        await f.handler(request(live(f, 7 * DAY)));
        await f.handler(request(live(f, 30 * DAY)));
        await f.handler(request(live(f, 7 * DAY, { provider: 'publisher' })));
        await f.handler(request(live(f, 7 * DAY, { before_ms: 5, before_id: 'x' })));
        await f.handler(request(query));
        expect(f.cpaCalls()).toBe(5);
        await f.handler(request(query));
        expect(f.cpaCalls()).toBe(5);
      } finally {
        f.clean();
      }
    });
    test('does not cache a failure and keeps serving the last good snapshot through one', async () => {
      const f = fixture();
      try {
        f.failCpa(500);
        expect((await f.handler(request(live(f)))).status).toBe(503);
        f.failCpa(200);
        expect(await generation(await f.handler(request(live(f))))).toBe(2);
        f.failCpa(500);
        f.advance(5 * 60_000);
        expect(await generation(await f.handler(request(live(f))))).toBe(2);
        await settle();
        expect(await generation(await f.handler(request(live(f))))).toBe(2);
      } finally {
        f.clean();
      }
    });
    test('warming refreshes the default views before anyone asks', async () => {
      const f = fixture();
      try {
        await f.handler.warm();
        const seeded = f.cpaCalls();
        expect(seeded).toBeGreaterThanOrEqual(7);
        f.advance(5000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(seeded);
        // Someone is using the page, so the views keep their active cadence.
        await f.handler(request(live(f, 30 * DAY, { granularity: 'day', limit: 25 })));
        f.advance(10 * 60_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(seeded * 2);
        const before = f.cpaCalls();
        const response = await f.handler(
          request(live(f, 30 * DAY, { granularity: 'day', limit: 25 }))
        );
        expect(response.status).toBe(200);
        expect(f.cpaCalls()).toBe(before);
      } finally {
        f.clean();
      }
    });
    test('backs off to a slow heartbeat when idle, and the first visit still answers from the snapshot', async () => {
      const f = fixture();
      try {
        await f.handler.warm();
        const seeded = f.cpaCalls();
        f.advance(20 * 60_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(seeded);
        f.advance(15 * 60_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(seeded * 2);
        // Well past the live stale limit, but within the idle cap: served at once.
        f.advance(40 * 60_000);
        const before = f.cpaCalls();
        const first = await f.handler(
          request(live(f, 30 * DAY, { granularity: 'day', limit: 25 }))
        );
        expect(await generation(first)).toBeLessThanOrEqual(before);
        await settle();
        expect(f.cpaCalls()).toBe(before + 1);
        // The visit wakes the warmer: the other views refresh on the active cadence again.
        f.advance(60_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(before + 1 + seeded);
      } finally {
        f.clean();
      }
    });
    test('never serves a default view past the idle cap: it recomputes, and a failure surfaces', async () => {
      const f = fixture();
      try {
        await f.handler.warm();
        // Refreshes have been failing for hours; the dashboard must fall back, not draw a cliff.
        f.failCpa(500);
        f.advance(3 * 60 * 60_000);
        const response = await f.handler(
          request(live(f, 30 * DAY, { granularity: 'day', limit: 25 }))
        );
        expect(response.status).toBe(503);
      } finally {
        f.clean();
      }
    });
    test('backs off retrying a failing view instead of trying every tick', async () => {
      const f = fixture();
      try {
        f.failCpa(500);
        await f.handler.warm();
        const tried = f.cpaCalls();
        expect(tried).toBeGreaterThan(0);
        f.advance(15_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(tried);
      } finally {
        f.clean();
      }
    });
    test("does not answer just after midnight's yesterday with the last snapshot of today", async () => {
      const f = fixture();
      try {
        const midnight = Math.ceil(f.now() / DAY) * DAY;
        f.advance(midnight - 4 * 60_000 - f.now());
        await f.handler(request({ ...query, from_ms: midnight - DAY, to_ms: f.now() }));
        f.advance(4 * 60_000 + 30_000);
        const yesterday = await f.handler(
          request({ ...query, from_ms: midnight - DAY, to_ms: midnight })
        );
        expect(await generation(yesterday)).toBe(2);
      } finally {
        f.clean();
      }
    });
    test('keeps any live view asked for in the last day warm, even a provider no source declares', async () => {
      const f = fixture();
      try {
        const views = () => [
          dashboardAnalyticsQuery(f.now(), 'gemini'),
          live(f, 7 * DAY, { provider: 'remembered', limit: 25 }),
        ];
        for (const view of views()) await f.handler(request(view));
        // Nobody has asked for hours: the warmer keeps them on the idle cadence.
        f.advance(3 * 60 * 60_000);
        await f.handler.warm();
        const before = f.cpaCalls();
        for (const view of views()) expect((await f.handler(request(view))).status).toBe(200);
        expect(f.cpaCalls()).toBe(before);
        // A day after the last visit, the views are let go.
        f.advance(25 * 60 * 60_000);
        await f.handler.warm();
        const later = f.cpaCalls();
        await f.handler(request(views()[0]));
        expect(f.cpaCalls()).toBe(later + 1);
      } finally {
        f.clean();
      }
    });
    test('a restart warms the goal views first, two at a time', async () => {
      const f = fixture();
      try {
        const release = f.holdCpa();
        const warming = f.handler.warm();
        await settle();
        expect(f.cpaCalls()).toBe(2);
        release();
        await warming;
        const sent = f.calls
          .filter((call) => call.url.startsWith('http://cpa.test'))
          .slice(0, 3)
          .map(({ body }) => [
            Math.round((Number(body?.to_ms) - Number(body?.from_ms)) / DAY),
            body?.granularity,
          ]);
        expect(sent).toEqual([
          [7, 'hour'],
          [30, 'day'],
          [30, 'hour'],
        ]);
      } finally {
        f.clean();
      }
    });
    test('a catalog blip never replaces a ready snapshot, and is retried sooner than the idle period', async () => {
      const f = fixture();
      try {
        await f.handler.warm();
        const seeded = f.cpaCalls();
        f.failBeta();
        f.advance(31 * 60_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(seeded * 2);
        // Retried on the failure backoff, well inside the 30-minute idle period.
        f.advance(5 * 60_000);
        await f.handler.warm();
        expect(f.cpaCalls()).toBe(seeded * 3);
        f.restoreBeta();
        const view = live(f, 30 * DAY, { granularity: 'day', limit: 25 });
        const data = await (await f.handler(request(view))).json();
        expect(data.catalog_sources.map((row: { state: string }) => row.state)).toEqual([
          'ready',
          'ready',
        ]);
        expect(data.generated_at_ms).toBeLessThanOrEqual(seeded);
      } finally {
        f.clean();
      }
    });
    test('a blip on an active view is still retried soon after the page goes idle', async () => {
      const f = fixture();
      try {
        const view = () => live(f, 2 * DAY);
        const viewCalls = () =>
          f.calls.filter(
            ({ url, body }) =>
              url.startsWith('http://cpa.test') &&
              Number(body?.to_ms) - Number(body?.from_ms) === 2 * DAY
          ).length;
        await f.handler(request(view()));
        f.failBeta();
        // Past the catalog's reuse period, so the background recompute sees the blip.
        f.advance(6 * 60_000);
        await f.handler(request(view()));
        await settle();
        expect(viewCalls()).toBe(2);
        // Idle now, and the retained ready snapshot is younger than the idle period.
        f.advance(16 * 60_000);
        await f.handler.warm();
        expect(viewCalls()).toBe(3);
      } finally {
        f.clean();
      }
    });
    test('an older healthy recompute finishing after a blip does not cancel its early retry', async () => {
      const f = fixture();
      try {
        const view = () => live(f, 2 * DAY);
        const viewCalls = () =>
          f.calls.filter(
            ({ url, body }) =>
              url.startsWith('http://cpa.test') &&
              Number(body?.to_ms) - Number(body?.from_ms) === 2 * DAY
          ).length;
        await f.handler(request(view()));
        f.advance(6 * 60_000);
        // A background recompute with every source ready, held at CPA.
        const releaseOld = f.holdCpa();
        await f.handler(request(view()));
        await settle();
        f.failBeta();
        const releaseNew = f.holdCpa();
        const refreshed = f.handler(request(view(), undefined, { 'Cache-Control': 'no-cache' }));
        await settle();
        releaseNew();
        await refreshed;
        releaseOld();
        await settle();
        expect(viewCalls()).toBe(3);
        f.advance(16 * 60_000);
        await f.handler.warm();
        expect(viewCalls()).toBe(4);
      } finally {
        f.clean();
      }
    });
  });
  describe('catalog reuse', () => {
    const DAY = 86_400_000;
    const view = (f: { now: () => number }, span: number) => ({
      ...query,
      from_ms: f.now() - span,
      to_ms: f.now(),
    });
    test('reads the catalog once for several views, and again after a few minutes', async () => {
      const f = fixture();
      try {
        await f.handler(request(view(f, 7 * DAY)));
        await f.handler(request(view(f, 30 * DAY)));
        expect(f.cpaCalls()).toBe(2);
        expect(f.catalogCalls()).toBe(4);
        f.advance(6 * 60_000);
        await f.handler(request(view(f, DAY)));
        expect(f.catalogCalls()).toBe(8);
      } finally {
        f.clean();
      }
    });
    test('a Refresh reads the catalog again, so a new registration shows at once', async () => {
      const f = fixture();
      try {
        await f.handler(request(view(f, 7 * DAY)));
        expect(f.catalogCalls()).toBe(4);
        await f.handler(request(view(f, 7 * DAY), undefined, { 'Cache-Control': 'no-cache' }));
        expect(f.catalogCalls()).toBe(8);
      } finally {
        f.clean();
      }
    });
    test('a Refresh supersedes a background recompute: it starts at once, and the older result never overwrites it', async () => {
      const f = fixture();
      try {
        await f.handler(request(view(f, 7 * DAY)));
        // Stale while the catalog is still cached: the visit starts a background recompute
        // with that catalog, held at CPA.
        f.advance(2 * 60_000);
        const releaseOld = f.holdCpa();
        await f.handler(request(view(f, 7 * DAY)));
        await Bun.sleep(10);
        expect(f.cpaCalls()).toBe(2);
        f.register('new-model');
        const releaseNew = f.holdCpa();
        const refreshed = f.handler(
          request(view(f, 7 * DAY), undefined, { 'Cache-Control': 'no-cache' })
        );
        await Bun.sleep(10);
        // The Refresh asked CPA right away instead of waiting out the earlier recompute.
        expect(f.cpaCalls()).toBe(3);
        releaseNew();
        expect((await (await refreshed).json()).catalog_ids).toEqual(['new-model']);
        releaseOld();
        await Bun.sleep(10);
        const after = await (await f.handler(request(view(f, 7 * DAY)))).json();
        expect(after.catalog_ids).toEqual(['new-model']);
      } finally {
        f.clean();
      }
    });
    test('a superseded first load that fails does not drop the Refresh that replaced it', async () => {
      const f = fixture();
      try {
        const releaseOld = f.holdCpa();
        const first = f.handler(request(view(f, 7 * DAY)));
        await Bun.sleep(10);
        const releaseNew = f.holdCpa();
        const refreshed = f.handler(
          request(view(f, 7 * DAY), undefined, { 'Cache-Control': 'no-cache' })
        );
        await Bun.sleep(10);
        expect(f.cpaCalls()).toBe(2);
        f.failCpa(500);
        releaseOld();
        expect((await first).status).toBe(503);
        f.failCpa(200);
        releaseNew();
        expect((await refreshed).status).toBe(200);
        // The Refresh's snapshot is kept, so the next visit is answered without CPA.
        expect((await f.handler(request(view(f, 7 * DAY)))).status).toBe(200);
        expect(f.cpaCalls()).toBe(2);
      } finally {
        f.clean();
      }
    });
    test('a failed Refresh does not drop the first load still running behind it', async () => {
      const f = fixture();
      try {
        const releaseOld = f.holdCpa();
        const first = f.handler(request(view(f, 7 * DAY)));
        await Bun.sleep(10);
        const releaseNew = f.holdCpa();
        const refreshed = f.handler(
          request(view(f, 7 * DAY), undefined, { 'Cache-Control': 'no-cache' })
        );
        await Bun.sleep(10);
        expect(f.cpaCalls()).toBe(2);
        f.failCpa(500);
        releaseNew();
        expect((await refreshed).status).toBe(503);
        f.failCpa(200);
        releaseOld();
        expect((await first).status).toBe(200);
        // The first load's snapshot is kept, so the next visit is answered without CPA.
        expect((await f.handler(request(view(f, 7 * DAY)))).status).toBe(200);
        expect(f.cpaCalls()).toBe(2);
      } finally {
        f.clean();
      }
    });
    test('never keeps a failed source: it reads unavailable, then recovers at once', async () => {
      const f = fixture();
      try {
        f.failBeta();
        const states = async (span: number) =>
          (await (await f.handler(request(view(f, span)))).json()).catalog_sources.map(
            (row: { state: string }) => row.state
          );
        expect(await states(7 * DAY)).toEqual(['ready', 'unavailable']);
        expect(await states(30 * DAY)).toEqual(['ready', 'unavailable']);
        f.restoreBeta();
        expect(await states(DAY)).toEqual(['ready', 'ready']);
      } finally {
        f.clean();
      }
    });
  });
  test('keeps the dataset grant private and validates its configured origin', () => {
    const f = fixture();
    try {
      const publicData = publicSourceDiscovery(f.manifest, 'a'.repeat(64));
      expect(JSON.stringify(publicData)).not.toContain('cpa');
      expect(() =>
        validateSourceManifest({
          ...f.manifest,
          analytics: { ...f.manifest.analytics, upstreamOrigin: 'http://cpa.test/evil' },
        })
      ).toThrow();
      expect(() =>
        validateSourceManifest({
          ...f.manifest,
          analytics: { ...f.manifest.analytics, dataset: 'all-tenants' },
        })
      ).toThrow();
    } finally {
      f.clean();
    }
  });
});

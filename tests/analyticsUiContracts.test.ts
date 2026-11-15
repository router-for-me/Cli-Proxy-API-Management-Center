import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import i18n from '../src/i18n';
import { apiClient } from '../src/services/api/client';
import { createAnalyticsApi } from '../src/services/api/analytics';
import { addressProvider, startingFilters } from '../src/features/analytics/queryState';
import { ApiClient } from '../src/services/api/transport';
import { AnalyticsPage } from '../src/features/analytics/AnalyticsPage';
import { AnalyticsChart } from '../src/features/analytics/AnalyticsChart';
import { AnalyticsViews } from '../src/features/analytics/AnalyticsViews';
import { RequestDetails, RequestTable } from '../src/features/analytics/RequestTable';
import { ModelRates } from '../src/features/analytics/ModelRates';
import {
  bucketTimeline,
  lineSegments,
  niceMaximum,
  smoothPath,
  timeTicks,
} from '../src/features/analytics/chartGeometry';
import { TrendChart } from '../src/features/analytics/TrendChart';
import { analyticsNumber } from '../src/features/analytics/format';
import { parseAnalyticsUiState } from '../src/features/analytics/uiState';
import {
  analyticsTabs,
  bucketQuery,
  nextPageQuery,
  rangeQuery,
  shownWindow,
  withoutCursor,
} from '../src/features/analytics/queryState';
import { analyticsUiRequest, analyticsUiResponse } from './fixtures/analyticsUi';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const noop = () => {};
beforeEach(async () => {
  await i18n.changeLanguage('en');
});

describe('Analytics query and transport contracts', () => {
  test('all ranges are UTC and use server-supported bucket sizes', () => {
    expect(rangeQuery('1h', 10_000_000)).toMatchObject({
      from_ms: 6_400_000,
      to_ms: 10_000_000,
      time_zone: 'UTC',
      granularity: 'hour',
    });
    expect(rangeQuery('24h', 100_000_000).from_ms).toBe(13_600_000);
    expect(rangeQuery('7d', 1_000_000_000)).toMatchObject({
      from_ms: 395_200_000,
      granularity: 'day',
    });
    expect(rangeQuery('30d', 3_000_000_000).from_ms).toBe(408_000_000);
  });
  test('today and yesterday are UTC calendar days; a chosen bucket overrides auto', () => {
    const day = 86_400_000;
    const now = 20 * day + 5 * 3_600_000;
    expect(rangeQuery('today', now)).toMatchObject({ from_ms: 20 * day, to_ms: now });
    expect(rangeQuery('yesterday', now)).toMatchObject({
      from_ms: 19 * day,
      to_ms: 20 * day,
      granularity: 'hour',
    });
    expect(rangeQuery('30d', now, 'hour').granularity).toBe('hour');
    expect(rangeQuery('24h', now, 'day').granularity).toBe('day');
    expect(rangeQuery('7d', now, 'auto').granularity).toBe('day');
  });
  test('bucket drilldown intersects the UTC bucket and keeps filters, clearing the cursor', () => {
    const query = {
      ...rangeQuery('24h', 10_000_000),
      from_ms: 1_000_000,
      provider: 'claude',
      model: 'alias',
      search: 'trace',
      outcome: 'failed' as const,
      before_ms: 5,
      before_id: 7,
    };
    expect(bucketQuery(query, 0)).toEqual({
      ...withoutCursor(query),
      from_ms: 1_000_000,
      to_ms: 3_600_000,
    });
    expect(bucketQuery(query, 7_200_000)).toEqual({
      ...withoutCursor(query),
      from_ms: 7_200_000,
      to_ms: 10_000_000,
    });
  });
  test('paging preserves filters and the server tie-breaker, including zero cursors', () => {
    const query = { ...rangeQuery('7d', 2_000_000_000), model: 'billing-alias', search: 'trace' };
    expect(nextPageQuery(query, analyticsUiResponse.requests)).toEqual({
      ...query,
      before_ms: 1793233800000,
      before_id: 1,
    });
    expect(
      nextPageQuery(query, {
        ...analyticsUiResponse.requests,
        next_before_ms: 0,
        next_before_id: 0,
      })?.before_id
    ).toBe(0);
    expect(
      nextPageQuery(query, { ...analyticsUiResponse.requests, next_before_id: null })
    ).toBeNull();
    expect(nextPageQuery(query, { ...analyticsUiResponse.requests, has_more: false })).toBeNull();
  });
  test('POST uses a captured connection and forwards the query and AbortSignal unchanged', async () => {
    const captured = new ApiClient();
    const capture = spyOn(apiClient, 'captureConnection').mockReturnValue(captured);
    const post = spyOn(captured, 'post').mockResolvedValue(analyticsUiResponse);
    try {
      const query = rangeQuery('1h', 1_000_000_000);
      const signal = new AbortController().signal;
      expect(await createAnalyticsApi().query(query, signal)).toBe(analyticsUiResponse);
      expect(capture).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith('/prox/analytics', query, { signal });
    } finally {
      post.mockRestore();
      capture.mockRestore();
    }
  });
  test('effect guards response publication, cancellation and session identity', () => {
    const source = read('src/features/analytics/useAnalytics.ts');
    expect(source).toContain('new AbortController()');
    expect(source).toContain('controller.abort()');
    expect(source).toContain('observer.getSnapshot() === session');
    expect(source).toContain('apiClient.getConnectionRevision() === revision');
    expect(source).toContain('sessionResult?.query === query');
    expect(source).toContain('result?.session === session');
    expect(source).toContain('createPoolSessionObserver');
  });
  test('a Refresh recomputes once, whether its load succeeds or fails', () => {
    const source = read('src/features/analytics/useAnalytics.ts');
    const success = source.slice(source.indexOf('.then('), source.indexOf('.catch('));
    const failure = source.slice(source.indexOf('.catch('), source.indexOf('return () =>'));
    // A failed Refresh left pending would bypass the warm snapshot on every later view change.
    expect(success).toContain('appliedRefresh.current = refresh');
    expect(failure).toContain('appliedRefresh.current = refresh');
  });
  test('an old snapshot is asked for once more, after the refresh behind it has had time', () => {
    const source = read('src/features/analytics/useAnalytics.ts');
    const success = source.slice(source.indexOf('.then('), source.indexOf('.catch('));
    expect(success).toContain('data.generated_at_ms');
    expect(success).toContain('recheckedFor.current = query');
    expect(success).toContain('setTimeout(');
    expect(source).toContain('clearTimeout(');
  });
  test('refresh advances the selected window and clears paging while preserving filters', () => {
    const source = read('src/features/analytics/AnalyticsPage.tsx');
    const reload = source.slice(source.indexOf('const reload ='), source.indexOf('return <'));
    expect(reload).toContain('rangeQuery(range, Date.now(), bucket)');
    expect(reload).toContain('withoutCursor(query)');
    expect(reload).toContain('to_ms: interval.to_ms');
    expect(reload).toContain('setPages([');
  });
  test('the headline shows the window the served snapshot covers, not the browser clock', () => {
    const query = rangeQuery('24h', 10 * 86_400_000);
    expect(shownWindow(query)).toEqual({ from_ms: query.from_ms, to_ms: query.to_ms });
    const snapshot = { from_ms: query.from_ms - 60_000, to_ms: query.to_ms - 60_000 };
    expect(shownWindow(query, snapshot)).toEqual(snapshot);
    const source = read('src/features/analytics/AnalyticsPage.tsx');
    const headline = source.slice(source.indexOf('className={styles.scope}'));
    expect(source).toContain('shownWindow(query, data)');
    expect(headline.slice(0, headline.indexOf('</p>'))).not.toContain('query.from_ms');
  });
  test('the top-right refresh button runs the same reload as the page button', () => {
    const source = read('src/features/analytics/AnalyticsPage.tsx');
    expect(source).toContain("import { useHeaderRefresh } from '@/hooks/useHeaderRefresh'");
    expect(source).toContain('useHeaderRefresh(reload)');
  });
});

describe('Analytics remembered view', () => {
  test('restores valid selections and drops unknown or tampered fields one by one', () => {
    const saved = JSON.stringify({
      tab: 'tokens',
      range: '7d',
      bucket: 'hour',
      provider: 'claude',
      model: 'claude-opus-5-5',
      outcome: 'failed',
      search: 'trace',
    });
    expect(parseAnalyticsUiState(saved)).toEqual({
      tab: 'tokens',
      range: '7d',
      bucket: 'hour',
      provider: 'claude',
      model: 'claude-opus-5-5',
      outcome: 'failed',
      search: 'trace',
    });
    expect(
      parseAnalyticsUiState(
        JSON.stringify({ tab: 'admin', range: '90d', bucket: 'minute', provider: 4, search: '' })
      )
    ).toEqual({
      tab: undefined,
      range: undefined,
      bucket: undefined,
      provider: undefined,
      model: undefined,
      outcome: undefined,
      search: undefined,
    });
    expect(parseAnalyticsUiState('{not json')).toEqual({});
    expect(parseAnalyticsUiState(null)).toEqual({});
    expect(
      parseAnalyticsUiState(JSON.stringify({ search: 'x'.repeat(201) })).search
    ).toBeUndefined();
  });
});

describe('Analytics SSR presentation', () => {
  test('six tabs remain reachable and the authenticated sidebar includes Analytics under Observe', () => {
    const markup = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/analytics?tab=cost'] },
        createElement(AnalyticsPage)
      )
    );
    expect(markup.match(/role="tab"/g) ?? []).toHaveLength(6);
    expect(markup).toContain('id="analytics-tab-cost" role="tab" aria-selected="true"');
    expect(markup).toContain('Loading analytics');
    const layout = read('src/components/layout/MainLayout.tsx');
    expect(
      layout.slice(layout.indexOf("id: 'observe'"), layout.indexOf("id: 'control'"))
    ).toContain("path: '/analytics'");
    expect(read('src/router/MainRoutes.tsx')).toContain(
      "path: '/analytics', element: <AnalyticsPage />"
    );
  });
  test('all aggregate views use full server totals, retain cautions and do not derive totals from request pages', () => {
    for (const tab of ['overview', 'tokens', 'cost', 'performance'] as const) {
      const markup = renderToStaticMarkup(
        createElement(AnalyticsViews, {
          tab,
          data: analyticsUiResponse,
          onBucket: noop,
          onModel: noop,
          onProvider: noop,
        })
      );
      expect(markup).toContain('View data table');
      expect(markup).toContain('Fixture model (billing alias)');
      expect(markup).not.toContain('NaN');
      if (tab === 'overview') expect(markup).toMatch(/<strong title="128"[^>]*>128<\/strong>/);
      if (tab === 'tokens') expect(markup).toContain('Legacy data cannot establish');
      if (tab === 'cost') expect(markup).toContain('Not subscription spend');
      if (tab === 'performance') {
        expect(markup).toContain('mixed methods');
        expect(markup).toContain('Unavailable');
      }
    }
  });
  test('null is unavailable and explicit zero remains numeric', () => {
    expect(analyticsNumber(null, 'en', true)).toBe('Unavailable');
    expect(analyticsNumber(0, 'en', true)).toBe('$0.00');
    expect(analyticsNumber(0, 'en')).toBe('0');
    expect(analyticsNumber(Infinity, 'en')).toBe('Unavailable');
  });
  test('safe details expose authorized operational fields, never arbitrary payload fields', () => {
    const request = {
      ...analyticsUiRequest,
      raw_headers: 'SYNTHETIC_SECRET_SENTINEL',
      prompt: 'SYNTHETIC_PROMPT_SENTINEL',
      latency_ms: null,
    };
    const markup = renderToStaticMarkup(createElement(RequestDetails, { request }));
    for (const expected of [
      '192.0.2.10',
      'SyntheticBrowser/1.0',
      'synthetic-trace',
      'synthetic-parent',
      'synthetic-session',
      '/v1/messages',
      'Unavailable',
      'output tokens / full execution second',
    ])
      expect(markup).toContain(expected);
    expect(markup).not.toContain('SYNTHETIC_SECRET_SENTINEL');
    expect(markup).not.toContain('SYNTHETIC_PROMPT_SENTINEL');
  });
  describe('search-matched fields in the request detail', () => {
    const matched = {
      ...analyticsUiRequest,
      failed: true,
      fail_summary: 'upstream said: quota exhausted for synthetic account',
      header_trace_id: 'synthetic-header-trace-7f3a',
      auth_file_snapshot: 'synthetic-credential.json',
    };
    const render = (request: typeof matched | typeof analyticsUiRequest) =>
      renderToStaticMarkup(createElement(RequestDetails, { request }));

    test('shows failure text, response trace id and credential file when present', () => {
      const markup = render(matched);
      for (const expected of [
        'Failure text',
        'upstream said: quota exhausted for synthetic account',
        'Response trace ID',
        'synthetic-header-trace-7f3a',
        'Credential file',
        'synthetic-credential.json',
      ])
        expect(markup).toContain(expected);
    });
    test('omits each field, with no empty label, when it is absent or empty', () => {
      for (const request of [
        analyticsUiRequest,
        { ...matched, fail_summary: undefined, header_trace_id: undefined, auth_file_snapshot: '' },
      ]) {
        const markup = render(request);
        for (const label of ['Failure text', 'Response trace ID', 'Credential file'])
          expect(markup).not.toContain(label);
        expect(markup).not.toContain('Copy Response trace ID');
        expect(markup).not.toContain('Copy Credential file');
      }
      // One field present never drags the other labels in with it.
      const onlyTrace = render({ ...analyticsUiRequest, header_trace_id: 'only-trace' });
      expect(onlyTrace).toContain('Response trace ID');
      expect(onlyTrace).not.toContain('Failure text');
      expect(onlyTrace).not.toContain('Credential file');
    });
    test('the trace id and the credential file have named copy buttons; the failure text does not', () => {
      const markup = render(matched);
      expect(markup).toContain('aria-label="Copy Response trace ID"');
      expect(markup).toContain('aria-label="Copy Credential file"');
      expect(markup).not.toContain('aria-label="Copy Failure text"');
    });
    test('keeps a very long failure text and unbroken values whole, in wrapping containers', () => {
      const failure = `${'quota exhausted '.repeat(300)}END-OF-FAILURE`;
      const trace = `trace-${'a'.repeat(400)}-END-OF-TRACE`;
      const file = `${'long-credential-name_'.repeat(30)}END-OF-FILE.json`;
      const markup = render({
        ...matched,
        fail_summary: failure,
        header_trace_id: trace,
        auth_file_snapshot: file,
      });
      for (const expected of ['END-OF-FAILURE', 'END-OF-TRACE', 'END-OF-FILE.json'])
        expect(markup).toContain(expected);
      const styles = read('src/features/analytics/AnalyticsPage.module.scss');
      const rule = (name: string) =>
        styles.match(new RegExp(`\\.${name}\\s*\\{[^}]*\\}`))?.[0] ?? '';
      expect(rule('failureText')).toContain('white-space: pre-wrap');
      expect(rule('failureText')).toContain('overflow-wrap: anywhere');
      expect(rule('failureText')).toContain('max-height');
      expect(rule('failureText')).toContain('overflow');
      expect(rule('copyValue')).toContain('min-width: 0');
      expect(rule('copyValueText')).toContain('min-width: 0');
      expect(rule('copyValueText')).toContain('overflow-wrap: anywhere');
    });
    test('a11y: the long failure text is a keyboard-scrollable named region', () => {
      const markup = render(matched);
      expect(markup).toMatch(/<div[^>]*role="region"[^>]*aria-label="Failure text"[^>]*>/);
      expect(markup).toMatch(/<div[^>]*role="region"[^>]*tabindex="0"[^>]*>/);
      // The label is rendered once as a term and once as the region name, never as an empty term.
      expect(markup).not.toMatch(/<dt>\s*<\/dt>/);
      expect(markup).not.toMatch(/<dd>\s*<\/dd>/);
    });
    test('every locale carries the new labels', () => {
      for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi']) {
        const analytics = JSON.parse(read(`src/i18n/locales/${locale}.json`)).analytics;
        for (const key of ['fail_summary', 'header_trace_id', 'auth_file_snapshot'])
          expect(analytics.fields[key]).toBeString();
        expect(analytics.copy_field).toContain('{{field}}');
      }
    });
  });
  test('request token nulls and presence metadata are rendered exactly as projected by the backend', () => {
    const request = {
      ...analyticsUiRequest,
      usage_presence: 'unknown' as const,
      input_tokens: null,
      output_tokens: 42,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      reasoning_tokens: null,
      total_tokens: null,
      output_tokens_per_second: null,
    };
    const details = renderToStaticMarkup(createElement(RequestDetails, { request }));
    expect(details).toContain('Presence unknown');
    expect(details).toContain('synthetic-parent-execution');
    expect(details).toContain('First response offset');
    expect(details).toContain('<dd>150</dd>');
    expect(details).toContain('<dd>42</dd>');
    const markup = renderToStaticMarkup(
      createElement(RequestTable, {
        data: { ...analyticsUiResponse.requests, items: [request] },
        selected: null,
        onSelect: noop,
        onPrevious: noop,
        onNext: noop,
        canPrevious: false,
        canNext: false,
        page: 1,
      })
    );
    expect(markup).toContain('Unavailable / 42');
    expect(markup).toContain('Unavailable / Unavailable');
    expect(markup).toContain('Presence unknown');
    // A reported zero stays zero; the renderer does not re-qualify usage based on field flags.
    const reportedZero = renderToStaticMarkup(
      createElement(RequestDetails, {
        request: { ...request, usage_presence: 'reported', cache_creation_tokens: 0 },
      })
    );
    expect(reportedZero).toContain('<dd>0</dd>');
  });
  test('request table has bounded scrolling, operational details and server pagination', () => {
    const markup = renderToStaticMarkup(
      createElement(RequestTable, {
        data: analyticsUiResponse.requests,
        selected: analyticsUiRequest,
        onSelect: noop,
        onPrevious: noop,
        onNext: noop,
        canPrevious: false,
        canNext: true,
        page: 1,
      })
    );
    expect(markup).toContain('128 retained events');
    expect(markup).toContain('Page 1');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-label="Open event synthetic-event-2"');
    expect(markup).toContain('Explicit zero rate');
  });
  test('rates include unused unpriced registrations, source failures and expandable tier schedules', () => {
    const markup = renderToStaticMarkup(createElement(ModelRates, { data: analyticsUiResponse }));
    for (const expected of [
      'unused-unpriced-model',
      'Offline synthetic source',
      'Synthetic source',
      'billing-fixture',
      '200000',
      'fast',
      'USD per million tokens',
      'current configured model rates',
      'Unavailable',
    ])
      expect(markup).toContain(expected);
    expect(markup).toContain('<summary>Rate details</summary>');
  });
  test('trend lines break at nulls and missing buckets, and render keyboard controls and data tables', () => {
    const frame = { from: 0, to: 5000, interval: 1000, left: 0, right: 1000, top: 0, bottom: 100 };
    const line = lineSegments(
      [
        { at: 0, value: 4 },
        { at: 1000, value: 2 },
        { at: 2000, value: null },
        { at: 3000, value: 0 },
        // 4000 is a missing bucket, not a zero.
        { at: 5000, value: 1 },
      ],
      frame
    );
    expect(line.segments.map((segment) => segment.length)).toEqual([2, 1, 1]);
    expect(line.segments[0][0]).toEqual([100, 0]);
    expect(line.segments[1][0][1]).toBe(100);
    expect(lineSegments([{ at: 0, value: 5 }], frame, 10).segments[0][0][1]).toBe(50);
    const markup = renderToStaticMarkup(
      createElement(TrendChart, {
        title: 'Synthetic counts',
        series: [
          { key: 'a', label: 'Events', color: 'white' },
          { key: 'b', label: 'Cost', color: 'pink', currency: true },
        ],
        points: [
          { at: 0, values: [4, 1.5] },
          { at: 2000, values: [null, 0] },
        ],
        from: 0,
        to: 4000,
        interval: 1000,
        onSelect: noop,
      })
    );
    expect(markup).toContain('role="button" tabindex="0"');
    expect(markup).toContain('Events: Unavailable · Cost: $0.00');
    expect(markup).toContain('<table>');
    expect(markup).not.toContain('<text'); // Labels do not shrink with the SVG viewBox on mobile.
  });
  test('axis maxima round to 1-1.5-2-2.5-3-4-5 steps with headroom and time ticks are evenly spaced UTC hours', () => {
    expect([
      niceMaximum(3_800),
      niceMaximum(4.9),
      niceMaximum(1_050),
      niceMaximum(12),
      niceMaximum(0),
    ]).toEqual([4_000, 6, 1_200, 16, 0]);
    const from = Date.UTC(2026, 9, 28, 12, 30);
    const ticks = timeTicks(from, from + 86_400_000, 3_600_000, 6);
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(new Set(ticks.slice(1).map((at, i) => at - ticks[i])).size).toBe(1);
    expect(ticks.every((at) => at % 3_600_000 === 0)).toBe(true);
  });
  test('a partly covered bucket is drawn inside the selected range', () => {
    const hour = 3_600_000;
    const from = 11 * hour + 10 * 60_000; // 11:10–12:10, buckets at 11:00 and 12:00
    const frame = {
      from,
      to: from + hour,
      interval: hour,
      left: 0,
      right: 1000,
      top: 0,
      bottom: 100,
    };
    const line = lineSegments(
      [
        { at: 11 * hour, value: 1 },
        { at: 12 * hour, value: 2 },
      ],
      frame
    );
    for (const [x] of line.segments[0]) expect(x).toBeGreaterThanOrEqual(0);
    for (const [x] of line.segments[0]) expect(x).toBeLessThanOrEqual(1000);
    // 11:10–12:00 centres at 11:35; 12:00–12:10 centres at 12:05.
    expect(line.x(11 * hour)).toBeCloseTo((25 / 60) * 1000, 6);
    expect(line.x(12 * hour)).toBeCloseTo((55 / 60) * 1000, 6);
  });
  test('currency ticks keep enough decimals to stay distinct and exact', () => {
    const render = (peak: number) =>
      renderToStaticMarkup(
        createElement(TrendChart, {
          title: 'Cost',
          series: [{ key: 'c', label: 'Cost', color: 'cyan', currency: true }],
          points: [{ at: 0, values: [peak] }],
          from: 0,
          to: 3_600_000,
          interval: 3_600_000,
        })
      );
    expect(render(9.2)).toContain('$7.50');
    expect(render(7.5)).toContain('>$6<');
    expect(render(0.0009)).toContain('$0.00075');
  });
  test('a small axis keeps its tick precision beside a compact one', () => {
    const markup = renderToStaticMarkup(
      createElement(TrendChart, {
        title: 'Usage',
        series: [
          { key: 'calls', label: 'Events', color: 'white' },
          { key: 'tokens', label: 'Tokens', color: 'violet' },
        ],
        points: [{ at: 0, values: [0.95, 9_500] }],
        from: 0,
        to: 3_600_000,
        interval: 3_600_000,
      })
    );
    expect(markup).toContain('0.25');
    expect(markup).toContain('0.75');
    expect(markup).toContain('10K');
  });
  test('narrow daily axes thin their labels; hourly axes keep the date change', () => {
    const day = 86_400_000;
    const majors = (interval: number, span: number) => {
      const markup = renderToStaticMarkup(
        createElement(TrendChart, {
          title: 'Usage',
          series: [{ key: 'c', label: 'Events', color: 'white' }],
          points: [{ at: 0, values: [3] }],
          from: 0,
          to: span,
          interval,
        })
      );
      return (markup.match(/data-minor="false"/g) ?? []).length;
    };
    // 30 days of daily buckets: ends plus every other tick, never every tick.
    expect(majors(day, 30 * day)).toBeLessThanOrEqual(4);
    // 24 hourly buckets crossing midnight: both ends plus the date change.
    expect(majors(3_600_000, day + 12 * 3_600_000)).toBeLessThanOrEqual(4);
  });
  test('buckets whose measurements are all missing keep drilldown and the table', () => {
    const markup = renderToStaticMarkup(
      createElement(TrendChart, {
        title: 'TTFT',
        series: [{ key: 't', label: 'TTFT', color: 'white' }],
        points: [{ at: 0, values: [null] }],
        from: 0,
        to: 3_600_000,
        interval: 3_600_000,
        onSelect: noop,
      })
    );
    expect(markup).toContain('role="button" tabindex="0"');
    expect(markup).toContain('<table>');
    expect(markup).toContain('No measured values');
  });
  test('hours the server omits are listed so counts can draw them as zero', () => {
    const hour = 3_600_000;
    // CPA only returns hours with events: 01:00 is absent, not unmeasured.
    const buckets = bucketTimeline([0, 2 * hour], 0, 3 * hour, hour);
    expect(buckets).toEqual([
      { at: 0, present: true },
      { at: hour, present: false },
      { at: 2 * hour, present: true },
    ]);
    // A partial first bucket still starts on its own boundary.
    expect(bucketTimeline([], hour / 2, 2 * hour, hour).map((b) => b.at)).toEqual([0, hour]);
  });
  test('fully retained ranges draw quiet hours as zero for sums, never for durations', () => {
    const hour = 3_600_000;
    const from = analyticsUiResponse.timeline[0].bucket_ms;
    const data = (complete: boolean) => ({
      ...analyticsUiResponse,
      from_ms: from,
      to_ms: from + 3 * hour,
      granularity: 'hour' as const,
      coverage: { ...analyticsUiResponse.coverage, raw_complete: complete },
      // The middle hour had no events, so the server returned no bucket for it.
      timeline: [
        { ...analyticsUiResponse.timeline[0], bucket_ms: from },
        { ...analyticsUiResponse.timeline[0], bucket_ms: from + 2 * hour },
      ],
    });
    const rows = (tab: 'overview' | 'performance', complete: boolean) =>
      (
        renderToStaticMarkup(
          createElement(AnalyticsViews, {
            tab,
            data: data(complete),
            onBucket: noop,
            onModel: noop,
            onProvider: noop,
          })
        ).match(/UTC<\/button>/g) ?? []
      ).length;
    expect(rows('overview', true)).toBe(3); // quiet hour listed, drawn as zero
    expect(rows('overview', false)).toBe(2); // partial coverage: absence may be missing data
    expect(rows('performance', true)).toBe(2 + 2); // duration and TTFT tables: measured hours only
  });
  test('smooth paths pass through every point without overshooting flat or monotone runs', () => {
    const path = smoothPath([
      [0, 10],
      [10, 0],
      [20, 0],
      [30, 5],
    ]);
    expect(path.startsWith('M0,10')).toBe(true);
    for (const point of ['10,0', '20,0', '30,5']) expect(path).toContain(point);
    // The flat 0→0 stretch stays flat: both control points sit on y = 0.
    const flat = path.split('C')[2].trim().split(' ');
    expect(flat.map((xy) => Number(xy.split(',')[1]))).toEqual([0, 0, 0]);
    expect(smoothPath([[0, 1]])).toBe('M0,1');
  });
  test('breakdowns rank categories and keep missing values without a bar', () => {
    const markup = renderToStaticMarkup(
      createElement(AnalyticsChart, {
        title: 'By provider',
        data: [
          { key: 'codex', label: 'GPT / Codex', value: 2 },
          { key: 'claude', label: 'Claude', value: 5 },
          { key: 'other', label: 'Missing measurement', value: null },
        ],
        onSelect: noop,
      })
    );
    expect(markup.indexOf('Claude')).toBeLessThan(markup.indexOf('GPT / Codex'));
    expect(markup).toContain('background:var(--claude-color)');
    expect(markup).toContain('aria-label="Missing measurement: Unavailable"');
  });
  test('empty charts and rates have explicit empty states', () => {
    expect(
      renderToStaticMarkup(createElement(AnalyticsChart, { title: 'Empty', data: [] }))
    ).toContain('No samples');
    expect(
      renderToStaticMarkup(
        createElement(ModelRates, { data: { ...analyticsUiResponse, rates: [] } })
      )
    ).toContain('No model rates');
  });
  test('all locale keys and interpolation placeholders match', () => {
    const flatten = (value: Record<string, unknown>, prefix = ''): Record<string, string> =>
      Object.fromEntries(
        Object.entries(value).flatMap(([key, child]) =>
          typeof child === 'string'
            ? [[prefix + key, child]]
            : Object.entries(flatten(child as Record<string, unknown>, `${prefix}${key}.`))
        )
      );
    const dictionaries = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko'].map((locale) =>
      flatten(JSON.parse(read(`src/i18n/locales/${locale}.json`)).analytics)
    );
    for (const dictionary of dictionaries) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(dictionaries[0]).sort());
      for (const [key, value] of Object.entries(dictionary)) {
        expect(value.trim()).not.toBe('');
        expect(value.match(/{{\w+}}/g)?.sort()).toEqual(
          dictionaries[0][key].match(/{{\w+}}/g)?.sort()
        );
      }
    }
    for (const tab of analyticsTabs) expect(dictionaries[0][`tabs.${tab}`]).toBeTruthy();
  });
});

describe('Analytics address provider', () => {
  const saved = { provider: 'codex', model: 'm', outcome: 'failed' as const, search: 's' };
  test('a provider in the address starts a fresh view, so remembered filters cannot narrow it', () => {
    expect(startingFilters('claude', saved)).toEqual({
      provider: 'claude',
      model: undefined,
      outcome: 'all',
      search: undefined,
    });
  });
  test('without one, the remembered filters are restored', () => {
    expect(startingFilters(undefined, saved)).toEqual(saved);
    expect(startingFilters(undefined, {})).toMatchObject({ outcome: 'all' });
  });
  test('only a short non-empty value is taken from the address', () => {
    expect(addressProvider(' claude ')).toBe('claude');
    expect(addressProvider('')).toBeUndefined();
    expect(addressProvider('   ')).toBeUndefined();
    expect(addressProvider(null)).toBeUndefined();
    expect(addressProvider('x'.repeat(201))).toBeUndefined();
  });
});

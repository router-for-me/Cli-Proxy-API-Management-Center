/**
 * Mock management API for eyeballing the quota board without a live backend.
 *
 * The real server's management key is bcrypt-hashed in config and unavailable,
 * so this stands in: it accepts any bearer token, serves the built panel, and
 * answers the handful of endpoints the quota page touches.
 *
 * Every upstream quota call funnels through POST /api-call, so the fake data
 * below is written in each provider's *upstream* JSON shape and goes through
 * the app's real parsers — which is the point. A shortcut that injected store
 * state directly would prove nothing about the parsing or the polarity.
 *
 *   bun devtools/mock/serve.ts        # http://localhost:8899
 */

const PORT = 8899;
const PREFIX = '/v0/management'; // MANAGEMENT_API_PREFIX

const DIST = new URL('../../dist/index.html', import.meta.url).pathname;

/* ---------------------------------------------------------------- helpers */

const iso = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 3600_000).toISOString();

const unix = (hoursFromNow: number) =>
  Math.floor((Date.now() + hoursFromNow * 3600_000) / 1000);

/** Claude/Codex report *utilization* (percent used), so remaining = 100 - this. */
const used = (percent: number) => percent;

/* ------------------------------------------------------------ credentials */

interface Cred {
  name: string;
  provider: string;
  label: string;
  authIndex: string;
  /** Antigravity resolves its quota URL per project and errors without one. */
  projectId?: string;
}

const CREDENTIALS: Cred[] = [
  { provider: 'claude', label: 'alice@example.com', name: 'claude-alice@example.com.json', authIndex: 'c1' },
  { provider: 'claude', label: 'bob@example.com', name: 'claude-bob@example.com.json', authIndex: 'c2' },
  { provider: 'claude', label: 'carol@example.com', name: 'claude-carol@example.com.json', authIndex: 'c3' },
  { provider: 'claude', label: 'dave@example.net', name: 'claude-dave@example.net.json', authIndex: 'c4' },
  { provider: 'antigravity', label: 'erin@example.com', name: 'antigravity-erin@example.com.json', authIndex: 'a1', projectId: 'mock-project' },
  { provider: 'codex', label: 'erin@example.com', name: 'codex-aa757fd4-erin@example.com-plus.json', authIndex: 'x1' },
  { provider: 'codex', label: 'frank@example.com', name: 'codex-frank@example.com-plus.json', authIndex: 'x2' },
  { provider: 'kimi', label: 'kimi-overnight', name: 'kimi-1784497263307.json', authIndex: 'k1' },
];

/* ------------------------------------------- per-credential upstream data */

/**
 * Claude usage: named window keys (five_hour, seven_day, seven_day_opus, …),
 * each `{utilization, resets_at}`. `utilization` is percent USED.
 *
 * Spread across the range so the colour thresholds are all visible: two
 * credentials nearly exhausted (red), one mid (amber), one healthy (green).
 */
const CLAUDE_USAGE: Record<string, unknown> = {
  c1: {
    five_hour: { utilization: used(0), resets_at: iso(3) },
    seven_day: { utilization: used(100), resets_at: iso(6) },
    seven_day_opus: { utilization: used(93), resets_at: iso(6) },
  },
  c2: {
    five_hour: { utilization: used(0), resets_at: iso(2) },
    seven_day: { utilization: used(73), resets_at: iso(96) },
    seven_day_opus: { utilization: used(100), resets_at: iso(96) },
  },
  c3: {
    five_hour: { utilization: used(2), resets_at: iso(1) },
    seven_day: { utilization: used(98), resets_at: iso(25) },
    seven_day_opus: { utilization: used(92), resets_at: iso(25) },
    // The one account carrying paid overflow — exercises the extra-usage row.
    extra_usage: { is_enabled: true, monthly_limit: 10, used_credits: 2.62, utilization: 26.2 },
  },
  c4: {
    five_hour: { utilization: used(19), resets_at: iso(4) },
    seven_day: { utilization: used(86), resets_at: iso(72) },
    seven_day_opus: { utilization: used(100), resets_at: iso(72) },
  },
};

const CLAUDE_PROFILE = (label: string) => ({
  account: { email: label, has_claude_max: true },
  organization: { name: 'Example Org', billing_type: 'max' },
});

/** Codex: nested rate_limit with primary/secondary windows, used_percent. */
const CODEX_USAGE: Record<string, unknown> = {
  x1: {
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      primary_window: { used_percent: used(8), limit_window_seconds: 18000, reset_at: unix(2) },
      secondary_window: { used_percent: used(36), limit_window_seconds: 604800, reset_at: unix(110) },
    },
  },
  x2: {
    plan_type: 'plus',
    rate_limit: {
      allowed: true,
      primary_window: { used_percent: used(0), limit_window_seconds: 18000, reset_at: unix(5) },
      secondary_window: { used_percent: used(12), limit_window_seconds: 604800, reset_at: unix(130) },
    },
  },
};

/** Kimi: raw used/limit counts — remaining is derived, not reported. */
const KIMI_USAGE: Record<string, unknown> = {
  k1: {
    limits: [
      { name: 'Daily limit', detail: { used: 540, limit: 1000, resetAt: iso(9) } },
      { name: 'Monthly limit', detail: { used: 8100, limit: 30000, resetAt: iso(400) } },
    ],
  },
};

/**
 * Antigravity: quota buckets carry REMAINING as a 0..1 fraction — the opposite
 * polarity to Claude/Codex. Getting this backwards renders 100% as nearly-empty.
 */
const ANTIGRAVITY_QUOTA = {
  groups: [
    {
      displayName: 'Gemini models',
      models: ['Gemini Flash', 'Gemini Pro'],
      buckets: [
        {
          displayName: 'Weekly limit',
          window: 'weekly',
          remainingFraction: 1.0,
          resetTime: iso(168),
        },
      ],
    },
    {
      displayName: 'Claude and GPT models',
      models: ['Claude Opus', 'Claude Sonnet', 'GPT-OSS'],
      buckets: [
        {
          displayName: 'Weekly limit',
          window: 'weekly',
          remainingFraction: 0.62,
          resetTime: iso(168),
        },
      ],
    },
  ],
};

/* ------------------------------------------------------------------ routes */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

/** Body the panel's /api-call proxy expects back. */
const upstream = (body: unknown, statusCode = 200) =>
  json({ status_code: statusCode, header: {}, body });

function handleApiCall(payload: { url?: string; authIndex?: string }): Response {
  const url = String(payload.url ?? '');
  const idx = String(payload.authIndex ?? '');
  const cred = CREDENTIALS.find((c) => c.authIndex === idx);

  if (url.includes('/oauth/usage')) return upstream(CLAUDE_USAGE[idx] ?? {});
  if (url.includes('/oauth/profile')) return upstream(CLAUDE_PROFILE(cred?.label ?? 'unknown'));
  if (url.includes('/wham/usage')) return upstream(CODEX_USAGE[idx] ?? {});
  // Top-level `available_count` / `credits` — the normalizer rejects anything
  // that doesn't carry one of those keys at the root.
  if (url.includes('/wham/rate-limit-reset-credits')) {
    return upstream({ available_count: 1, credits: [] });
  }
  if (url.includes('kimi.com')) return upstream(KIMI_USAGE[idx] ?? {});
  if (url.includes('retrieveUserQuotaSummary')) return upstream(ANTIGRAVITY_QUOTA);
  if (url.includes('loadCodeAssist')) return upstream({ cloudaicompanionProject: 'mock-project' });

  // Unknown upstream: 404 so the card shows a real error rather than pretending.
  return upstream({ error: `mock: unhandled upstream ${url}` }, 404);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        },
      });
    }

    // The built panel, at both paths the app may be served from.
    if (pathname === '/' || pathname === '/management.html') {
      return new Response(Bun.file(DIST), { headers: { 'content-type': 'text/html' } });
    }

    if (!pathname.startsWith(PREFIX)) return new Response('not found', { status: 404 });
    const route = pathname.slice(PREFIX.length);

    // Login succeeds iff /config succeeds — no key check, any bearer is fine.
    if (route === '/config') {
      return json({
        'remote-management': { 'allow-remote': false },
        debug: false,
        port: 8317,
      });
    }

    if (route === '/auth-files') {
      return json({
        files: CREDENTIALS.map((c) => ({
          name: c.name,
          provider: c.provider,
          type: c.provider,
          label: c.label,
          email: c.label,
          auth_index: c.authIndex,
          ...(c.projectId ? { project_id: c.projectId } : {}),
          disabled: false,
          size: 2048,
          modified: iso(-24),
        })),
      });
    }

    if (route === '/api-call' && req.method === 'POST') {
      return handleApiCall((await req.json()) as { url?: string; authIndex?: string });
    }

    // Everything else the shell polls for — answer emptily rather than 404,
    // so an unrelated panel widget can't red-box over the board.
    return json({});
  },
});

console.log(`mock management API on http://localhost:${server.port}`);
console.log(`serving ${DIST}`);

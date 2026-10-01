import type { AxiosAdapter } from 'axios';
import type { AuthFileItem } from '@/types';
import type { ApiCallRequest } from '@/services/api/apiCall';

type Scenario = 'available' | 'exhausted' | 'ineligible' | 'ambiguous';
const accounts: { email: string; scenario: Scenario }[] = [
  { email: 'alex.max@example.invalid', scenario: 'available' },
  { email: 'design.team@example.invalid', scenario: 'exhausted' },
  { email: 'sam.free@example.invalid', scenario: 'ineligible' },
  { email: 'retry.max@example.invalid', scenario: 'ambiguous' },
];
export const demoFiles: AuthFileItem[] = accounts.map(({ email, scenario }, index) => ({
  name: `claude-${email}.json`,
  email,
  type: 'claude',
  provider: 'claude',
  authIndex: `demo-${scenario}`,
  status: 'active',
  disabled: false,
  size: 1824 + index * 128,
}));
const isoAfter = (hours: number) => new Date(Date.now() + hours * 3600000).toISOString();
const organization = '00000000-0000-4000-8000-000000000001';

/** In-memory, fail-closed Axios transport. No request is forwarded to an adapter. */
export function installDemoTransport(): AxiosAdapter {
  const states = new Map(
    accounts.map(({ scenario }) => [
      `demo-${scenario}`,
      {
        scenario,
        left: scenario === 'exhausted' ? 0 : 2,
        reset: false,
        pending: '',
        completed: new Set<string>(),
      },
    ])
  );
  return async (config) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const method = config.method?.toUpperCase();
    const path = config.url;
    let data: unknown;
    if (method === 'GET' && path === '/config') {
      data = {};
    } else if (method === 'GET' && path === '/credentials') {
      data = { files: demoFiles, total: demoFiles.length };
    } else if (method === 'GET' && path === '/plugins') {
      data = { plugins: [] };
    } else if (method === 'POST' && path === '/requests/api-call') {
      const payload = (
        typeof config.data === 'string' ? JSON.parse(config.data) : config.data
      ) as ApiCallRequest;
      const state = states.get(payload.authIndex ?? '');
      if (!state) throw new Error('Demo: unknown account');
      const url = new URL(payload.url);
      if (url.origin !== 'https://api.anthropic.com') throw new Error('Demo: blocked upstream');
      let body: unknown;
      if (payload.method === 'GET' && url.pathname === '/api/oauth/profile') {
        body = {
          organization: {
            uuid: organization,
            organization_type: state.scenario === 'exhausted' ? 'claude_team' : 'claude_pro',
            subscription_status: 'active',
          },
          account: { has_claude_max: state.scenario !== 'ineligible', has_claude_pro: false },
        };
      } else if (payload.method === 'GET' && url.pathname === '/api/oauth/usage') {
        body = {
          five_hour: {
            utilization: state.reset ? 0 : state.scenario === 'ineligible' ? 38 : 100,
            resets_at: isoAfter(2.5),
          },
          seven_day: {
            utilization: state.reset ? 0 : state.scenario === 'exhausted' ? 96 : 72,
            resets_at: isoAfter(96),
          },
          seven_day_sonnet: { utilization: state.reset ? 0 : 43, resets_at: isoAfter(96) },
          extra_usage: {
            is_enabled: state.scenario === 'available',
            monthly_limit: 5000,
            used_credits: 1250,
            utilization: 25,
          },
          cedar_ember: {
            eligible: state.scenario !== 'ineligible',
            ineligible_reason: state.scenario === 'ineligible' ? 'tier' : null,
            next_grant_id: 'demo_grant',
            at_limit: !state.reset && state.scenario !== 'ineligible',
            grants:
              state.scenario === 'ineligible'
                ? []
                : [
                    ...(state.scenario === 'available'
                      ? [
                          {
                            id: 'a_backup',
                            label: '备用重置',
                            resets_total: 1,
                            resets_left: 1,
                            usable_now: true,
                            use_requires_limit: true,
                          },
                        ]
                      : []),
                    {
                      id: 'demo_grant',
                      label: 'Claude Max · 每周储备重置',
                      resets_total: 3,
                      resets_left: state.left,
                      ends_at: isoAfter(168),
                      clears: ['five_hour', 'seven_day'],
                      usable_now: true,
                      use_requires_limit: true,
                    },
                  ],
          },
        };
      } else if (
        payload.method === 'POST' &&
        url.pathname === `/api/organizations/${organization}/reset_rate_limits`
      ) {
        const claim = JSON.parse(payload.data ?? '{}') as {
          grant_id?: string;
          request_id?: string;
        };
        if (claim.grant_id !== 'demo_grant' || !claim.request_id)
          throw new Error('Demo: invalid claim');
        if (state.completed.has(claim.request_id)) {
          body = { result: 'already_used' };
        } else if (state.scenario === 'ineligible' || state.left <= 0 || state.reset) {
          throw new Error('Demo: unavailable grant');
        } else {
          if (state.scenario === 'ambiguous' && !state.pending) {
            state.pending = claim.request_id;
            throw new Error('Demo: simulated unknown outcome');
          }
          if (state.pending && state.pending !== claim.request_id)
            throw new Error('Demo: retry identity changed');
          state.completed.add(claim.request_id);
          state.left -= 1;
          state.reset = true;
          body = { result: 'reset' };
        }
      } else {
        throw new Error(`Demo: unsupported upstream route ${payload.method} ${url.pathname}`);
      }
      data = { status_code: 200, header: {}, body };
    } else {
      throw new Error(`Demo: blocked management route ${method} ${path}`);
    }
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
}

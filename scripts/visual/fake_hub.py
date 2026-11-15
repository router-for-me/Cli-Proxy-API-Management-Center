"""Two fake CLI-Proxy hubs answered at the network layer of a Playwright context.

Works the same against `bun run dev`, `vite preview` of the single-file build, or the deployed
container: every /v8/management, /prox and discovery request is fulfilled here and anything else
that is not a same-origin static asset is aborted, so nothing reaches a real hub.

All data is synthetic (example.invalid accounts, no token-like fields). The fake applies the
backend's model rule from CLIProxyAPI v8.0.44 sdk/cliproxy/service_models.go: an account's own
non-empty excluded_models list REPLACES the provider list; an empty or missing list inherits it
(a runtime_only credential has no file, so it always inherits); disabled accounts register no
models. Exclusion patterns are case-insensitive, '*' = any run.

Scenarios: default | loading | empty | error | partial | many (12 Claude accounts) | wide (21 Claude
models, for sideways scrolling) | shared (the GPT hub also has Claude accounts, so one provider tab
shows a section per hub) | aligned (six Claude accounts on the first hub whose quota reads differ in
windows, billing text and held resets, so a row of cards must still line up section by section; every
read succeeds) | real (one operator's shape: four Claude accounts, two sharing a name before the @,
twenty Claude models of which four are on for every account through the provider list) |
claude-cards (four Claude Max accounts shaped like a real hub: three usage bars, active billing with an
estimated renewal, three or four reset grants with long upstream descriptions, and extra usage off
with spend and limit unreported) | disabled (the default hubs with team-b and codex-spare switched off
too: the hub still reads a disabled credential's quota, so pro-c and codex-spare load while off and
team-b's read fails while off; every Claude account holds reset grants) |
served | served-alpha-only | served-floor (prox-history answers: /prox/inventory lists the sources,
/prox/accounts serves Claude and Codex accounts with numbers that differ from what the hubs report,
so a page that shows them proves it read the server; served-alpha-only lists only the Claude hub, so
the GPT hub stays hub-direct; served-floor answers every targeted refresh with the 20 s floor and the
page-wide one with the 4 minute floor). The stale case calls edit_elsewhere().
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import re
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, unquote, urlparse

CATALOG = {
    'claude': ['claude-opus-4-5', 'claude-opus-4-1', 'claude-sonnet-4-5', 'claude-sonnet-4-0',
               'claude-haiku-4-5', 'claude-3-7-sonnet', 'claude-3-5-haiku'],
    'codex': ['gpt-5.5', 'gpt-5.5-codex', 'gpt-5.4', 'gpt-5.4-mini'],
}

HUBS = {
    'alpha': {
        'label': 'Claude hub fixture',
        'providerLists': {'claude': ['claude-3-*', 'claude-sonnet-4-0']},
        'aliases': {'claude': [{'name': 'claude-opus-4-5', 'alias': 'opus'}]},
        'accounts': [
            {'name': 'claude-team-a.json', 'type': 'claude', 'email': 'team-a@example.invalid',
             'disabled': False, 'own': None},
            {'name': 'claude-team-b.json', 'type': 'claude', 'email': 'team-b@example.invalid',
             'disabled': False, 'own': ['claude-3-*', 'claude-opus-4-1'], 'extra': ['claude-preview-x']},
            {'name': 'claude-pro-c.json', 'type': 'claude', 'email': 'pro-c@example.invalid',
             'disabled': True, 'own': None},
            {'name': 'claude-max-d.json', 'type': 'claude', 'email': 'max-d@example.invalid',
             'disabled': False, 'own': None, 'noAccess': ['claude-opus-4-5']},
            # runtime_only: held in memory by the hub (e.g. a websocket channel), no file. It has
            # no list of its own and follows the provider list; config API keys are never listed.
            {'name': 'runtime-channel-fixture', 'type': 'claude', 'email': None, 'disabled': False,
             'own': None, 'runtime': True, 'noAccess': ['claude-opus-4-1', 'claude-sonnet-4-5']},
        ],
    },
    'beta': {
        'label': 'GPT hub fixture',
        'providerLists': {'codex': ['gpt-5.4-mini']},
        'aliases': {},
        'accounts': [
            {'name': 'codex-main.json', 'type': 'codex', 'email': 'main@example.invalid',
             'disabled': False, 'own': None},
            {'name': 'codex-spare.json', 'type': 'codex', 'email': 'spare@example.invalid',
             'disabled': False, 'own': ['gpt-5.4']},
        ],
    },
}

# The 'aligned' scenario: what each Claude account reports. Windows are the usage payload's own keys
# ('fable' is the weekly_scoped limit); billing is the profile's organization block; grants is how
# many reset grants the account holds. Together they make every card's quota rows, Billing block and
# Manual resets box a different size.
ALIGNED_CLAUDE = {
    'alpha-0': {'windows': ['seven_day', 'fable'], 'billing': 'stripe', 'grants': 2},
    'alpha-1': {'windows': ['five_hour', 'seven_day', 'fable'], 'billing': 'other', 'grants': 0},
    'alpha-2': {'windows': ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'],
                'billing': 'canceled', 'grants': 1},
    'alpha-3': {'windows': ['five_hour'], 'billing': None, 'grants': 3},
    'alpha-4': {'windows': ['five_hour', 'seven_day', 'seven_day_opus', 'fable'],
                'billing': 'stripe', 'grants': 1},
    'alpha-5': {'windows': ['seven_day', 'fable'], 'billing': 'other', 'grants': 2},
}
ALIGNED_ACCOUNTS = [
    {'name': f'claude-slot-{letter}.json', 'type': 'claude', 'email': f'slot-{letter}@example.invalid',
     'disabled': False, 'own': None}
    for letter in 'abcdef']

# The 'claude-cards' scenario: grants per account as (id, kind field, upstream label, ends_at). The
# labels are the long descriptions Anthropic sends; the kind comes from `type` or
# `gives_back_weekly`, as resetKind() reads it.
CARD_GRANTS = {
    'weekly': ('weekly-free', {'type': 'weekly'}, 'Free limit reset', '2030-12-16T04:59:00Z'),
    'full-nov': ('full-nov', {'type': 'full'}, 'One full limit reset (November 2026)',
                 '2030-12-10T22:00:00Z'),
    'full-free': ('full-free', {'type': 'full'}, 'Free limit reset', '2030-12-16T04:59:00Z'),
    'fable-launch': ('fable-launch', {'gives_back_weekly': True},
                     'New model launch: one Fable reset for Max, Team Premium and Enterprise Premium',
                     '2031-03-09T07:59:00Z'),
    'fable-tenure': ('fable-tenure', {'gives_back_weekly': True},
                     "New model launch: one more Fable reset at 6 months' tenure",
                     '2031-03-09T07:59:00Z'),
}
CARD_CLAUDE = {
    'alpha-0': {'grants': ['weekly', 'fable-launch', 'fable-tenure', 'full-nov'], 'user_disabled': True},
    'alpha-1': {'grants': ['full-nov', 'full-free', 'fable-launch'], 'user_disabled': False},
    'alpha-2': {'grants': ['full-nov', 'full-free', 'fable-launch'], 'user_disabled': False},
    'alpha-3': {'grants': ['weekly', 'full-free', 'fable-launch'], 'user_disabled': True},
}
CARD_ACCOUNTS = [
    {'name': f'claude-{slug}.json', 'type': 'claude', 'email': f'{slug}@example.invalid',
     'disabled': False, 'own': None}
    for slug in ('ops-work', 'ops-mail', 'research', 'personal')]

# The 'real' scenario: four models on, every older one off in the provider list, which all four
# accounts follow.
REAL_ON = ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']
REAL_OFF = ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5',
            'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6',
            'claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-1',
            'claude-sonnet-4-0', 'claude-3-7-sonnet', 'claude-3-5-haiku', 'claude-3-opus']
REAL_ACCOUNTS = [
    {'name': f'claude-{slug}.json', 'type': 'claude', 'email': email, 'disabled': False, 'own': None}
    for slug, email in [('ops-work', 'ops@work.example.invalid'),
                        ('ops-mail', 'ops@mail.example.invalid'),
                        ('research', 'research@work.example.invalid'),
                        ('personal', 'ops@home.example.invalid')]]

DISCOVERY = {
    'schemaVersion': 1, 'revision': 'b' * 64, 'defaultInstanceId': 'alpha',
    'sources': [
        {'instanceId': 'alpha', 'label': HUBS['alpha']['label'], 'publicBasePath': '/alpha',
         'aliases': [''], 'authScope': 'fixture'},
        {'instanceId': 'beta', 'label': HUBS['beta']['label'], 'publicBasePath': '/beta',
         'aliases': [], 'authScope': 'fixture'},
    ],
}

STATIC = re.compile(r'^/(?:$|index\.html$|management\.html$|src/|node_modules/|@vite/|@react-refresh|@fs/|'
                    r'@id/|assets/|favicon|logo|.*\.(?:js|mjs|css|scss|svg|png|jpg|woff2?|ttf|json|ts|tsx)$)')


def matches(rule: str, model: str) -> bool:
    pattern, value = rule.strip().lower(), model.lower()
    if '*' not in pattern:
        return pattern == value
    regex = '.*'.join(re.escape(part) for part in pattern.split('*'))
    return re.fullmatch(regex, value) is not None


RATE_LIMITED_MESSAGE = json.dumps({'type': 'error', 'error': {
    'type': 'rate_limit_error', 'message': "This request would exceed your account's rate limit."}})

class FakeHubs:
    def __init__(self, scenario: str = 'default'):
        self.scenario = scenario
        self.hubs = copy.deepcopy(HUBS)
        if scenario == 'empty':
            for hub in self.hubs.values():
                hub['accounts'] = []
        self.catalog = copy.deepcopy(CATALOG)
        if scenario == 'wide':
            self.catalog['claude'] += [f'claude-fixture-{n:02d}' for n in range(1, 15)]
        if scenario == 'shared':
            self.hubs['beta']['providerLists']['claude'] = ['claude-opus-4-1']
            self.hubs['beta']['accounts'] += [
                {'name': 'claude-gpt-hub.json', 'type': 'claude', 'email': 'gpt-hub@example.invalid',
                 'disabled': False, 'own': None},
                {'name': 'claude-gpt-own.json', 'type': 'claude', 'email': 'gpt-own@example.invalid',
                 'disabled': False, 'own': ['claude-haiku-4-5']},
            ]
        if scenario == 'aligned':
            self.hubs['alpha']['accounts'] = copy.deepcopy(ALIGNED_ACCOUNTS)
        if scenario == 'claude-cards':
            self.hubs['alpha']['accounts'] = copy.deepcopy(CARD_ACCOUNTS)
        if scenario == 'real':
            self.catalog['claude'] = REAL_ON + REAL_OFF
            self.hubs['alpha']['providerLists'] = {'claude': list(REAL_OFF)}
            self.hubs['alpha']['accounts'] = copy.deepcopy(REAL_ACCOUNTS)
        if scenario == 'rate-limited':
            # The hub's verdict on a blocked credential: the upstream error and when it retries.
            # Two hours ahead: the card hides a retry time that has already passed.
            retry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(hours=2)
            self.hubs['alpha']['accounts'][0]['rate_limited'] = retry.isoformat().replace('+00:00', 'Z')
        if scenario == 'disabled':
            # api-call resolves disabled credentials too (authByIndex scans the whole list).
            for hub, name in (('alpha', 'claude-team-b.json'), ('beta', 'codex-spare.json')):
                next(a for a in self.hubs[hub]['accounts'] if a['name'] == name)['disabled'] = True
        if scenario == 'many':
            self.hubs['alpha']['accounts'][4:4] = [
                {'name': f'claude-seat-{n:02d}.json', 'type': 'claude',
                 'email': f'seat-{n:02d}@example.invalid', 'disabled': False,
                 'own': ['claude-opus-4-1'] if n % 4 == 0 else None}
                for n in range(1, 9)]
        self.writes: list[dict] = []
        self.unexpected: list[str] = []
        self.blocked: list[str] = []
        self.provider_reads = 0
        self.credential_reads = 0
        self.reads: dict[str, int] = {}
        # Every management request, in order: {'source', 'method', 'path', 'authIndex', 'url'}.
        self.log: list[dict] = []
        # Hubs that answer 401 to every management request (a revoked key), and the reply delay.
        self.denied: set[str] = set()
        self.delay = 0.6 if scenario == 'slow' else 0.02
        # prox-history, for the served scenarios: when each account was last read by the server,
        # every targeted refresh it received, and every /prox/accounts answer ('200' or '304').
        self.served = scenario.startswith('served')
        self.served_at: dict[str, int] = {}
        self.server_refreshes: list[dict] = []
        self.accounts_reads: list[str] = []
        self.clock = int(time.time() * 1000)

    def _server_accounts(self) -> list[dict]:
        """What GET /v1/accounts answers: the same shape as server/quota/accounts.ts.

        The numbers are the server's own (weekly 23-59% left) and differ from the hubs' (71% used),
        and the disabled account carries its last stored sample, hours old.
        """
        now = self.clock
        out = []
        for source in ('alpha', 'beta'):
            if self.scenario == 'served-alpha-only' and source == 'beta':
                continue
            for index, account in enumerate(self.hubs[source]['accounts']):
                if account['type'] not in ('claude', 'codex') or account.get('runtime'):
                    continue
                provider = account['type']
                auth_index = f'{source}-{index}'
                digest = hashlib.sha256(f'{provider}\0{auth_index}'.encode()).hexdigest()
                sid = f'{source}:{provider}:{digest}'
                off = account['disabled']
                at = self.served_at.setdefault(sid, now - (5 * 3_600_000 if off else 90_000))
                weekly = 23 + 9 * index
                five = 88 - 7 * index
                key_week = 'seven-day' if provider == 'claude' else 'weekly'
                label = {'claude': ('claude_quota.five_hour', 'claude_quota.seven_day'),
                         'codex': ('codex_quota.primary_window', 'codex_quota.secondary_window')}[provider]
                windows = [
                    {'id': 'five-hour', 'lane': 'five-hour', 'labelKey': label[0], 'remainingPercent': five,
                     'resetAtMs': now + 3_600_000, 'periodHours': 5},
                    {'id': key_week, 'lane': 'weekly', 'labelKey': label[1], 'remainingPercent': weekly,
                     'resetAtMs': now + 2 * 86_400_000, 'periodHours': 168},
                ]
                entry = {
                    'id': f'acct-{sid[-8:]}', 'sourceAccountId': sid, 'instanceId': source,
                    'provider': provider, 'disabled': off, 'status': 'disabled' if off else 'ok',
                    'observedAtMs': at, 'label': f'{provider.title()} {index + 1}',
                    'identifier': 'a\u2022\u2022\u2022@example.invalid',
                    'plan': {'label': 'Max' if provider == 'claude' else 'Plus', 'known': True,
                             'type': 'default_claude_max' if provider == 'claude' else 'plus'},
                    'windows': windows, 'resets': None, 'billing': None,
                }
                if provider == 'claude' and not off:
                    entry['windows'].append({'id': 'seven-day-opus', 'lane': 'model',
                                             'labelKey': 'claude_quota.seven_day_opus',
                                             'remainingPercent': 64, 'resetAtMs': now + 2 * 86_400_000,
                                             'periodHours': 168})
                    entry['extraUsage'] = {'isEnabled': True, 'monthlyLimit': 5000, 'usedCredits': 1200,
                                           'utilization': 24, 'currency': 'USD', 'disabledReason': None,
                                           'userDisabled': False, 'spendLimitReached': False}
                    entry['dollarWindows'] = []
                if provider == 'claude' and index == 0:
                    entry['resets'] = {'available': 2, 'usable': 1, 'blocker': None,
                                       'nextExpiryAtMs': now + 4 * 86_400_000,
                                       'expiries': [now + 4 * 86_400_000, now + 9 * 86_400_000],
                                       'kinds': ['weekly', 'fable'], 'observedAtMs': at}
                out.append(entry)
        return out

    def _server_inventory(self) -> list[dict]:
        sources = [{'instanceId': 'alpha', 'provider': 'claude', 'state': 'ok', 'accounts': []}]
        if self.scenario != 'served-alpha-only':
            sources.append({'instanceId': 'beta', 'provider': 'codex', 'state': 'ok', 'accounts': []})
        return sources

    async def _prox(self, route, path, method, request) -> bool:
        """prox-history: the inventory, the account read model and the targeted/full refresh."""
        if path == '/prox/inventory' and method == 'get':
            await self._json(route, {'version': f'fixture-{len(self.writes)}', 'syncedAtMs': self.clock,
                                     'sources': self._server_inventory()})
            return True
        if path == '/prox/accounts' and method == 'get':
            accounts = self._server_accounts()
            rest = {'accounts': accounts, 'lastRefreshAtMs': self.clock - 60_000,
                    'nextRefreshAtMs': self.clock + 180_000, 'refreshing': False}
            version = hashlib.sha256(json.dumps(rest, sort_keys=True).encode()).hexdigest()[:24]
            if request.headers.get('if-none-match') == f'"{version}"':
                self.accounts_reads.append('304')
                await route.fulfill(status=304, headers={'etag': f'"{version}"'})
                return True
            self.accounts_reads.append('200')
            await route.fulfill(status=200, content_type='application/json',
                                headers={'etag': f'"{version}"'},
                                body=json.dumps({'version': version, **rest}))
            return True
        if path == '/prox/refresh' and method == 'post':
            try:
                body = json.loads(request.post_data or '{}')
            except ValueError:
                body = {}
            account_id = body.get('accountId') if isinstance(body, dict) else None
            self.server_refreshes.append({'accountId': account_id})
            if self.scenario == 'served-floor':
                if account_id:
                    await self._json(route, {'refreshed': False, 'retryAtMs': self.clock + 15_000})
                else:
                    await self._json(route, {'refreshing': False, 'lastRefreshAtMs': self.clock - 60_000,
                                             'nextRefreshAtMs': self.clock + 180_000}, 202)
                return True
            if account_id:
                self.served_at[account_id] = self.clock
                await self._json(route, {'refreshed': True, 'retryAtMs': None})
            else:
                for entry in self._server_accounts():
                    self.served_at[entry['sourceAccountId']] = self.clock
                await self._json(route, {'refreshing': False, 'lastRefreshAtMs': self.clock,
                                         'nextRefreshAtMs': self.clock + 300_000}, 202)
            return True
        return False

    def edit_elsewhere(self) -> None:
        """Another operator edits the claude provider list (the stale-preview scenario)."""
        self.hubs['alpha']['providerLists'].setdefault('claude', []).append('claude-haiku-4-5')

    def served(self, hub: dict, account: dict) -> list[str]:
        if account['disabled']:
            return []
        own = account.get('own') or []
        rules = own if own else hub['providerLists'].get(account['type'], [])
        ids = self.catalog.get(account['type'], []) + account.get('extra', [])
        return [i for i in ids if i not in account.get('noAccess', []) and not any(matches(r, i) for r in rules)]

    async def handle(self, route, origin_netloc: str) -> None:
        request = route.request
        url = urlparse(request.url)
        method = request.method.lower()
        if url.netloc != origin_netloc:
            self.blocked.append(f'{request.method} {url.netloc}{url.path}')
            await route.abort()
            return
        path = url.path
        if path == '/prox/sources.json':
            await self._json(route, DISCOVERY)
            return
        api = re.match(r'^/(?:(alpha|beta)/)?v8/management(/.*)$', path)
        prox = re.match(r'^/(?:(alpha|beta)/)?v8/management/prox(/.*)$', path) or re.match(r'^/prox(/.*)$', path)
        if not api and not prox:
            if STATIC.match(path):
                await route.continue_()
            else:
                self.blocked.append(f'{request.method} {path}')
                await route.abort()
            return
        source = (api.group(1) if api else None) or 'alpha'
        sub = api.group(2) if api else '/prox' + prox.groups()[-1]
        entry = {'source': source, 'method': method, 'path': sub}
        if sub == '/requests/api-call' and request.post_data:
            try:
                call = json.loads(request.post_data)
                entry.update(authIndex=call.get('authIndex'), url=call.get('url'),
                             proxied=str(call.get('method', 'GET')).upper())
            except ValueError:
                pass
        self.log.append(entry)
        await asyncio.sleep(self.delay)
        if source in self.denied and not sub.startswith('/prox'):
            return await self._fail(route, 401, 'Synthetic hub: wrong management key')
        await self._api(route, source, method, sub, parse_qs(url.query), request)

    @staticmethod
    def _aligned_usage(variant: dict, soon: str, grants_read: bool) -> dict:
        if grants_read:
            return {'cedar_ember': {'eligible': True, 'at_limit': False, 'grants': [
                {'id': f'grant-{n}', 'label': f'Weekly reset {n + 1}', 'resets_total': 2,
                 'resets_left': 1, 'ends_at': f'203{n}-01-01T00:00:00Z', 'usable_now': True,
                 'use_requires_limit': True, 'clears': ['five_hour', 'seven_day']}
                for n in range(variant['grants'])]}}
        payload = {key: {'utilization': 20 + 17 * n, 'resets_at': soon}
                   for n, key in enumerate(variant['windows']) if key != 'fable'}
        if 'fable' in variant['windows']:
            payload['limits'] = [{'kind': 'weekly_scoped', 'is_active': True, 'percent': 33,
                                  'resets_at': soon, 'scope': {'model': {'display_name': 'Fable 5'}}}]
        return payload

    @staticmethod
    def _card_usage(variant: dict, soon: str, grants_read: bool) -> dict:
        if grants_read:
            grants = []
            for key in variant['grants']:
                grant_id, kind, label, ends = CARD_GRANTS[key]
                grants.append({'id': grant_id, **kind, 'label': label, 'resets_total': 1,
                               'resets_left': 1, 'ends_at': ends, 'usable_now': True,
                               'use_requires_limit': False, 'clears': ['five_hour', 'seven_day']})
            return {'cedar_ember': {'eligible': True, 'at_limit': False, 'grants': grants}}
        return {'five_hour': {'utilization': 0, 'resets_at': soon},
                'seven_day': {'utilization': 0, 'resets_at': soon},
                'limits': [{'kind': 'weekly_scoped', 'is_active': True, 'percent': 42,
                            'resets_at': soon, 'scope': {'model': {'display_name': 'Fable 5'}}}],
                'extra_usage': {'is_enabled': False, 'monthly_limit': None, 'used_credits': None,
                                'utilization': None, 'currency': None,
                                'user_disabled': variant['user_disabled']}}

    @staticmethod
    def _aligned_profile(variant: dict) -> dict:
        kind = variant['billing']
        if kind is None:
            return {'account': {'has_claude_max': True}}
        return {'account': {'has_claude_max': True}, 'organization': {
            'subscription_status': 'canceled' if kind == 'canceled' else 'active',
            'subscription_created_at': '2025-03-31T10:00:00Z',
            'billing_type': 'stripe_subscription' if kind == 'stripe' else 'apple_subscription'}}

    async def _json(self, route, body, status=200):
        await route.fulfill(status=status, content_type='application/json', body=json.dumps(body),
                            headers={'x-cpa-version': 'fixture-1.0.0', 'x-cpa-support-plugin': 'false'})

    async def _fail(self, route, status, message):
        await self._json(route, {'error': message}, status)

    async def _api(self, route, source, method, path, query, request):
        hub = self.hubs[source]
        q = lambda key: (query.get(key) or [''])[0]
        body = {}
        if method in ('put', 'patch', 'post', 'delete') and request.post_data:
            try:
                body = json.loads(request.post_data)
            except ValueError:
                body = {}
        find = lambda name: next((a for a in hub['accounts'] if a['name'] == name), None)
        if method == 'get':
            self.reads[path] = self.reads.get(path, 0) + 1

        if path == '/credentials' and method == 'get':
            self.credential_reads += 1
            if self.scenario == 'loading':
                await asyncio.sleep(3600)
            if self.scenario == 'error' and source == 'alpha':
                return await self._fail(route, 502, 'Synthetic hub unreachable')
            return await self._json(route, {'files': [
                {'name': a['name'], 'type': a['type'], 'provider': a['type'], 'auth_index': f'{source}-{i}',
                 **({'email': a['email']} if a['email'] else {}), 'disabled': a['disabled'],
                 'status': 'disabled' if a['disabled'] else 'active',
                 **({'status': 'error', 'unavailable': True, 'next_retry_after': a['rate_limited'],
                     'status_message': RATE_LIMITED_MESSAGE} if a.get('rate_limited') else {}),
                 **({'runtime_only': True, 'source': 'memory', 'size': 0} if a.get('runtime')
                    else {'runtime_only': False, 'source': 'file', 'size': 512})}
                for i, a in enumerate(hub['accounts'])]})
        if path == '/credentials/models':
            account = find(q('name'))
            ids = self.served(hub, account) if account else []
            return await self._json(route, {'models': [{'id': i, 'display_name': i} for i in ids]})
        if path == '/credentials/download':
            account = find(q('name'))
            if not account or account.get('runtime'):
                return await self._fail(route, 404, 'not found')
            file_body = {'type': account['type'], 'email': account['email']}
            if account.get('own') is not None:
                file_body['excluded_models'] = account['own']
            return await route.fulfill(status=200, content_type='application/json', body=json.dumps(file_body))
        if path == '/credentials/fields' and method == 'patch':
            ok = not (self.scenario == 'partial' and body.get('name') == 'claude-team-b.json')
            self.writes.append({'source': source, 'method': method, 'path': path, 'body': body, 'ok': ok})
            if not ok:
                return await self._fail(route, 500, 'Synthetic write failure')
            account = find(body.get('name'))
            if not account:
                return await self._fail(route, 404, 'auth file not found')
            key = 'excluded_models' if 'excluded_models' in body else 'excluded-models' if 'excluded-models' in body else None
            if key:
                value = body[key]
                account['own'] = value if isinstance(value, list) and value else None
            return await self._json(route, {'status': 'ok'})
        if path == '/credentials/status' and method == 'patch':
            account = find(body.get('name'))
            self.writes.append({'source': source, 'method': method, 'path': path, 'body': body, 'ok': bool(account)})
            if not account:
                return await self._fail(route, 404, 'auth file not found')
            account['disabled'] = body.get('disabled') is True
            return await self._json(route, {'status': 'ok', 'disabled': account['disabled']})
        if path == '/config/oauth/excluded-models' and method == 'get':
            self.provider_reads += 1
            return await self._json(route, hub['providerLists'])
        if path == '/config/oauth/excluded-models' and method == 'put':
            self.writes.append({'source': source, 'method': method, 'path': path, 'body': body, 'ok': True})
            hub['providerLists'] = body
            return await self._json(route, {'status': 'ok'})
        if path == '/config/oauth/model-alias' and method == 'get':
            return await self._json(route, hub['aliases'])
        if path.startswith('/routing/model-definitions/'):
            channel = unquote(path.rsplit('/', 1)[-1])
            if channel not in self.catalog:
                return await self._fail(route, 400, 'unknown channel')
            return await self._json(route, {'channel': channel,
                                            'models': [{'id': i, 'display_name': i} for i in self.catalog[channel]]})
        if path == '/requests/api-call' and method == 'post':
            # The hub proxies a quota read to the provider. Synthetic usage; team-b's read fails.
            url = str(body.get('url', ''))
            # Only reads are proxied. A write (a reset claim) is refused and is a finding.
            if str(body.get('method', 'GET')).upper() != 'GET':
                self.unexpected.append(f'{source} proxied {body.get("method")} {url}')
                return await self._fail(route, 403, 'Synthetic hub proxies reads only')
            failing = not self.served and (
                self.scenario not in ('default', 'aligned', 'claude-cards', 'many', 'disabled') or (
                    self.scenario in ('default', 'many', 'disabled') and body.get('authIndex') == 'alpha-1'))
            soon = '2030-01-01T00:00:00Z'
            variant = ALIGNED_CLAUDE.get(body.get('authIndex')) if self.scenario == 'aligned' else None
            card = CARD_CLAUDE.get(body.get('authIndex')) if self.scenario == 'claude-cards' else None
            if (self.scenario == 'disabled' or self.served) and 'cedar_ember' in url:
                payload = self._card_usage(CARD_CLAUDE['alpha-1'], soon, True)
            elif card and 'anthropic.com/api/oauth/usage' in url:
                payload = self._card_usage(card, soon, 'cedar_ember' in url)
            elif card and 'anthropic.com/api/oauth/profile' in url:
                payload = self._aligned_profile({'billing': 'stripe'})
            elif variant and 'anthropic.com/api/oauth/usage' in url:
                payload = self._aligned_usage(variant, soon, 'cedar_ember' in url)
            elif variant and 'anthropic.com/api/oauth/profile' in url:
                payload = self._aligned_profile(variant)
            elif 'anthropic.com/api/oauth/usage' in url:
                payload = {'five_hour': {'utilization': 38, 'resets_at': soon},
                           'seven_day': {'utilization': 71, 'resets_at': soon},
                           'seven_day_opus': {'utilization': 12, 'resets_at': soon}}
            elif 'anthropic.com/api/oauth/profile' in url:
                payload = {'account': {'has_claude_max': True}}
            elif 'chatgpt.com/backend-api/wham/usage' in url:
                payload = {'plan_type': 'plus', 'rate_limit': {
                    'primary_window': {'used_percent': 20, 'limit_window_seconds': 18000,
                                       'reset_after_seconds': 3600},
                    'secondary_window': {'used_percent': 55, 'limit_window_seconds': 604800,
                                         'reset_after_seconds': 86400}}}
            else:
                return await self._json(route, {'status_code': 404, 'header': {}, 'body': '{}'})
            if failing:
                return await self._json(route, {'status_code': 401, 'header': {}, 'body': '{}'})
            return await self._json(route, {'status_code': 200, 'header': {},
                                            'body': json.dumps(payload)})
        if self.served and await self._prox(route, path, method, request):
            return
        if path == '/prox/inventory':
            return await self._json(route, {'version': f'fixture-{len(self.writes)}'})
        if path == '/prox/inventory/sync':
            return await self._json(route, {'status': 'ok'})
        if path.startswith('/prox/'):
            return await self._fail(route, 503, 'Synthetic prox-history unavailable')
        if path == '/config':
            return await self._json(route, {'server': {'port': 8319 if source == 'alpha' else 8317},
                                            'access': {'api-keys': []},
                                            'observability': {'logs': {'logging-to-file': True, 'request-log': False}}})
        if path == '/config.yaml':
            return await route.fulfill(status=200, content_type='text/yaml', body='server:\n  port: 8317\n')
        if path == '/config/access/api-keys':
            return await self._json(route, [])
        if path == '/observability/usage/api-keys':
            return await self._json(route, {'providers': {}})
        if path == '/plugins':
            return await self._json(route, {'plugins_enabled': False, 'plugins': []})
        if path == '/server/latest-version':
            return await self._json(route, {'version': 'fixture-1.0.0'})
        self.unexpected.append(f'{source} {method} {path}')
        return await self._fail(route, 501, f'Missing synthetic response: {method} {path}')

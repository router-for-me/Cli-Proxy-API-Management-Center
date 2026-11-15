"""Browser proof for Claude/Codex accounts served from prox-history, against fake hubs only.

    uv run --with playwright python -I scripts/visual/accounts-served-capture.py \
        --url http://127.0.0.1:5199 --out docs/evidence/quota-accounts-read-model [--cases ...]

--url is a local `vite preview` of the single-file build (or `bun run dev`). fake_hub.FakeHubs answers
every management, prox and discovery request at the network layer and aborts anything else that is
not a same-origin static asset, so no real hub, account or key is touched. A reset claim (a proxied
write) is refused by the fake hub and counted as a finding; this script never presses Use or Confirm
in a reset dialog (it closes the dialog with Escape).

Each case records the hub reads the page made (`/requests/api-call`, by auth index and URL), what the
fake prox-history answered, the card text and a screenshot, then asserts what the case claims.
"""
import argparse
import asyncio
import importlib.util
import json
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('fake_hub', Path(__file__).with_name('fake_hub.py'))
fake_hub = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fake_hub)

REFRESH_ICON = 'button[aria-label="Refresh quota only for this credential"]'
CARD_TEXT = '''(name) => {
  const card = [...document.querySelectorAll('main article')].find((a) => a.textContent.includes(name));
  return card ? card.innerText.replace(/\\s+/g, ' ').trim() : null;
}'''


async def login(page, base):
    await page.goto(f'{base}/#/login', wait_until='domcontentloaded', timeout=60000)
    await page.locator('input[type=password]').first.fill('synthetic-fixture-not-a-credential', timeout=30000)
    await page.locator('form button[type=submit], button:has-text("Login")').first.click()
    await page.wait_for_function("location.hash.startsWith('#/quota')", timeout=30000)
    await page.locator('main').wait_for()


def hub_reads(hubs):
    """Quota reads the page sent to a hub: [(source, authIndex, url-kind)]."""
    kinds = []
    for entry in hubs.log:
        if entry['path'] != '/requests/api-call':
            continue
        url = entry.get('url') or ''
        kind = ('grants' if 'cedar_ember' in url else 'claude-usage' if 'oauth/usage' in url
                else 'claude-profile' if 'oauth/profile' in url else 'codex-usage' if 'wham/usage' in url
                else 'other')
        kinds.append((entry['source'], entry.get('authIndex'), kind))
    return kinds


class Case:
    def __init__(self, browser, base, origin, out, slug, scenario, route, width=1440):
        self.browser, self.base, self.origin, self.out = browser, base, origin, out
        self.slug, self.scenario, self.route, self.width = slug, scenario, route, width
        self.notes = {}
        self.checks = []

    async def __aenter__(self):
        height = 1000 if self.width >= 600 else 844
        self.context = await self.browser.new_context(
            viewport={'width': self.width, 'height': height}, is_mobile=self.width < 600,
            has_touch=self.width < 600, locale='en-US', timezone_id='UTC', color_scheme='light',
            reduced_motion='reduce', service_workers='block')
        self.hubs = fake_hub.FakeHubs(self.scenario)
        await self.context.route('**/*', lambda r: self.hubs.handle(r, self.origin.netloc))
        self.page = await self.context.new_page()
        self.page.set_default_timeout(20000)
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        await login(self.page, self.base)
        await self.page.evaluate('(hash) => { location.hash = hash; }', self.route)
        await self.page.locator('main').wait_for()
        return self

    async def __aexit__(self, kind, *_):
        if kind is not None:
            try:
                await self.page.screenshot(path=str(self.out / f'{self.slug}-failure.png'), timeout=15000)
            except Exception:  # noqa: BLE001
                pass
        await self.context.close()

    def check(self, label, ok, detail=None):
        self.checks.append({'check': label, 'ok': bool(ok), **({'detail': detail} if detail is not None else {})})

    async def shot(self, name):
        await self.page.screenshot(path=str(self.out / f'{self.slug}-{name}.png'), timeout=30000)

    async def card(self, name):
        return await self.page.evaluate(CARD_TEXT, name)

    async def finish(self):
        reads = hub_reads(self.hubs)
        result = {
            'scenario': self.scenario, 'route': self.route, 'checks': self.checks,
            'hubReads': reads, 'accountsReads': self.hubs.accounts_reads,
            'serverRefreshes': self.hubs.server_refreshes, 'notes': self.notes,
            'pageErrors': self.errors, 'unexpected': self.hubs.unexpected, 'blocked': self.hubs.blocked,
        }
        result['pass'] = all(c['ok'] for c in self.checks) and not self.errors \
            and not self.hubs.unexpected and not self.hubs.blocked
        return result


async def loaded(page, count):
    await page.wait_for_function(
        '(n) => document.querySelectorAll(\'[data-quota-state="loaded"]\').length >= n', arg=count)


async def case_auth_files_served(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'auth-files-served', 'served', '/auth-files') as c:
        # alpha: team-a, team-b, max-d (enabled) and pro-c (off); beta: codex-main, codex-spare.
        await loaded(c.page, 6)
        await c.page.wait_for_timeout(4500)  # past the 2 s grant read a hub-direct page would make
        text = await c.card('team-a@example.invalid')
        c.notes['team-a'] = text
        c.check('no hub read at all: no usage, profile or grant read', not hub_reads(c.hubs), hub_reads(c.hubs))
        # The server says 7-day 23% left and 5-hour 88% left; the hub would say 29% and 62%.
        c.check('shows the server weekly number (7-day limit 23%)', text and '7-day limit 23%' in text, text)
        c.check('shows the server five-hour number (5-hour limit 88%)', text and '5-hour limit 88%' in text, text)
        c.check('shows the server Opus lane apart from weekly (7-day Opus 64%)', text and '7-day Opus 64%' in text, text)
        c.check('not the hub numbers (29% / 62%)', text and '7-day limit 29%' not in text and '5-hour limit 62%' not in text, text)
        c.check('says how old the reading is', text and 'updated' in text, text)
        c.check('held resets come from the server reading (no grant read)', text and 'Use reset' in text, text)
        off = await c.card('pro-c@example.invalid')
        c.notes['pro-c (off)'] = off
        c.check('the switched-off account shows its stored sample, hours old', off and 'updated 5h ago' in off, off)
        await c.page.evaluate('() => window.dispatchEvent(new Event("focus"))')
        await c.page.wait_for_timeout(800)
        c.check('a poll on focus is a conditional read answered 304', '304' in c.hubs.accounts_reads, c.hubs.accounts_reads)
        await c.shot('fold')
        return await c.finish()


async def case_quota_accounts_served(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'quota-accounts-served', 'served', '/quota/accounts') as c:
        await c.page.wait_for_function(
            "() => [...document.querySelectorAll('main article')].some(a => a.textContent.includes('7-day limit'))")
        await c.page.wait_for_timeout(4500)
        # The Quota page names its cards by file.
        text = await c.card('claude-team-a.json')
        c.notes['team-a'] = text
        c.check('no hub read at all', not hub_reads(c.hubs), hub_reads(c.hubs))
        c.check('shows the server numbers, not the hub ones',
                text and '7-day limit 23%' in text and '7-day limit 29%' not in text, text)
        await c.shot('fold')
        return await c.finish()


async def case_refresh_floor(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'refresh-floor', 'served-floor', '/auth-files') as c:
        await loaded(c.page, 6)
        card = c.page.locator('main article', has_text='team-a@example.invalid').first
        await card.locator(REFRESH_ICON).click()
        await c.page.wait_for_timeout(1200)
        note = await c.page.locator('[role=status], [role=alert]').all_inner_texts()
        notice = ' | '.join(note)
        c.notes['notification'] = notice
        text = await c.card('team-a@example.invalid')
        c.notes['team-a'] = text
        c.check('the targeted refresh went to the server, not the hub',
                len(c.hubs.server_refreshes) == 1 and not hub_reads(c.hubs), c.hubs.server_refreshes)
        c.check('says when it was read and when the next read is', 'was read' in notice and 'next read at' in notice, notice)
        hint = c.page.locator('[data-quota-next-read-at]')
        c.check('the card names the next read time too (short on the card, full as its tooltip)',
                await hint.count() == 1 and re.search(r'· next \d', await hint.first.inner_text()) is not None
                and 'next read at' in (await hint.first.get_attribute('title') or ''),
                await hint.first.inner_text() if await hint.count() else None)
        await c.shot('fold')
        return await c.finish()


async def case_refresh_ran(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'refresh-ran', 'served', '/auth-files') as c:
        await loaded(c.page, 6)
        card = c.page.locator('main article', has_text='team-a@example.invalid').first
        await card.locator(REFRESH_ICON).click()
        await c.page.wait_for_timeout(1500)
        text = await c.card('team-a@example.invalid')
        c.check('one targeted server read, no hub read',
                len(c.hubs.server_refreshes) == 1 and not hub_reads(c.hubs), c.hubs.server_refreshes)
        c.check('the reading is now current', text and re.search(r'updated [0-5]s ago', text), text)
        return await c.finish()


async def click_refresh(c, name):
    """Click a card's own Refresh icon, recording what it looked like when it was clicked."""
    card = c.page.locator('main article', has_text=name).first
    await card.wait_for()
    icon = card.locator(REFRESH_ICON).first
    c.notes[f'refresh icon {name}'] = {
        'count': await card.locator(REFRESH_ICON).count(), 'visible': await icon.is_visible(),
        'disabled': await icon.is_disabled()}
    await icon.scroll_into_view_if_needed()
    await icon.click(timeout=8000)


async def case_other_hub(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'hub-direct-other-hub', 'served-alpha-only', '/auth-files') as c:
        await loaded(c.page, 4)
        await c.page.wait_for_timeout(2500)
        text = await c.card('main@example.invalid')
        c.notes['codex-main before'] = text
        c.check('the GPT hub (not in the inventory) is not read on load either',
                not [r for r in hub_reads(c.hubs) if r[0] == 'beta'], hub_reads(c.hubs))
        c.check('its card is not loaded: nothing serves it yet', text and 'Not loaded' in text, text)
        await click_refresh(c, 'main@example.invalid')
        await c.page.wait_for_function(
            "() => [...document.querySelectorAll('main article')].some(a => a.textContent.includes('main@example.invalid') && a.querySelector('[data-quota-state=\"loaded\"]'))")
        after = await c.card('main@example.invalid')
        c.notes['codex-main after'] = after
        c.check('its Refresh read the hub directly', ('beta', 'beta-0', 'codex-usage') in hub_reads(c.hubs), hub_reads(c.hubs))
        c.check('it shows the hub number (5-hour limit 80% left)', after and '5-hour limit 80%' in after, after)
        c.check('the server never got a targeted refresh for it', not c.hubs.server_refreshes, c.hubs.server_refreshes)
        await c.shot('fold')
        return await c.finish()


async def case_disabled_refresh(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'disabled-refresh', 'served', '/auth-files') as c:
        await loaded(c.page, 6)
        before = await c.card('pro-c@example.invalid')
        c.notes['pro-c before'] = before
        c.check('shows the server stored sample first', before and 'updated 5h ago' in before, before)
        card = c.page.locator('main article', has_text='pro-c@example.invalid').first
        await card.locator(REFRESH_ICON).click()
        await c.page.wait_for_timeout(1800)
        after = await c.card('pro-c@example.invalid')
        c.notes['pro-c after'] = after
        c.check('its explicit Refresh is the live hub read (exception a)',
                ('alpha', 'alpha-2', 'claude-usage') in hub_reads(c.hubs), hub_reads(c.hubs))
        c.check('no targeted server read for the disabled account', not c.hubs.server_refreshes, c.hubs.server_refreshes)
        c.check('the hub reading (5-hour 62%, 7-day 29% left) replaces the stored sample',
                after and '5-hour limit 62%' in after and '7-day limit 29%' in after, after)
        await c.page.evaluate('() => window.dispatchEvent(new Event("focus"))')
        await c.page.wait_for_timeout(800)
        again = await c.card('pro-c@example.invalid')
        c.check('after a poll the hub reading is still shown', again and '7-day limit 29%' in again, again)
        await c.shot('fold')
        return await c.finish()


async def case_claim_dialog(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'claim-dialog-grant-read', 'served', '/auth-files') as c:
        await loaded(c.page, 6)
        await c.page.wait_for_timeout(3000)
        c.check('no grant read before the dialog opens', not hub_reads(c.hubs), hub_reads(c.hubs))
        card = c.page.locator('main article', has_text='team-a@example.invalid').first
        button = card.locator('button', has_text=re.compile('Use reset|Choose a reset|Use reset…'))
        await button.first.click()
        await c.page.locator('[role=dialog]').first.wait_for()
        reads = hub_reads(c.hubs)
        c.notes['reads at dialog open'] = reads
        c.check('opening the claim dialog reads the grants on the hub once (exception b)',
                [r for r in reads if r[2] == 'grants'] == [('alpha', 'alpha-0', 'grants')], reads)
        text = await c.page.locator('[role=dialog]').first.inner_text()
        c.notes['dialog'] = text
        await c.shot('dialog')
        # Never Use or Confirm: close the dialog.
        await c.page.keyboard.press('Escape')
        await c.page.wait_for_timeout(400)
        c.check('no write was proxied (nothing was claimed)', not c.hubs.unexpected, c.hubs.unexpected)
        return await c.finish()


async def case_prox_absent(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'prox-absent', 'default', '/auth-files') as c:
        await c.page.wait_for_timeout(4500)
        c.check('prox-history gave no sources: its accounts were never asked for', not c.hubs.accounts_reads, c.hubs.accounts_reads)
        await click_refresh(c, 'team-a@example.invalid')
        await c.page.wait_for_function(
            "() => [...document.querySelectorAll('main article')].some(a => a.textContent.includes('team-a@example.invalid') && a.querySelector('[data-quota-state=\"loaded\"]'))")
        text = await c.card('team-a@example.invalid')
        c.notes['team-a'] = text
        c.check('Refresh reads the hub (hub-direct as before)',
                ('alpha', 'alpha-0', 'claude-usage') in hub_reads(c.hubs), hub_reads(c.hubs))
        c.check('shows the hub numbers (7-day limit 29% left)', text and '7-day limit 29%' in text, text)
        await c.shot('fold')
        return await c.finish()


async def case_phone(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'auth-files-served-phone', 'served', '/auth-files', width=390) as c:
        await loaded(c.page, 1)
        c.check('no hub read', not hub_reads(c.hubs), hub_reads(c.hubs))
        await c.shot('fold')
        return await c.finish()


async def case_no_five_hour(browser, base, origin, out):
    """A served card for an account with no 5-hour limit says so, on Auth Files and /quota/accounts."""
    async with Case(browser, base, origin, out, 'no-five-hour-auth-files', 'served-no-five-hour', '/auth-files') as c:
        await loaded(c.page, 6)
        await c.page.wait_for_timeout(1500)
        claude = await c.card('team-a@example.invalid')
        codex = await c.card('codex-main')
        plain = await c.card('max-d@example.invalid')
        c.notes.update({'claude (stored null 5-hour window)': claude, 'codex (no 5-hour window)': codex,
                        'claude (reports 5-hour)': plain})
        for label, text in (('Claude', claude), ('Codex', codex)):
            c.check(f'{label} card says "No 5-hour limit"', text and 'No 5-hour limit' in text, text)
            c.check(f'{label} card has no "5-hour limit –"', text and not re.search(r'5-hour limit\s*(–|--)', text), text)
        c.check('the Codex card keeps its weekly number', codex and 'Weekly limit 23%' in codex, codex)
        c.check('an account that reports a 5-hour window is unchanged',
                plain and 'No 5-hour limit' not in plain and re.search(r'5-hour limit \d+%', plain), plain)
        await c.shot('fold')
        return await c.finish()


async def case_no_five_hour_quota_accounts(browser, base, origin, out):
    async with Case(browser, base, origin, out, 'no-five-hour-quota-accounts', 'served-no-five-hour',
                    '/quota/accounts') as c:
        await c.page.wait_for_function(
            "() => [...document.querySelectorAll('main article')].some(a => a.textContent.includes('No 5-hour limit'))")
        text = await c.card('claude-team-a.json')
        codex = await c.card('codex-main')
        c.notes.update({'claude': text, 'codex': codex})
        c.check('Claude card says "No 5-hour limit"', text and 'No 5-hour limit' in text, text)
        c.check('Codex card says "No 5-hour limit"', codex and 'No 5-hour limit' in codex, codex)
        c.check('neither shows "5-hour limit –"', not re.search(r'5-hour limit\s*(–|--)', f'{text} {codex}'), f'{text} {codex}')
        await c.shot('fold')
        return await c.finish()


async def case_no_five_hour_pool(browser, base, origin, out):
    """Quota Management's 5-hour view, from dashboards the real server code built (weekly-only Codex Pro)."""
    async with Case(browser, base, origin, out, 'no-five-hour-pool', 'served-no-five-hour',
                    '/quota?window=five-hour') as c:
        await c.page.wait_for_timeout(3000)
        text = await c.page.evaluate("() => document.querySelector('main').innerText.replace(/\\s+/g, ' ')")
        c.notes['page'] = text
        c.check('the Codex pool names the account as "No 5-hour limit"', 'No 5-hour limit' in text, text[:600])
        c.check('no "5-hour quota unavailable" withheld notice', '5-hour quota unavailable' not in text, text[:600])
        c.check('the combined total is not withheld for missing data', 'No current quota data' not in text, text[:600])
        await c.shot('fold')
        return await c.finish()


CASES = [case_auth_files_served, case_quota_accounts_served, case_refresh_floor, case_refresh_ran,
         case_other_hub, case_disabled_refresh, case_claim_dialog, case_prox_absent, case_phone,
         case_no_five_hour, case_no_five_hour_quota_accounts, case_no_five_hour_pool]


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--url', default='http://127.0.0.1:5199')
    parser.add_argument('--out', required=True)
    parser.add_argument('--cases', nargs='*')
    args = parser.parse_args()
    origin = urlparse(args.url)
    if origin.scheme != 'http' or origin.hostname not in ('127.0.0.1', 'localhost'):
        parser.error('Only a local HTTP server is allowed')
    out = ROOT / args.out
    out.mkdir(parents=True, exist_ok=True)
    chrome = sorted((Path.home() / '.cache/ms-playwright').glob('chromium-*/chrome-linux64/chrome'))
    report = {'url': args.url.rstrip('/'), 'cases': {}}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=str(chrome[-1]) if chrome else None,
                                           headless=True, args=['--no-sandbox'])
        try:
            for case in CASES:
                name = case.__name__.removeprefix('case_').replace('_', '-')
                if args.cases and name not in args.cases:
                    continue
                try:
                    result = await case(browser, args.url.rstrip('/'), origin, out)
                except Exception as error:  # noqa: BLE001 - every harness failure is a finding
                    result = {'pass': False, 'harnessError': str(error).splitlines()[0]}
                report['cases'][name] = result
                (out / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
                print(f'{name}: {"PASS" if result["pass"] else "FINDING"}', flush=True)
                for check in result.get('checks', []):
                    if not check['ok']:
                        print(f'  FAIL {check["check"]}: {check.get("detail")}', flush=True)
        finally:
            await browser.close()
    findings = [n for n, v in report['cases'].items() if not v['pass']]
    print(json.dumps({'cases': len(report['cases']), 'findings': findings}), flush=True)
    return 1 if findings else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))

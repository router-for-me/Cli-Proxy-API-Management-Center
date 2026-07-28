/**
 * Switch locale through the header language control and confirm the quota board
 * strings are actually translated, rather than silently falling back to the
 * English defaultValue baked into each t() call.
 *
 * Switches in-app rather than reloading: a reload drops the mock session back
 * to the login screen and every locale then "passes" as English.
 */
const targets = (await (await fetch('http://localhost:9222/json')).json()) as {
  type: string;
  webSocketDebuggerUrl: string;
}[];
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 1;
const pending = new Map<number, (m: unknown) => void>();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)!(m);
    pending.delete(m.id);
  }
});

const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result?: { result?: { value?: unknown }; data?: string } }>((res) => {
    const i = id++;
    pending.set(i, res as never);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const evaluate = async (expression: string) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
    ?.result?.value;

/**
 * Open the header language menu and pick by index.
 *
 * Indexed rather than matched on the visible label: the labels are themselves
 * translated, so whichever locale is active changes what they say — matching on
 * text silently finds nothing and every locale then "passes" as English.
 * Order is LANGUAGE_ORDER: ['zh-CN', 'zh-TW', 'en', 'ru'].
 */
const switchTo = async (index: number) => {
  await evaluate(`(() => {
    const btn = document.querySelector('[aria-haspopup="menu"]');
    btn?.click();
    return !!btn;
  })()`);
  await Bun.sleep(600);
  return evaluate(`(() => {
    const items = document.querySelectorAll('.language-menu-option, [role="menuitemradio"]');
    const item = items[${index}];
    if (!item) return 'no item at index ${index} (found ' + items.length + ')';
    item.click();
    return (item.textContent || '').trim();
  })()`);
};

// The strings the board renders through the newly added keys.
const ENGLISH = ['lowest remaining', 'not loaded', 'next reset', 'All credentials'];

for (const [index, lng] of [
  [0, 'zh-CN'],
  [1, 'zh-TW'],
  [3, 'ru'],
  [2, 'en'],
] as const) {
  const applied = await switchTo(index);
  await Bun.sleep(1500);
  await evaluate(`window.location.hash = '#/quota'`);
  await Bun.sleep(1500);

  const report = await evaluate(`(() => {
    const text = document.body.innerText;
    return JSON.stringify({
      locale: ${JSON.stringify(lng)},
      heading: (document.querySelector('h1') || {}).innerText || null,
      englishLeaks: ${JSON.stringify(ENGLISH)}.filter((s) => text.includes(s)),
    });
  })()`);
  console.log('switch=', applied, report);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  await Bun.write(`/tmp/quota-${lng}.png`, Buffer.from(String(shot.result?.data), 'base64'));
}

ws.close();

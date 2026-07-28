/**
 * Drive the headless panel over the DevTools Protocol: log in, navigate to the
 * quota board, wait for the cards to actually render, screenshot.
 *
 * Invoked by shoot.sh, which owns starting and killing Chrome.
 */

const [, , OUT = '/tmp/quota-board.png', URL_ = 'http://localhost:8899/#/quota'] = Bun.argv;
const DEBUG_PORT = 9222;

interface CdpMessage {
  id?: number;
  method?: string;
  result?: { result?: { value?: unknown }; data?: string };
  error?: { message?: string };
}

const targets = (await (await fetch(`http://localhost:${DEBUG_PORT}/json`)).json()) as {
  type: string;
  webSocketDebuggerUrl: string;
}[];
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target — is Chrome up?');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

let nextId = 1;
const pending = new Map<number, (msg: CdpMessage) => void>();

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data)) as CdpMessage;
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg);
    pending.delete(msg.id);
  }
});

const send = (method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> => {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg)
    );
    ws.send(JSON.stringify({ id, method, params }));
  });
};

/** Evaluate an expression in the page and return its value. */
const evaluate = async (expression: string): Promise<unknown> => {
  const msg = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return msg.result?.result?.value;
};

/** Poll an expression until it returns true, or fail loudly. */
const waitFor = async (label: string, expression: string, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return;
    await Bun.sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
};

await send('Page.enable');
await send('Runtime.enable');

await send('Page.navigate', { url: URL_ });
await waitFor('app boot', 'document.querySelectorAll("input,button").length > 0');

// Log in if the form is showing. Setting .value directly bypasses React's
// synthetic onChange, so the native setter + dispatched input event is required
// or the store never sees the key.
const needsLogin = await evaluate('!!document.querySelector(\'input[type="password"]\')');
if (needsLogin) {
  await evaluate(`(() => {
    const input = document.querySelector('input[type="password"]');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'mock-key');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const submit = [...document.querySelectorAll('button')]
      .find((b) => /log ?in|sign ?in|登录/i.test(b.textContent || ''));
    submit?.click();
    return true;
  })()`);
  await waitFor('login to clear', '!document.querySelector(\'input[type="password"]\')');
}

// Land on the board and wait for real cards, not just the shell.
await evaluate(`window.location.hash = '#/quota'`);
await waitFor(
  'quota cards',
  `[...document.querySelectorAll('*')].filter(
     (el) => /Refresh quota/i.test(el.textContent || '') && el.tagName === 'BUTTON').length >= 4`
);

// Then wait for quota to finish loading, so bars are populated rather than
// mid-skeleton. Falls through after the grace period if some card errors.
await Bun.sleep(4000);

const summary = await evaluate(`(() => {
  const text = document.body.innerText;
  return JSON.stringify({
    cards: [...document.querySelectorAll('button')]
      .filter((b) => /Refresh quota/i.test(b.textContent || '')).length,
    percents: (text.match(/\\d+%/g) || []).slice(0, 24),
    notLoaded: (text.match(/not loaded/gi) || []).length,
    errors: (text.match(/failed|error/gi) || []).length,
  });
})()`);
console.log('page summary:', summary);

const height = (await evaluate(
  'Math.min(document.documentElement.scrollHeight, 4000)'
)) as number;
await send('Emulation.setDeviceMetricsOverride', {
  width: 1900,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});

const shot = await send('Page.captureScreenshot', { format: 'png' });
await Bun.write(OUT, Buffer.from(String(shot.result?.data), 'base64'));
console.log(`wrote ${OUT} (1900x${height})`);

ws.close();

/** Capture the quota windows timeline in both modes, plus a scroll check. */
const targets = (await (await fetch('http://localhost:9222/json')).json()) as {
  type: string; webSocketDebuggerUrl: string }[];
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 1;
const pending = new Map<number, (m: unknown) => void>();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data));
  if (m.id && pending.has(m.id)) { pending.get(m.id)!(m); pending.delete(m.id); }
});
const send = (method: string, params: Record<string, unknown> = {}) =>
  new Promise<{ result?: { result?: { value?: unknown }; data?: string } }>((res) => {
    const i = id++; pending.set(i, res as never);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression: string) =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))
    .result?.result?.value;

const report = async (label: string) => {
  const summary = await evaluate(`(() => {
    const heads = [...document.querySelectorAll('h2')];
    const chart = heads.find((h) => /Quota windows|配额窗口/.test(h.textContent||''));
    if (!chart) return JSON.stringify({ label: ${JSON.stringify(label)}, present: false });
    const section = chart.closest('section');
    const bars = section.querySelectorAll('[class*="window"][style*="left"]');
    const lanes = section.querySelectorAll('[class*="lane"]:not([class*="laneHead"]):not([class*="laneTop"]):not([class*="laneName"]):not([class*="laneDot"]):not([class*="laneLimit"]):not([class*="lanePeriod"]):not([class*="laneIdle"])');
    const idle = section.querySelectorAll('[class*="laneIdle"]');
    const now = section.querySelectorAll('[class*="nowLine"]');
    return JSON.stringify({
      label: ${JSON.stringify(label)}, present: true,
      lanes: lanes.length, bars: bars.length, idleLanes: idle.length, nowMarkers: now.length,
      range: section.querySelector('p')?.textContent,
    });
  })()`);
  console.log(summary);
};

// Scroll the timeline into view, then capture the full page.
await evaluate(`document.querySelector('#root')?.scrollTo?.(0, 99999); window.scrollTo(0, 99999); true`);
await Bun.sleep(600);
await report('weekly');

/**
 * The app scrolls inside a container, so documentElement.scrollHeight stays at
 * the viewport height and a naive full-page capture clips every lane below the
 * fold. Measure the scrolling element instead and grow the viewport to match.
 */
const shoot = async (file: string) => {
  const h = (await evaluate(`(() => {
    const els = [...document.querySelectorAll('*')];
    const scroller = els.find((el) => el.scrollHeight > el.clientHeight + 40
      && ['auto','scroll'].includes(getComputedStyle(el).overflowY));
    const inner = scroller ? scroller.scrollHeight : 0;
    return Math.min(Math.max(inner + 120, document.documentElement.scrollHeight), 6000);
  })()`)) as number;
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1900, height: h, deviceScaleFactor: 1, mobile: false });
  await Bun.sleep(600);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await Bun.write(file, Buffer.from(String(shot.result?.data), 'base64'));
  console.log('wrote', file, 'h=' + h);
};
await shoot('/tmp/tl-weekly.png');

// Switch to the 5-hour mode.
const switched = await evaluate(`(() => {
  const btns = [...document.querySelectorAll('button')];
  const b = btns.find((x) => /5-hour|5 小時|5 小时|5 часов/.test(x.textContent||''));
  if (!b) return 'not found';
  b.click(); return 'clicked';
})()`);
console.log('mode switch:', switched);
await Bun.sleep(900);
await report('session');
await shoot('/tmp/tl-session.png');
ws.close();

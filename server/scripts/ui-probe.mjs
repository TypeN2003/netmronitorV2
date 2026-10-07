/**
 * Sign in and dump one page's rendered text, for looking at a single screen
 * closely when scripts/ui-check.mjs flags it.
 *
 *   node scripts/ui-probe.mjs /ports
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.env.PROBE_BASE || 'http://localhost:3000').replace(/\/$/, '');
const ROUTE = process.argv[2] || '/ports';
const EMAIL = process.argv[3] || 'admin@netmonitor.internal';
const PASSWORD = process.argv[4] || 'admin123';

const CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));

let nextId = 1;
const connect = async (wsUrl) => {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  await new Promise((res, rej) => {
    socket.addEventListener('open', res, { once: true });
    socket.addEventListener('error', () => rej(new Error('ws failed')), { once: true });
  });
  socket.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
        setTimeout(() => pending.has(id) && (pending.delete(id), reject(new Error(`${method} timeout`))), 25000);
      }),
    close: () => socket.close(),
  };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const profile = mkdtempSync(join(tmpdir(), 'netmon-probe-'));
  const port = 9334;
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      '--window-size=1600,1200',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ws = null;
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const t = list.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) {
        ws = t.webSocketDebuggerUrl;
        break;
      }
    } catch {
      /* not up */
    }
    await sleep(250);
  }
  const page = await connect(ws);
  await page.send('Runtime.enable');
  await page.send('Page.enable');


  const evaluate = async (expression) => {
    const r = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(d.exception?.description || d.text || 'evaluate failed');
    }
    return r.result?.value;
  };

  await page.send('Page.navigate', { url: `${BASE}/login` });
  // Wait for the form instead of guessing a delay
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "!!document.querySelector('input[type=password]') && !!document.querySelector('form')"
    ).catch(() => false);
    if (ready) break;
    await sleep(400);
  }
  await evaluate(`
    (() => {
      const inputs = [...document.querySelectorAll('input')];
      const u = inputs.find(i => i.type === 'text' || i.type === 'email');
      const p = inputs.find(i => i.type === 'password');
      const set = (el, v) => {
        Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(u, ${JSON.stringify(EMAIL)});
      set(p, ${JSON.stringify(PASSWORD)});
      u.closest('form').requestSubmit();
    })()
  `);
  await sleep(3000);

  await evaluate(`
    (() => {
      window.history.pushState({}, '', ${JSON.stringify(ROUTE)});
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    })()
  `);
  await sleep(2500);

  console.log(`=== ${ROUTE} ===`);
  console.log(await evaluate('document.body.innerText'));

  console.log('\n=== <select> options on this page ===');
  console.log(
    await evaluate(`
      [...document.querySelectorAll('select')]
        .map(s => s.name + '[' + (s.selectedOptions[0]?.text ?? '') + '] <- ' + [...s.options].map(o => o.text).join(' | '))
        .join('\\n') || '(none)'
    `)
  );

  console.log('\n=== buttons ===');
  console.log(
    await evaluate(`
      [...document.querySelectorAll('button')].map(b => b.innerText.trim().replace(/\\s+/g,' ')).filter(Boolean).slice(0,40).join(' / ')
    `)
  );

  page.close();
  proc.kill();
  process.exit(0);
};

main().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});

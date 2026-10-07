/**
 * Walk every page of the running app in a real headless browser and report what broke.
 *
 *   node scripts/ui-check.mjs [baseUrl] [email] [password]
 *
 * Needs the frontend and the collector running. Drives Chrome over the DevTools
 * Protocol using Node's built-in WebSocket, so there is nothing to install.
 *
 * For each route it signs in through the real login form, then checks:
 *   - uncaught exceptions and console errors
 *   - failed network requests (4xx/5xx and connection failures)
 *   - missing translation keys, which render as the raw key name
 *   - that the page actually rendered something, not a blank error boundary
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.argv[3] || 'admin@netmonitor.internal';
const PASSWORD = process.argv[4] || 'admin123';

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** Pages to visit, in the order a person would. */
const ROUTES = [
  { path: '/dashboard', name: 'Dashboard', expect: ['NetMonitor', 'SNMP'], denyFor: [] },
  { path: '/devices', name: 'Devices', expect: ['CSW1', 'DisFloor1', 'viOS'], denyFor: [] },
  { path: '/ports', name: 'Ports', expect: ['CSW1', 'Hostname'], denyFor: ['Viewer'] },
  { path: '/vlans', name: 'VLANs', expect: ['MGMT'], denyFor: ['Viewer'] },
  { path: '/topology', name: 'Topology', expect: ['CSW1'], denyFor: [] },
  { path: '/alerts', name: 'Alerts', expect: [], denyFor: ['Viewer'] },
  { path: '/event-logs', name: 'Event Logs', expect: ['NETMON'], denyFor: ['Viewer'] },
  { path: '/statistics', name: 'Statistics', expect: [], denyFor: ['Viewer'] },
  { path: '/users', name: 'Users', expect: [EMAIL], denyFor: ['Viewer', 'Engineer'] },
  { path: '/settings', name: 'Settings', expect: [], denyFor: ['Viewer'] },
  { path: '/access-points', name: 'Access Points', expect: [], denyFor: [] },
];

/** The 403 card rendered by ProtectedRoute, in either language. */
const DENIED_MARKER = '403';

// ---------------------------------------------------------------- CDP plumbing

let nextId = 1;

const connect = async (wsUrl) => {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = new Map();

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('CDP socket failed')), { once: true });
  });

  socket.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`${method} timed out`));
          }
        }, 30000);
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(fn);
    },
    close: () => socket.close(),
  };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!chrome) throw new Error('No Chrome or Edge found');

  const profile = mkdtempSync(join(tmpdir(), 'netmon-uicheck-'));
  const port = 9333;
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-gpu',
      '--window-size=1600,1000',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false }
  );

  // Wait for the debugging endpoint
  let wsUrl = null;
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await res.json()).webSocketDebuggerUrl;
      if (wsUrl) break;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error('Chrome did not expose a debugging port');
  }

  // Attach straight to the page target's own socket: then every command and event
  // on this connection belongs to that page and no sessionId juggling is needed.
  let pageWs = null;
  for (let i = 0; i < 40; i += 1) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) {
      pageWs = target.webSocketDebuggerUrl;
      break;
    }
    await sleep(250);
  }
  if (!pageWs) {
    proc.kill();
    throw new Error('No page target to attach to');
  }

  const page = await connect(pageWs);
  const send = page.send;

  // Collected per route
  let bucket = { errors: [], netFails: [] };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');

  page.on('Runtime.exceptionThrown', (p) => {
    const d = p?.exceptionDetails;
    const text = d?.exception?.description || d?.text || 'uncaught exception';
    bucket.errors.push(`UNCAUGHT: ${String(text).split('\n')[0]}`);
  });
  page.on('Runtime.consoleAPICalled', (p) => {
    if (p?.type !== 'error') return;
    const text = (p.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ').trim();
    if (text) bucket.errors.push(`console.error: ${text.slice(0, 180)}`);
  });
  page.on('Log.entryAdded', (p) => {
    const e = p?.entry;
    if (e?.level === 'error') bucket.errors.push(`log: ${String(e.text).slice(0, 180)}`);
  });
  page.on('Network.responseReceived', (p) => {
    const r = p?.response;
    if (r && r.status >= 400) bucket.netFails.push(`HTTP ${r.status} ${r.url}`);
  });
  page.on('Network.loadingFailed', (p) => {
    if (p?.type === 'Document' || p?.type === 'XHR' || p?.type === 'Fetch') {
      bucket.netFails.push(`${p.type} failed: ${p.errorText}`);
    }
  });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text || 'evaluate failed');
    return result?.value;
  };

  const goto = async (path) => {
    bucket = { errors: [], netFails: [] };
    await send('Page.navigate', { url: `${BASE}${path}` });
    await sleep(2600); // first paint + bootstrap fetch + a poll of the charts
  };

  /**
   * Move between routes the way the app does, through React Router.
   *
   * A full Page.navigate never returns once the SSE stream is open, and a hard
   * reload per route would also re-run /api/bootstrap every time. pushState plus
   * popstate is what BrowserRouter listens for.
   */
  const navigateSpa = async (path) => {
    bucket = { errors: [], netFails: [] };
    await evaluate(`
      (() => {
        window.history.pushState({}, '', ${JSON.stringify(path)});
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        return true;
      })()
    `);
    await sleep(2200);
  };

  // ---------------------------------------------------------------- sign in

  console.log(`\nchecking ${BASE} as ${EMAIL}\n`);

  await goto('/login');
  for (let i = 0; i < 40; i += 1) {
    const ready = await evaluate(
      "!!document.querySelector('input[type=password]') && !!document.querySelector('form')"
    ).catch(() => false);
    if (ready) break;
    await sleep(400);
  }
  const loginFilled = await evaluate(`
    (() => {
      const inputs = [...document.querySelectorAll('input')];
      const user = inputs.find(i => i.type === 'text' || i.type === 'email');
      const pass = inputs.find(i => i.type === 'password');
      if (!user || !pass) return 'no login form (' + inputs.length + ' inputs)';
      const set = (el, v) => {
        const d = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(user, ${JSON.stringify(EMAIL)});
      set(pass, ${JSON.stringify(PASSWORD)});
      const form = user.closest('form');
      if (!form) return 'no form element';
      form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return 'ok';
    })()
  `);
  if (loginFilled !== 'ok') {
    console.log(`  LOGIN PAGE PROBLEM: ${loginFilled}`);
  }
  await sleep(3000);

  const afterLogin = await evaluate('location.pathname');
  if (afterLogin === '/login') {
    const shown = await evaluate('document.body.innerText.slice(0, 400)');
    console.log('LOGIN FAILED - still on /login');
    console.log(shown);
    proc.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold a lock; the temp dir gets cleaned up later
    }
    process.exit(1);
  }
  // Read the signed-in role from the app itself, so the expectations below can
  // follow the permission table instead of assuming an Admin.
  const role = await evaluate(`
    (async () => {
      const token = localStorage.getItem('netmonitor_token') || sessionStorage.getItem('netmonitor_token');
      const res = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      return (await res.json()).user.role;
    })()
  `);
  console.log(`login OK -> ${afterLogin} (role: ${role})\n`);

  // ---------------------------------------------------------------- walk the routes

  // Keys live in both language blocks; anything rendered that looks like a bare
  // camelCase identifier is very likely a translation key that was never added.
  const findRawKeys = `
    (() => {
      const seen = new Set();
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walk.nextNode())) {
        const t = n.textContent.trim();
        // a lone lowerCamelCase word of 6+ chars, no spaces/punctuation
        if (/^[a-z][a-zA-Z0-9]{5,}$/.test(t) && /[A-Z]/.test(t)) seen.add(t);
      }
      return [...seen];
    })()
  `;

  const results = [];
  for (const route of ROUTES) {
    await navigateSpa(route.path);

    const info = await evaluate(`
      (() => ({
        path: location.pathname,
        textLen: document.body.innerText.trim().length,
        text: document.body.innerText,
        rawKeys: ${findRawKeys},
        spinners: document.querySelectorAll('.animate-spin').length,
      }))()
    `);

    const shouldBeDenied = (route.denyFor ?? []).includes(role);
    const isDenied = info.text.includes(DENIED_MARKER);
    // On a page this role may not open, the only correct outcome is the 403 card
    const missingExpected = shouldBeDenied ? [] : route.expect.filter((e) => !info.text.includes(e));
    const roleProblem = shouldBeDenied
      ? isDenied
        ? null
        : 'should have been refused for this role but rendered content'
      : isDenied
        ? 'refused although this role is allowed here'
        : null;

    // Values that were hardcoded in the mock build and must never come back
    const FABRICATED = ['10.10.0.1', '96.4%', '2 / 2 Established', 'Peak 8.6 Gbps', '0.8 ms'];
    const fabricated = FABRICATED.filter((f) => info.text.includes(f));
    // React error boundaries and hard crashes leave an almost empty body
    const blank = info.textLen < 120;
    const redirected = info.path !== route.path;

    results.push({
      ...route,
      actualPath: info.path,
      redirected,
      blank: shouldBeDenied ? false : blank,
      roleProblem,
      shouldBeDenied,
      textLen: info.textLen,
      rawKeys: info.rawKeys,
      missingExpected,
      fabricated,
      errors: [...bucket.errors],
      netFails: [...bucket.netFails],
    });
  }

  page.close();
  proc.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // Chrome may still hold a lock on Windows; the temp dir gets cleaned up later
  }

  // ---------------------------------------------------------------- report

  let bad = 0;
  for (const r of results) {
    const problems = [];
    if (r.redirected) problems.push(`redirected to ${r.actualPath}`);
    if (r.blank) problems.push(`page is blank (${r.textLen} chars)`);
    if (r.roleProblem) problems.push(r.roleProblem);
    if (r.missingExpected.length) problems.push(`missing expected text: ${r.missingExpected.join(', ')}`);
    if (r.rawKeys.length) problems.push(`untranslated key(s) on screen: ${r.rawKeys.join(', ')}`);
    if (r.fabricated.length) problems.push(`hardcoded mock value(s) on screen: ${r.fabricated.join(', ')}`);
    for (const e of r.errors) problems.push(e);
    for (const f of r.netFails) problems.push(f);

    if (problems.length === 0) {
      const note = r.shouldBeDenied ? 'correctly refused (403)' : `${r.textLen} chars rendered`;
      console.log(`PASS  ${r.name.padEnd(14)} ${note}`);
    } else {
      bad += 1;
      console.log(`FAIL  ${r.name.padEnd(14)} ${String(r.textLen).padStart(6)} chars rendered`);
      for (const p of problems) console.log(`        - ${p}`);
    }
  }

  console.log(`\n${results.length - bad}/${results.length} pages clean`);
  process.exit(bad === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error('ui-check failed:', error.message);
  process.exit(2);
});

// Toggles the panel on the current tab, and runs code from it in the page's own JS context.

const CSP_HELP =
  "This page's Content Security Policy blocks eval. To run code here, open chrome://extensions, " +
  'click Details on JS Runner and turn on "Allow User Scripts", then try again.';

// `restoring` reopens the panel after a reload instead of toggling it, and leaves focus alone.
async function injectPanel(tabId, restoring) {
  const target = { tabId };
  await chrome.scripting.executeScript({ target, func: (r) => (window.__jsRunnerRestoring = r), args: [restoring] });
  await chrome.scripting.executeScript({ target, files: ['panel.js'] });
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await injectPanel(tab.id, false);
  } catch {
    // chrome://, the Web Store and similar pages can't be scripted.
    chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#d93025' });
    chrome.action.setBadgeText({ tabId: tab.id, text: '!' });
    setTimeout(() => chrome.action.setBadgeText({ tabId: tab.id, text: '' }), 1500);
  }
});

// Tabs whose panel is open, so it comes back after a reload or navigation in that tab.
const openKey = (tabId) => `open:${tabId}`;

chrome.webNavigation.onDOMContentLoaded.addListener(async ({ tabId, frameId }) => {
  if (frameId !== 0) return;
  const key = openKey(tabId);
  const { [key]: open } = await chrome.storage.session.get(key);
  if (open) injectPanel(tabId, true).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(openKey(tabId)));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!sender.tab) return;
  if (msg?.type === 'panel') {
    const key = openKey(sender.tab.id);
    msg.open ? chrome.storage.session.set({ [key]: true }) : chrome.storage.session.remove(key);
    return;
  }
  if (msg?.type !== 'run') return;
  run(sender.tab.id, msg.code).then(sendResponse, (e) => sendResponse({ error: String(e?.message || e) }));
  return true;
});

async function run(tabId, code) {
  const target = { tabId, frameIds: [0] };
  await chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, func: installHook });
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    injectImmediately: true,
    func: evalInPage,
    args: [code],
  });
  if (!result) return { error: 'The page did not return a result (did it navigate?)' };
  return result.csp ? runAsUserScript(target, code) : result;
}

// Strict-CSP pages (GitHub, Google, ...) refuse eval. User scripts are exempt, but Chrome only
// allows them once the user turns on "Allow User Scripts" for this extension.
async function runAsUserScript(target, code) {
  if (!userScriptsAvailable()) return { error: CSP_HELP };
  const [r] = await chrome.userScripts.execute({
    target,
    world: 'MAIN',
    injectImmediately: true,
    js: [{ code: `try {\n${code}\n} catch (e) { window[Symbol.for('jsrunner')].caught(e) }` }],
  });
  if (r?.error) return { error: String(r.error) };
  const v = r?.result;
  if (v && typeof v === 'object' && '__jsrError' in v) return { error: v.__jsrError };
  return { result: describeCloned(v) };
}

function userScriptsAvailable() {
  try {
    chrome.userScripts.getScripts().catch(() => {});
    return typeof chrome.userScripts.execute === 'function';
  } catch {
    return false;
  }
}

// User-script results arrive already serialized, so DOM nodes etc. lose their shape here.
function describeCloned(v) {
  if (v === undefined) return 'undefined';
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
}

// ---- Everything below runs inside the page (MAIN world) and must be self-contained. ----

function installHook() {
  const KEY = Symbol.for('jsrunner');
  if (window[KEY]) return;

  const send = (level, text) => {
    try {
      document.dispatchEvent(new CustomEvent('jsrunner:out', { detail: JSON.stringify({ level, text }) }));
    } catch {}
  };

  const IDENT = /^[A-Za-z_$][\w$]*$/;
  const MAX_ITEMS = 100;

  const ctorName = (v) => {
    try {
      return Object.getPrototypeOf(v)?.constructor?.name || '';
    } catch {
      return '';
    }
  };

  const list = (iter, size, fn) => {
    const out = [];
    for (const x of iter) {
      if (out.length === MAX_ITEMS) {
        out.push(`… ${size - MAX_ITEMS} more`);
        break;
      }
      out.push(fn(x));
    }
    return out;
  };

  // One line when short, otherwise one item per line.
  const wrap = (open, items, close, depth) => {
    if (!items.length) return open + close;
    const flat = open + items.join(', ') + close;
    if (flat.length <= 80 && !flat.includes('\n')) return flat;
    const pad = '  '.repeat(depth + 1);
    return `${open}\n${items.map((i) => pad + i).join(',\n')}\n${'  '.repeat(depth)}${close}`;
  };

  const node = (n) => {
    if (n.nodeType === 1) {
      let s = '<' + n.localName;
      if (n.id) s += '#' + n.id;
      const cls = (typeof n.className === 'string' ? n.className : n.getAttribute('class') || '').trim();
      if (cls) s += '.' + cls.split(/\s+/).join('.');
      return s + '>';
    }
    if (n.nodeType === 3) return '#text ' + JSON.stringify(n.data.length > 60 ? n.data.slice(0, 60) + '…' : n.data);
    return n.nodeName;
  };

  const fmt = (v, quote = true, depth = 0, seen = new Set()) => {
    switch (typeof v) {
      case 'string':
        return quote ? JSON.stringify(v) : v;
      case 'number':
        return Object.is(v, -0) ? '-0' : String(v);
      case 'bigint':
        return `${v}n`;
      case 'boolean':
      case 'undefined':
        return String(v);
      case 'symbol':
        return v.toString();
      case 'function': {
        const isClass = Function.prototype.toString.call(v).startsWith('class');
        return isClass ? `class ${v.name || '(anonymous)'}` : `ƒ ${v.name || '(anonymous)'}()`;
      }
    }
    if (v === null) return 'null';
    if (seen.has(v)) return '[Circular]';
    try {
      if (v === window) return 'Window';
      if (v instanceof Error) return depth ? `${v.name}: ${v.message}` : v.stack || `${v.name}: ${v.message}`;
      if (v instanceof Date) return isNaN(v) ? 'Invalid Date' : v.toString();
      if (v instanceof RegExp) return String(v);
      if (v instanceof Promise) return 'Promise {…}';
      if (v instanceof Node) return node(v);
      if (v instanceof WeakMap || v instanceof WeakSet) return `${ctorName(v)} {…}`;
      if (depth > 3) return Array.isArray(v) ? `Array(${v.length})` : '{…}';

      seen.add(v);
      const sub = (x) => fmt(x, true, depth + 1, seen);
      if (Array.isArray(v)) return wrap('[', list(v, v.length, sub), ']', depth);
      if ((ArrayBuffer.isView(v) && !(v instanceof DataView)) || v instanceof NodeList || v instanceof HTMLCollection) {
        return `${ctorName(v)}(${v.length}) ` + wrap('[', list(Array.from(v), v.length, sub), ']', depth);
      }
      if (v instanceof Map) {
        return `Map(${v.size}) ` + wrap('{', list(v, v.size, ([k, x]) => `${sub(k)} => ${sub(x)}`), '}', depth);
      }
      if (v instanceof Set) return `Set(${v.size}) ` + wrap('{', list(v, v.size, sub), '}', depth);

      const keys = Object.keys(v);
      const items = list(keys, keys.length, (k) => {
        let x;
        try {
          x = sub(v[k]);
        } catch {
          x = '(…)';
        }
        return `${IDENT.test(k) ? k : JSON.stringify(k)}: ${x}`;
      });
      const name = ctorName(v);
      return (name && name !== 'Object' ? name + ' ' : '') + wrap('{', items, '}', depth);
    } catch {
      return Object.prototype.toString.call(v);
    } finally {
      seen.delete(v);
    }
  };

  const errText = (e) => (e instanceof Error ? `${e.name}: ${e.message}` : fmt(e));

  // Applies console-style %s / %d / %o / %c substitutions.
  const formatArgs = (args) => {
    if (typeof args[0] === 'string' && /%[sdifoOc]/.test(args[0])) {
      let i = 1;
      const head = args[0].replace(/%([sdifoOc%])/g, (m, c) => {
        if (c === '%') return '%';
        if (i >= args.length) return m;
        const a = args[i++];
        if (c === 'c') return '';
        if (c === 's') return typeof a === 'string' ? a : fmt(a);
        if (c === 'd' || c === 'i') return String(parseInt(a));
        if (c === 'f') return String(parseFloat(a));
        return fmt(a);
      });
      args = [head, ...args.slice(i)];
    }
    return args.map((a) => (typeof a === 'string' ? a : fmt(a))).join(' ');
  };

  const levels = { log: 'log', info: 'info', warn: 'warn', error: 'error', debug: 'log', dir: 'log', table: 'log' };
  for (const [method, level] of Object.entries(levels)) {
    const orig = console[method];
    if (typeof orig !== 'function') continue;
    console[method] = function (...args) {
      try {
        send(level, formatArgs(args));
      } catch {}
      return orig.apply(this, args);
    };
  }
  const origClear = console.clear;
  console.clear = function () {
    send('clear', '');
    return origClear.apply(this, arguments);
  };

  window.addEventListener('error', (e) => send('error', e.error ? 'Uncaught ' + errText(e.error) : e.message));
  window.addEventListener('unhandledrejection', (e) => send('error', 'Uncaught (in promise) ' + errText(e.reason)));

  Object.defineProperty(window, KEY, {
    value: {
      fmt,
      errText,
      caught: (e) => ({ __jsrError: 'Uncaught ' + errText(e) }),
    },
  });
}

async function evalInPage(code) {
  const J = window[Symbol.for('jsrunner')];
  let value;
  try {
    // Indirect eval runs in global scope. The block lets `const x = ...` be re-run without
    // "already declared" errors; use `var` or `window.x` to keep values between runs.
    value = (0, eval)(`{\n${code}\n}`);
  } catch (e) {
    if (e instanceof EvalError || /unsafe-eval|Trusted ?Type/i.test(e?.message)) return { csp: true };
    return { error: 'Uncaught ' + J.errText(e) };
  }
  if (value && typeof value.then === 'function') {
    try {
      return { result: J.fmt(await value) };
    } catch (e) {
      return { error: 'Uncaught (in promise) ' + J.errText(e) };
    }
  }
  return { result: J.fmt(value) };
}

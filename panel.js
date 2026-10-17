// The corner panel. Injected on demand into the page's isolated world; re-injecting toggles it.
(() => {
  if (window.__jsRunner) {
    if (!window.__jsRunnerRestoring) window.__jsRunner.toggle();
    return;
  }

  const MAX_LINES = 1000;
  const MAX_HISTORY = 100;

  const host = document.createElement('js-runner-panel');
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .panel {
        --bg: #1e1f22; --bg2: #2b2d31; --fg: #e3e3e3; --dim: #8b8d93; --border: #3a3c42;
        --accent: #f7df1e; --err: #ff6b68; --err-bg: #3b1f20; --warn: #f2c94c; --warn-bg: #36301b; --info: #7cb7ff;
        position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
        width: 440px; height: 340px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px);
        display: flex; flex-direction: column; overflow: hidden;
        background: var(--bg); color: var(--fg);
        border: 1px solid var(--border); border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0, 0, 0, .35);
        font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .panel.big { width: 760px; height: 560px; }
      .panel[hidden] { display: none; }
      @media (prefers-color-scheme: light) {
        .panel {
          --bg: #ffffff; --bg2: #f3f4f6; --fg: #1f2328; --dim: #6e7781; --border: #d0d7de;
          --accent: #b08800; --err: #cf222e; --err-bg: #fff0f0; --warn: #9a6700; --warn-bg: #fff8e1; --info: #0969da;
          box-shadow: 0 12px 40px rgba(0, 0, 0, .15);
        }
      }
      header {
        display: flex; align-items: center; gap: 4px; padding: 6px 6px 6px 12px;
        background: var(--bg2); border-bottom: 1px solid var(--border);
        font: 600 12px system-ui, sans-serif; user-select: none;
      }
      header .title { flex: 1; }
      header .title b { color: var(--accent); }
      button {
        all: unset; cursor: pointer; padding: 2px 8px; border-radius: 5px;
        color: var(--dim); font: 12px system-ui, sans-serif;
      }
      button:hover { background: var(--border); color: var(--fg); }
      .out { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 4px 0; }
      .line {
        padding: 2px 12px 2px 26px; position: relative;
        white-space: pre-wrap; word-break: break-word; border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
      }
      .line::before { position: absolute; left: 11px; color: var(--dim); }
      .input { color: var(--dim); }
      .input::before { content: '›'; color: var(--accent); }
      .result::before, .undef::before { content: '←'; }
      .undef { color: var(--dim); }
      .info { color: var(--info); }
      .warn { color: var(--warn); background: var(--warn-bg); }
      .error { color: var(--err); background: var(--err-bg); }
      .empty { color: var(--dim); padding: 10px 12px; font-family: system-ui, sans-serif; }
      .in { display: flex; align-items: flex-start; border-top: 1px solid var(--border); background: var(--bg); }
      .in::before { content: '›'; color: var(--accent); padding: 8px 0 0 11px; font-weight: bold; }
      textarea {
        all: unset; flex: 1; box-sizing: border-box; padding: 8px 10px 8px 7px;
        min-height: 74px; max-height: 240px; overflow-y: auto; white-space: pre-wrap;
        font: inherit; color: var(--fg); caret-color: var(--accent);
      }
      textarea::placeholder { color: var(--dim); }
      .run { margin: 6px 6px 0 0; color: var(--accent); }
    </style>
    <div class="panel">
      <header>
        <span class="title"><b>JS</b> Runner</span>
        <button class="clear" title="Clear output">Clear</button>
        <button class="size" title="Bigger / smaller">⤢</button>
        <button class="close" title="Close (Esc)">✕</button>
      </header>
      <div class="out"><div class="empty">Type JavaScript below. It runs in this page, like the DevTools console.</div></div>
      <div class="in">
        <textarea rows="1" spellcheck="false" placeholder="Enter run · Shift+Enter new line · Ctrl+Enter force run · ↑↓ history"></textarea>
        <button class="run" title="Run (Enter)">▶</button>
      </div>
    </div>`;

  const panel = root.querySelector('.panel');
  const out = root.querySelector('.out');
  const ta = root.querySelector('textarea');

  // Keep the page's own keyboard shortcuts from firing while typing here.
  for (const type of ['keydown', 'keyup', 'keypress', 'input', 'copy', 'cut', 'paste']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  // ---- output ----

  function line(kind, text) {
    out.querySelector('.empty')?.remove();
    const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
    const el = document.createElement('div');
    el.className = 'line ' + kind;
    el.textContent = text;
    out.append(el);
    while (out.childElementCount > MAX_LINES) out.firstElementChild.remove();
    if (atBottom || kind === 'input') out.scrollTop = out.scrollHeight;
  }

  function clearOutput() {
    out.replaceChildren();
  }

  // Console output and uncaught errors forwarded from the page (see installHook in background.js).
  document.addEventListener('jsrunner:out', (e) => {
    let d;
    try {
      d = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (d.level === 'clear') clearOutput();
    else line(d.level, d.text);
  });

  // ---- history ----

  let history = [];
  let hIndex = 0;
  let draft = '';
  chrome.storage.local.get('history').then(({ history: h }) => {
    history = Array.isArray(h) ? h : [];
    hIndex = history.length;
  });

  function remember(code) {
    if (history[history.length - 1] !== code) history.push(code);
    history = history.slice(-MAX_HISTORY);
    hIndex = history.length;
    draft = '';
    chrome.storage.local.set({ history }).catch(() => {});
  }

  function recall(step) {
    const next = hIndex + step;
    if (next < 0 || next > history.length) return;
    if (hIndex === history.length) draft = ta.value;
    hIndex = next;
    setCode(hIndex === history.length ? draft : history[hIndex]);
  }

  // ---- editor ----

  function setCode(code) {
    ta.value = code;
    ta.selectionStart = ta.selectionEnd = code.length;
    autosize();
  }

  function autosize() {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  // True while brackets / template literals / block comments are still open, so Enter adds a line.
  // Skips strings, comments and regex literals, and follows `${}` nesting inside templates.
  const REGEX_AFTER_CHAR = '(,=:[!&|?{};+-*%<>~^';
  const REGEX_AFTER_WORD = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await|delete|new|throw)$/;

  function isIncomplete(src) {
    const stack = []; // open ( [ { plus '`' for templates and '${' for their expressions
    let prev = ''; // last significant code character, to tell a regex from a division
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (stack[stack.length - 1] === '`') {
        if (c === '\\') i++;
        else if (c === '`') {
          stack.pop();
          prev = c;
        } else if (c === '$' && src[i + 1] === '{') {
          stack.push('${');
          i++;
          prev = '{';
        }
        continue;
      }
      if (/\s/.test(c)) continue;
      if (c === '/' && src[i + 1] === '/') {
        const end = src.indexOf('\n', i);
        if (end < 0) break;
        i = end;
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) return true;
        i = end + 1;
        continue;
      }
      if (c === '"' || c === "'") {
        for (i++; i < src.length && src[i] !== c && src[i] !== '\n'; i++) if (src[i] === '\\') i++;
        prev = c;
        continue;
      }
      if (c === '/' && (!prev || REGEX_AFTER_CHAR.includes(prev) || REGEX_AFTER_WORD.test(src.slice(0, i).trimEnd()))) {
        let inClass = false;
        for (i++; i < src.length && src[i] !== '\n'; i++) {
          if (src[i] === '\\') i++;
          else if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
        }
        prev = 'x';
        continue;
      }
      if (c === '`' || c === '(' || c === '[' || c === '{') stack.push(c);
      else if (c === ')' || c === ']' || c === '}') {
        if (!stack.length) return false; // unbalanced: run it and let the error show
        stack.pop();
      }
      prev = c;
    }
    return stack.length > 0;
  }

  ta.addEventListener('input', autosize);

  ta.addEventListener('keydown', (e) => {
    const { selectionStart: start, selectionEnd: end, value } = ta;
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      if (e.ctrlKey || e.metaKey || !isIncomplete(value)) {
        e.preventDefault();
        run();
      }
    } else if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      ta.setRangeText('  ', start, end, 'end');
      autosize();
    } else if (e.key === 'ArrowUp' && start === end && !value.slice(0, start).includes('\n')) {
      e.preventDefault();
      recall(-1);
    } else if (e.key === 'ArrowDown' && start === end && !value.slice(end).includes('\n')) {
      e.preventDefault();
      recall(1);
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clearOutput();
    } else if (e.key === 'Escape') {
      hide();
    }
  });

  async function run() {
    const code = ta.value;
    if (!code.trim()) return;
    remember(code);
    setCode('');
    line('input', code);
    try {
      const res = await chrome.runtime.sendMessage({ type: 'run', code });
      if (!res) line('error', 'No response from the extension.');
      else if (res.error) line('error', res.error);
      else line(res.result === 'undefined' ? 'undef' : 'result', res.result);
    } catch (e) {
      const msg = String(e?.message || e);
      line('error', /context invalidated/i.test(msg) ? 'JS Runner was reloaded. Refresh this page to use it again.' : msg);
    }
  }

  // ---- panel ----

  // The background reopens the panel after a reload while this is set for the tab.
  function setOpen(open) {
    chrome.runtime.sendMessage({ type: 'panel', open }).catch(() => {});
  }

  function show(focus = true) {
    panel.hidden = false;
    setOpen(true);
    if (focus) ta.focus();
  }

  function hide() {
    panel.hidden = true;
    setOpen(false);
  }

  root.querySelector('.run').addEventListener('click', () => {
    run();
    ta.focus();
  });
  root.querySelector('.clear').addEventListener('click', () => {
    clearOutput();
    ta.focus();
  });
  root.querySelector('.size').addEventListener('click', () => {
    const big = panel.classList.toggle('big');
    chrome.storage.local.set({ big }).catch(() => {});
    ta.focus();
  });
  root.querySelector('.close').addEventListener('click', hide);

  chrome.storage.local.get('big').then(({ big }) => panel.classList.toggle('big', !!big));
  document.documentElement.append(host);
  // When reopened after a reload, leave focus with the page (e.g. its own search box).
  show(!window.__jsRunnerRestoring);

  window.__jsRunner = { toggle: () => (panel.hidden ? show() : hide()) };
})();

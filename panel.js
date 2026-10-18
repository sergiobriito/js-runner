// The corner panel. Injected on demand into the page's isolated world; re-injecting toggles it.
(() => {
  if (window.__jsRunner) {
    if (!window.__jsRunnerRestoring) window.__jsRunner.toggle();
    return;
  }

  const MAX_LINES = 1000;
  const MAX_HISTORY = 100;
  const restoring = !!window.__jsRunnerRestoring;

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
        box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden;
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
        font: 600 12px system-ui, sans-serif; user-select: none; cursor: grab; touch-action: none;
      }
      header.dragging { cursor: grabbing; }
      header .title { flex: 1; }
      header .title b { color: var(--accent); }
      button {
        all: unset; cursor: pointer; padding: 2px 8px; border-radius: 5px;
        color: var(--dim); font: 12px system-ui, sans-serif;
      }
      button:hover { background: var(--border); color: var(--fg); }
      button.auto[aria-pressed='true'] { color: var(--accent); background: color-mix(in srgb, var(--accent) 18%, transparent); }
      .out { flex: 1; overflow: auto; overscroll-behavior: contain; padding: 4px 0; }
      .line {
        padding: 2px 12px 2px 26px; position: relative;
        white-space: pre-wrap; word-break: break-word; border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
      }
      .line::before { position: absolute; left: 11px; color: var(--dim); }
      .input { color: var(--dim); }
      .input::before { content: '›'; color: var(--accent); }
      .input.auto::before { content: '↻'; }
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
      .grip { position: absolute; touch-action: none; }
      .grip.n, .grip.s { left: 12px; right: 12px; height: 4px; cursor: ns-resize; }
      .grip.e, .grip.w { top: 12px; bottom: 12px; width: 4px; cursor: ew-resize; }
      .grip.nw, .grip.ne, .grip.sw, .grip.se { width: 12px; height: 12px; }
      .grip.n, .grip.nw, .grip.ne { top: 0; }
      .grip.s, .grip.sw, .grip.se { bottom: 0; }
      .grip.w, .grip.nw, .grip.sw { left: 0; }
      .grip.e, .grip.ne, .grip.se { right: 0; }
      .grip.nw, .grip.se { cursor: nwse-resize; }
      .grip.ne, .grip.sw { cursor: nesw-resize; }
    </style>
    <div class="panel">
      <header title="Drag to move · double-click to put back in the corner">
        <span class="title"><b>JS</b> Runner</span>
        <button class="auto" aria-pressed="false" title="Auto-run: run the last snippet again after every reload of this page">↻</button>
        <button class="clear" title="Clear output">Clear</button>
        <button class="size" title="Bigger / smaller">⤢</button>
        <button class="close" title="Close (Esc)">✕</button>
      </header>
      <div class="out"><div class="empty">Type JavaScript below. It runs in this page, like the DevTools console.</div></div>
      <div class="in">
        <textarea rows="1" spellcheck="false" placeholder="Enter run · Shift+Enter new line · Ctrl+Enter force run · ↑↓ history"></textarea>
        <button class="run" title="Run (Enter)">▶</button>
      </div>
      ${['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].map((d) => `<div class="grip ${d}" data-dir="${d}"></div>`).join('')}
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

  function run() {
    const code = ta.value;
    if (!code.trim()) return;
    remember(code);
    setCode('');
    exec(code);
  }

  async function exec(code, auto = false) {
    line(auto ? 'input auto' : 'input', code);
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
    place();
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
  // Switches between the two preset sizes, dropping any size set by dragging an edge.
  root.querySelector('.size').addEventListener('click', () => {
    const big = panel.classList.toggle('big');
    panel.style.width = panel.style.height = '';
    chrome.storage.local.set({ big }).catch(() => {});
    chrome.storage.local.remove('size').catch(() => {});
    place();
    ta.focus();
  });
  root.querySelector('.close').addEventListener('click', hide);

  // ---- auto-run ----

  // Per tab, kept by the background: after a reload, the last snippet run on this page runs again.
  const autoBtn = root.querySelector('.auto');
  const setAuto = (on) => autoBtn.setAttribute('aria-pressed', String(on));
  autoBtn.addEventListener('click', () => {
    const on = autoBtn.getAttribute('aria-pressed') !== 'true';
    setAuto(on);
    chrome.runtime.sendMessage({ type: 'auto', on }).catch(() => {});
    ta.focus();
  });

  // ---- moving and resizing ----

  // Distance from the viewport's bottom-right corner, or null for the default spot. Measuring from
  // that corner keeps the size toggle growing the panel up and to the left, as it does by default.
  let pos = null;
  const header = root.querySelector('header');
  const MIN_W = 300;
  const MIN_H = 180;
  const MARGIN = 16; // matches the max-width / max-height gap in the CSS

  // Follows a drag that started with `e` on `el`, calling onMove(dx, dy), then onEnd once released.
  function track(e, el, onMove, onEnd) {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const move = (ev) => onMove(ev.clientX - e.clientX, ev.clientY - e.clientY);
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      onEnd();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // Remembers the position as it ended up on screen, not an off-screen spot it was dragged toward.
  function savePos() {
    if (!pos) return;
    pos = { right: parseFloat(panel.style.right), bottom: parseFloat(panel.style.bottom) };
    chrome.storage.local.set({ pos }).catch(() => {});
  }

  // Applies `pos`, kept fully on screen. `pos` itself isn't clamped, so a shrunk window that grows
  // back gets the panel back where it was.
  function place() {
    if (panel.hidden || !pos) return;
    panel.style.right = pos.right + 'px';
    panel.style.bottom = pos.bottom + 'px';
    const r = panel.getBoundingClientRect();
    const fit = (v, max) => Math.max(0, Math.min(v, max));
    panel.style.right = fit(pos.right, r.left + pos.right) + 'px';
    panel.style.bottom = fit(pos.bottom, r.top + pos.bottom) + 'px';
  }

  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const cs = getComputedStyle(panel);
    const start = { right: parseFloat(cs.right), bottom: parseFloat(cs.bottom) };
    header.classList.add('dragging');
    track(
      e,
      header,
      (dx, dy) => {
        pos = { right: start.right - dx, bottom: start.bottom - dy };
        place();
      },
      () => {
        header.classList.remove('dragging');
        savePos();
      },
    );
  });

  // Each grip moves its own edges; the opposite edges stay put.
  for (const grip of root.querySelectorAll('.grip')) {
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const dir = grip.dataset.dir;
      const r = panel.getBoundingClientRect();
      const cs = getComputedStyle(panel);
      const s = { w: r.width, h: r.height, right: parseFloat(cs.right), bottom: parseFloat(cs.bottom) };
      const vw = r.right + s.right;
      const vh = r.bottom + s.bottom;
      const fit = (v, min, max) => Math.max(min, Math.min(v, max));
      track(
        e,
        grip,
        (dx, dy) => {
          let { w, h, right, bottom } = s;
          if (dir.includes('w')) w = fit(s.w - dx, MIN_W, Math.min(vw - s.right, vw - 2 * MARGIN));
          if (dir.includes('e')) {
            w = fit(s.w + dx, MIN_W, Math.min(s.w + s.right, vw - 2 * MARGIN));
            right = s.right - (w - s.w);
          }
          if (dir.includes('n')) h = fit(s.h - dy, MIN_H, Math.min(vh - s.bottom, vh - 2 * MARGIN));
          if (dir.includes('s')) {
            h = fit(s.h + dy, MIN_H, Math.min(s.h + s.bottom, vh - 2 * MARGIN));
            bottom = s.bottom - (h - s.h);
          }
          panel.style.width = w + 'px';
          panel.style.height = h + 'px';
          pos = { right, bottom };
          place();
        },
        () => {
          savePos();
          const size = { width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) };
          if (size.width) chrome.storage.local.set({ size }).catch(() => {});
        },
      );
    });
  }

  header.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    pos = null;
    panel.style.right = panel.style.bottom = '';
    chrome.storage.local.remove('pos').catch(() => {});
  });

  window.addEventListener('resize', place);

  // ---- start ----

  window.__jsRunner = { toggle: () => (panel.hidden ? show() : hide()) };

  // Settings load before the panel is added, so it doesn't flash in the corner and then jump.
  chrome.storage.local
    .get(['big', 'pos', 'size'])
    .catch(() => ({}))
    .then(({ big, pos: saved, size }) => {
      panel.classList.toggle('big', !!big);
      if (saved && Number.isFinite(saved.right) && Number.isFinite(saved.bottom)) pos = saved;
      if (size && Number.isFinite(size.width) && Number.isFinite(size.height)) {
        panel.style.width = size.width + 'px';
        panel.style.height = size.height + 'px';
      }
      document.documentElement.append(host);
      // When reopened after a reload, leave focus with the page (e.g. its own search box).
      show(!restoring);
      return chrome.runtime.sendMessage({ type: 'state' });
    })
    .then((state) => {
      setAuto(!!state?.auto);
      if (restoring && state?.auto && state.last) exec(state.last, true);
    })
    .catch(() => {});
})();

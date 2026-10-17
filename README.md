# JS Runner

A small Chrome extension: click its icon (or press **Alt+Shift+J**) on any page and a panel opens
in the bottom-right corner where you can run JavaScript on that page, like the DevTools console.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `js-runner` folder.
3. Pin it from the puzzle-piece menu so the icon is one click away.
4. Recommended: click **Details** on JS Runner and turn on **Allow User Scripts**. Without it,
   pages with a strict Content Security Policy (GitHub, Google, many banks) won't let it run code.

## Use

| Key | Action |
| --- | --- |
| Enter | Run (adds a new line instead if a bracket is still open) |
| Ctrl+Enter | Always run, even if the code looks unfinished |
| Shift+Enter | New line |
| ↑ / ↓ | Previous / next snippet (history is kept across sites) |
| Ctrl+L | Clear output |
| Esc | Hide the panel |

- The panel stays open in that tab when you reload or go to another page. Close it with ✕ or Esc to stop that. The output starts empty after each reload; your snippets stay in ↑ history.
- Code runs in the page's own JavaScript context, so page globals (`window.app`, jQuery, ...) are available.
- `console.log/info/warn/error` output and uncaught errors from the page show up in the panel after the first run.
- Returned promises are awaited and their value is shown.
- Each run is its own block, so `const x = ...` can be re-run freely. Use `var x` or `window.x` to keep a value for the next run.
- To change the shortcut, go to `chrome://extensions/shortcuts`.

## Limits

- It can't run on `chrome://` pages or the Chrome Web Store (the icon flashes a red `!`).
- On strict-CSP pages (the User Scripts path), results come back as plain JSON, so a returned DOM element shows as `{}`. `console.log(el)` still prints it nicely.
- For local `file://` pages, turn on **Allow access to file URLs** in the extension's Details.

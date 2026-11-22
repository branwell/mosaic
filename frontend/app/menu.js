// Menu bar and status bar DOM. Menus are built from a declarative list so
// main.js owns the actions and the shortcut table in one place.

// Fill a dropdown element with items. Items are {label, shortcut?, action?,
// enabled?: () => bool, submenu?: () => items | Promise<items>} or 'sep'.
function fillItems(dd, items, { run, close, formatShortcut }) {
  dd.replaceChildren();
  for (const it of items) {
    if (it === 'sep') {
      const sep = document.createElement('div');
      sep.className = 'separator';
      dd.appendChild(sep);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'item';
    const label = document.createElement('span');
    label.textContent = it.label;
    row.appendChild(label);
    if (it.shortcut) {
      const sc = document.createElement('span');
      sc.className = 'shortcut';
      sc.textContent = formatShortcut(it.shortcut);
      row.appendChild(sc);
    }
    if (it.empty) row.classList.add('empty');
    if (it.enabled && !it.enabled()) row.setAttribute('aria-disabled', 'true');
    if (it.submenu) {
      row.classList.add('has-submenu');
      const sub = document.createElement('div');
      sub.className = 'dropdown';
      row.appendChild(sub);
      Promise.resolve(it.submenu()).then(subItems => {
        fillItems(sub, subItems.length ? subItems : [{ label: 'No recent files', empty: true }], { run, close, formatShortcut });
      });
    } else if (it.action) {
      row.addEventListener('click', () => { close(); run(it.action); });
    }
    dd.appendChild(row);
  }
}

export function createMenuBar(container, menus, run, { formatShortcut = s => s } = {}) {
  let openEl = null;

  function close() {
    if (openEl) { openEl.classList.remove('open'); openEl = null; }
  }

  function open(el, spec) {
    close();
    el.classList.add('open');
    openEl = el;
    fillItems(el.querySelector(':scope > .dropdown'), spec.items, { run, close, formatShortcut });
  }

  for (const spec of menus) {
    const el = document.createElement('div');
    el.className = 'menu';
    el.textContent = spec.label;
    const dd = document.createElement('div');
    dd.className = 'dropdown';
    el.appendChild(dd);
    el.addEventListener('pointerdown', e => {
      if (e.target !== el) return;
      e.preventDefault();
      if (openEl === el) close(); else open(el, spec);
    });
    el.addEventListener('pointerenter', () => { if (openEl && openEl !== el) open(el, spec); });
    container.appendChild(el);
  }

  document.addEventListener('pointerdown', e => { if (!container.contains(e.target)) close(); });
  window.addEventListener('blur', close);

  return { close };
}

// A context menu shown at a page position. `items` may be a function so the
// list is evaluated (and enabled states computed) each time it opens.
export function createContextMenu(items, run, { formatShortcut = s => s } = {}) {
  const el = document.createElement('div');
  el.className = 'dropdown context';
  document.body.appendChild(el);

  const close = () => el.classList.remove('open');

  function open(x, y) {
    fillItems(el, typeof items === 'function' ? items() : items, { run, close, formatShortcut });
    el.classList.add('open');
    const margin = 4;
    el.style.left = Math.max(margin, Math.min(x, window.innerWidth - el.offsetWidth - margin)) + 'px';
    el.style.top = Math.max(margin, Math.min(y, window.innerHeight - el.offsetHeight - margin)) + 'px';
  }

  document.addEventListener('pointerdown', e => { if (!el.contains(e.target)) close(); });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && el.classList.contains('open')) { close(); e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('blur', close);

  return { open, close, isOpen: () => el.classList.contains('open') };
}

export function createStatusBar({ zoomValue, selectionInfo, message }) {
  let timer = null;
  return {
    setZoom(zoom) { zoomValue.textContent = Math.round(zoom * 100) + '%'; },
    setSelection(text) { selectionInfo.textContent = text; },
    message(text, { error = false, ms = 4000 } = {}) {
      clearTimeout(timer);
      message.textContent = text;
      message.classList.toggle('error', error);
      timer = setTimeout(() => { message.textContent = ''; message.classList.remove('error'); }, ms);
    },
  };
}

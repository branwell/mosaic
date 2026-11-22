// Key strings: normalizing what keymap.js says, naming a KeyboardEvent the
// same way, formatting for display, and validating the whole map.

import { keymap, heldActions, reservedKeys } from './keymap.js';

const MODIFIERS = ['Ctrl', 'Shift', 'Alt'];
const MODIFIER_ALIASES = {
  ctrl: 'Ctrl', control: 'Ctrl', cmd: 'Ctrl', command: 'Ctrl', meta: 'Ctrl',
  shift: 'Shift', alt: 'Alt', option: 'Alt',
};
const KEY_ALIASES = {
  del: 'Del', delete: 'Del', esc: 'Escape', escape: 'Escape', enter: 'Enter', return: 'Enter',
  space: 'Space', ' ': 'Space', backspace: 'Backspace', tab: 'Tab',
  left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
  arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
};
const PUNCTUATION = new Set(['[', ']', '=', '-', ',', '.', '/', ';', "'", '\\', '`']);

// KeyboardEvent.code -> key name, for keys whose code is not Key* or Digit*.
const CODE_KEYS = {
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/',
  Semicolon: ';', Quote: "'", Backslash: '\\', Backquote: '`',
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Delete: 'Del', Backspace: 'Backspace', Tab: 'Tab',
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
};
for (let i = 1; i <= 12; i++) CODE_KEYS['F' + i] = 'F' + i;

// Canonical form: "Ctrl+Shift+Alt+Key" with modifiers in that order.
export function normalizeKey(text) {
  const parts = String(text).split('+').map(p => p.trim());
  if (parts.length === 0 || parts[parts.length - 1] === '') throw new Error(`empty key in "${text}"`);
  const mods = new Set();
  for (const p of parts.slice(0, -1)) {
    const m = MODIFIER_ALIASES[p.toLowerCase()];
    if (!m) throw new Error(`unknown modifier "${p}" in "${text}"`);
    mods.add(m);
  }
  const raw = parts[parts.length - 1];
  let key = KEY_ALIASES[raw.toLowerCase()];
  if (!key) {
    if (/^[a-z0-9]$/i.test(raw) || /^F([1-9]|1[0-2])$/i.test(raw)) key = raw.toUpperCase();
    else if (PUNCTUATION.has(raw)) key = raw;
    else throw new Error(`unknown key "${raw}" in "${text}"`);
  }
  return MODIFIERS.filter(m => mods.has(m)).map(m => m + '+').join('') + key;
}

// The canonical name of a keyboard event, or null for keys the map cannot
// express. Ctrl and ⌘ both count as Ctrl.
export function eventKeyName(e) {
  let k;
  if (e.code.startsWith('Key')) k = e.code.slice(3);
  else if (e.code.startsWith('Digit')) k = e.code.slice(5);
  else k = CODE_KEYS[e.code];
  if (!k) return null;
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.altKey ? 'Alt+' : '') + k;
}

export function stripModifiers(key) {
  return key.replace(/^(Ctrl\+|Shift\+|Alt\+)+/, '');
}

const DISPLAY_KEYS = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
const MAC_KEYS = { ...DISPLAY_KEYS, Backspace: '⌫', Del: '⌦', Enter: '↩', Escape: 'Esc' };

// Human-readable form. On macOS: ⌥⇧⌘K; elsewhere: Ctrl+Shift+Alt+K.
export function formatKey(key, mac) {
  if (!key) return '';
  const base = stripModifiers(key);
  const has = m => key.includes(m + '+');
  if (mac) return (has('Alt') ? '⌥' : '') + (has('Shift') ? '⇧' : '') + (has('Ctrl') ? '⌘' : '') + (MAC_KEYS[base] || base);
  return MODIFIERS.filter(has).map(m => m + '+').join('') + (DISPLAY_KEYS[base] || base);
}

// Resolve keymap.js against the actions the editor actually has.
// Returns:
//   bindings: Map<key, action>   pressed shortcuts
//   held:     Map<action, key>   held keys (see heldActions)
//   primary:  Map<action, key>   first valid binding per action, for menus
//   problems: string[]           anything that was ignored, for the status bar
export function buildKeymap(actionNames) {
  const known = new Set([...actionNames, ...heldActions]);
  const reserved = new Set(reservedKeys.map(normalizeKey));
  const bindings = new Map(), held = new Map(), primary = new Map(), problems = [];

  for (const [action, value] of Object.entries(keymap)) {
    if (!known.has(action)) { problems.push(`unknown action "${action}"`); continue; }
    const list = value == null ? [] : [].concat(value);
    for (const text of list) {
      let key;
      try { key = normalizeKey(text); } catch (err) { problems.push(err.message); continue; }
      if (reserved.has(key)) { problems.push(`${text} is reserved by the browser (${action})`); continue; }
      if (bindings.has(key)) { problems.push(`${text} bound to both ${bindings.get(key)} and ${action}`); continue; }
      if (heldActions.includes(action)) held.set(action, key);
      else bindings.set(key, action);
      if (!primary.has(action)) primary.set(action, key);
    }
  }
  return { bindings, held, primary, problems };
}

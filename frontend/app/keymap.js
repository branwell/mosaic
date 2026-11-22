// Keyboard shortcuts. Edit this file to change a binding; nothing else needs
// to change. The menu bar, the context menu and the key handler all read it.
//
// Format
//   action: 'Ctrl+Shift+K'              one binding
//   action: ['Ctrl+Y', 'Ctrl+Shift+Z']  several; the first is shown in menus
//   action: null                        unbound (menu only)
//
// Keys
//   Modifiers: Ctrl, Shift, Alt, in any order, joined with '+'.
//   Write Ctrl even on a Mac: the handler accepts ⌘ wherever Ctrl is written,
//   and menus display ⌘ on macOS. Cmd+ and Meta+ are accepted spellings.
//   Main key: a letter A–Z, a digit 0–9, one of  [ ] = - , . / ; ' \ `
//   or a named key: Space, Enter, Escape, Del, Backspace, Tab,
//   ArrowLeft, ArrowRight, ArrowUp, ArrowDown, F1–F12.
//
// Browsers keep Ctrl/⌘ + N, T and W (and their Shift variants) for
// themselves; the page never sees those, so they are rejected here.
// Unknown actions, duplicate keys and reserved keys are reported in the
// status bar when the editor loads.

export const keymap = {
  // File
  open: 'Ctrl+O',
  save: 'Ctrl+S',
  saveAs: 'Ctrl+Shift+S',
  import: 'Ctrl+I',
  exportPng: 'Ctrl+E',
  exportSelection: 'Ctrl+Shift+E',

  // Edit
  undo: 'Ctrl+Z',
  redo: ['Ctrl+Y', 'Ctrl+Shift+Z'],
  cut: 'Ctrl+X',     // cut the region (Region tool)
  copy: 'Ctrl+C',    // copies the region if there is one, otherwise the selected sprites
  paste: 'Ctrl+V', // Ctrl+V also brings in images from the system clipboard
  duplicate: 'Ctrl+D',
  delete: ['Del', 'Backspace'], // clears the region to transparent if there is one
  selectAll: 'Ctrl+A',
  crop: 'c',

  // Arrange
  group: 'Ctrl+G',
  ungroup: 'Ctrl+Shift+U',
  front: 'Ctrl+Shift+]',
  back: 'Ctrl+Shift+[',
  alignLeft: null,
  alignRight: null,
  alignTop: null,
  alignBottom: null,
  alignHCenter: null,
  alignVCenter: null,
  sideBySide: null,
  stack: null,
  flatten: 'Ctrl+F', // replaces the browser's Find on the editor page

  // View
  zoomIn: ['Ctrl+=', 'Ctrl+Shift+='],
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  fitAll: 'Ctrl+1',

  // Nudge the selection by 1 px, or 10 px with the Big variants
  nudgeLeft: 'ArrowLeft',
  nudgeRight: 'ArrowRight',
  nudgeUp: 'ArrowUp',
  nudgeDown: 'ArrowDown',
  nudgeLeftBig: 'Shift+ArrowLeft',
  nudgeRightBig: 'Shift+ArrowRight',
  nudgeUpBig: 'Shift+ArrowUp',
  nudgeDownBig: 'Shift+ArrowDown',

  // Tools (also in the tool palette)
  toolSelect: 'V',
  toolRegion: 'M',

  // Modes
  escape: 'Escape', // leave crop mode discarding changes; close menus; clear region, else selection
  enter: 'Enter',   // leave crop mode keeping changes

  // Held keys: active while pressed
  pan: 'Space',     // hold and drag with the left button to pan
};

// Actions that are held rather than pressed.
export const heldActions = ['pan'];

// Combinations the browser does not pass to the page.
export const reservedKeys = ['Ctrl+N', 'Ctrl+T', 'Ctrl+W', 'Ctrl+Shift+N', 'Ctrl+Shift+T', 'Ctrl+Shift+W'];

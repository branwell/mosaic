# Mosaic — Specification

This document is authoritative for approved behavior. `README.md` is orientation only; `status.md` holds loose ends. If this document conflicts with the code, the document wins until it is changed deliberately.

## 1. Principles

- **Image Composer, not Photoshop.** The unit of work is a free-floating *sprite* on an infinite canvas, not a layer in a fixed frame. Composition is arrangement.
- **Originals are never altered.** Every imported or pasted image is kept byte-for-byte. Scale is a display property. Only *crop*, the *region* operations (copy, cut, delete), *placing text*, *flatten* and *export* produce new pixels, and they create new assets rather than modifying existing ones.
- **Self-contained files.** A saved `.mmsc` reproduces the canvas exactly, on any machine, with no external references.
- **Local and offline.** No network access beyond the browser talking to the local server on loopback. No outside dependencies at build or run time.
- **Platform-aware shortcuts.** The modifier is ⌘ on macOS and Ctrl elsewhere; this document writes Ctrl. Wheel zooms, right or middle button pans, right-click opens the context menu.
- **Dark theme.** The UI is dark by default, as is traditional for image tools.

## 2. Document model

A *document* is one canvas and everything on it. One document per browser tab.

### 2.1 Entities

**Image** — an immutable asset: the original bytes of a pasted or imported file plus its decoded pixel size.

| Field | Meaning |
|---|---|
| `id` | Unique within the document (random, URL-safe). |
| `ext` | File extension derived from the MIME type: `png`, `jpg`, `gif`, `webp`, `bmp`, `svg`. |
| bytes | The original file contents. Clipboard pastes arrive from Chrome as PNG. |
| `width`, `height` | Natural pixel size of the decoded image. |

**Sprite** — a placed instance of an image.

| Field | Meaning |
|---|---|
| `id` | Unique within the document. |
| `image` | Id of the image it shows. Several sprites may share one image (duplicate, copy/paste). |
| `x`, `y` | Top-left corner in canvas pixels. |
| `w`, `h` | Display size in canvas pixels. May differ from the natural size (scale) or from the crop size (scale of a crop). |
| `crop` | Optional. `{x, y, w, h}` in *source* pixels of the image. Absent means the whole image. Present only while a crop session is open, or on sprites saved by earlier versions; Mosaic reads and draws it, and leaving crop mode on such a sprite applies it (see Crop). |
| `group` | Optional. Id of the group the sprite belongs to. |

Z-order is the order of the `sprites` array: later entries draw on top. New sprites are appended (on top).

**Group** — a flat set of sprites that is selected, moved, scaled and aligned as one unit. Groups do not nest. A group is defined by the sprites that reference it; a group with fewer than two members is dissolved. Ungrouping removes the group id from its members.

### 2.2 Canvas and coordinates

- The canvas is infinite. There is no frame, page or fixed export area.
- Canvas units are pixels. A sprite with `w = 400` occupies 400 screen pixels at 100% zoom and renders as 400 pixels wide in any export.
- The view is a zoom factor and a pan offset. Zoom, pan and the window size never affect the document, only how it is displayed.
- Sprites may be anywhere, including far from each other; the exports use the bounding box of their content.

### 2.3 Operations

All operations below are recorded on the undo stack unless stated otherwise.

- **Import** creates an image asset and one sprite at natural size, positioned at the drop point or the center of the view.
- **Move** changes `x`, `y`.
- **Scale** changes `w`, `h`. Proportional by default; stretching one axis requires the Shift modifier. Scaling a group scales all members about the group's bounding box.
- **Crop** removes the trimmed parts of the image. During a crop session the sprite carries a temporary `crop` rectangle; leaving crop mode (other than with Escape) creates a new PNG image holding only the kept pixels at the image's natural resolution, points the sprite at it and clears `crop`. The original image is not modified: other sprites sharing it are unaffected, and undo restores the uncropped sprite. Once applied, trimmed pixels cannot be recovered by re-entering crop mode. The displayed size `w`, `h` is adjusted so that the visible pixels keep their current on-canvas scale. Cropping a JPEG, WebP or SVG yields a PNG, which may be larger.
- **Clear region** (Cut or Delete with a region) gives the sprite a new PNG image of its visible pixels with the region filled with the background color (see 4.12) or, when the background is transparent, made fully transparent, and clears `crop`. The original image is not modified, and undo restores the sprite. Position and size are unchanged.
- **Move region** gives the sprite a new PNG image of its visible pixels in which the region is first cleared as in Clear region, then its original pixels are drawn at the new position as a paste: drawn over what is there, so transparent parts of the moved pixels show the image beneath. Pixels moved past the image's edge are clipped off; the image does not grow. One undo step per drag. The region follows to the new position, clipped to the image. Clears `crop`; the original image is not modified.
- **Paste pixels** creates a new sprite from copied region pixels (a new PNG image at the source resolution), placed over the canvas rectangle the region was copied from at the same display scale, appended on top and selected.
- **Place text** creates a new PNG image of the typed text, drawn in one font, size and color at true pixel size and trimmed to the drawn pixels, and one sprite at natural size where the text box showed it, appended on top and selected. The text itself is not kept: from then on it is an ordinary image sprite.
- **Group / Ungroup** set or clear `group` on the selected sprites.
- **Bring to Front / Send to Back** move the selected sprites (keeping their relative order) to the end or start of the `sprites` array.
- **Align** moves sprites so an edge or center matches the *reference* sprite, which is the first sprite that was selected. Variants: Left, Right, Top, Bottom, Horizontal Center, Vertical Center. Each moves along one axis only.
- **Side by side (horizontal)** keeps the selected sprites in left-to-right order, leaves the leftmost where it is, and slides each of the others so its left edge touches the previous sprite's right edge. Vertical positions are untouched. **Stack (vertical)** is the same for top-to-bottom order. Groups participate as single units by their bounding box.
- **Duplicate** creates copies of the selected sprites sharing the same images, offset by 20 px right and down, appended on top, and selects the copies.
- **Copy / Paste (internal)** copies the selected sprites' records; paste creates copies as Duplicate does. Copy also puts the selection on the system clipboard as one PNG, rendered as it appears (as Export Selection does), for pasting into other applications.
- **Delete** removes the selected sprites. Images no longer referenced by any sprite are dropped when the document is saved (they stay in memory for undo).
- **Flatten** replaces the selected sprites (two or more, or a group) with one new sprite: a new PNG image whose pixels are the selection rendered exactly as it appears, sized to the selection's bounding box, transparent wherever nothing was drawn, placed at the bounding box's top-left. Undo restores the original sprites.
- **Undo / Redo** cover every operation above. The stack is per document and is cleared on New and Open.

Not operations: zoom, pan, selection changes, tool changes, region selection, and entering crop mode are not undoable. Copy changes only the clipboards.

## 3. File format: `.mmsc`

A `.mmsc` file is a ZIP archive. It is the only project format and is self-contained.

```text
document.json       the document (deflate)
images/<id>.<ext>   one entry per image asset, original bytes (stored, no compression)
```

`document.json`:

```json
{
  "version": 1,
  "view": { "zoom": 1, "panX": 0, "panY": 0 },
  "images": [ { "id": "k3f9", "ext": "png", "width": 640, "height": 480 } ],
  "sprites": [
    { "id": "a1", "image": "k3f9", "x": 100, "y": 50, "w": 640, "h": 480 },
    { "id": "a2", "image": "k3f9", "x": 800, "y": 50, "w": 160, "h": 120,
      "crop": { "x": 0, "y": 0, "w": 320, "h": 240 }, "group": "g1" }
  ]
}
```

Rules:
- `version` is an integer; readers refuse a higher version than they know.
- Every `sprites[].image` must name an entry in `images`, and every `images[]` entry must have a file at `images/<id>.<ext>`. Unreferenced images are not written.
- Groups have no record of their own; they exist through `sprites[].group`.
- `view` is restored on open so the user sees what they saved.
- Only the Go backend reads and writes the archive. The browser exchanges the parts (document plus image blobs) with it over the local API.

## 4. Interaction model

Shortcuts below are the defaults. They are defined in one data file, `frontend/app/keymap.js`, which maps action names to key strings; editing that file changes the key handler, the menu bar and the context menu together. Shortcuts are written with Ctrl; on macOS the same shortcuts use ⌘ and the menus show ⌘ and ⇧. Browsers reserve a few combinations (Ctrl/⌘+N, T, W), so the file rejects them, and any unknown action, duplicate key or reserved key is reported in the status bar at startup. There is no settings interface; editing the file is the supported way to change bindings.

### 4.0 Tools

The tool palette on the left of the canvas holds one button per tool; the active tool is highlighted. The tool decides what a left press or drag on the canvas does. Panning, zooming, the context menu and crop mode work the same in every tool.

| Tool | Key | Left press or drag |
|---|---|---|
| Select | V | Select, marquee, move and scale, as in 4.1–4.3. Double-click enters crop mode. |
| Region | M | Select a rectangle of pixels in the selected sprite (see 4.11). Scale handles are hidden. |
| Text | T | Open a text box at the click point (see 4.13). Scale handles are hidden. |

The editor starts with Select. Shift-dragging inside the one selected sprite switches to Region (4.1); a press outside the selected sprite in Region switches back to Select (4.11). Pasting copied pixels and placing text switch to Select so the new sprite can be moved at once.

Below the tools, separated by a line, the palette holds the background color swatch (see 4.12).

### 4.1 Selection

| Gesture | Effect |
|---|---|
| Left-click a sprite | Select it alone. If it is in a group, select the whole group. |
| Shift + left-click | Add to or remove from the selection (whole group if grouped). |
| Shift + left-drag inside the one selected sprite | Switch to the Region tool and draw a region (see 4.11). Applies when exactly one ungrouped sprite is selected and the press starts inside it; a press that moves no more than a few pixels is a Shift-click instead. Starting on a handle still scales. |
| Left-drag on empty canvas | Marquee; sprites whose bounds intersect the marquee are selected on release. Shift adds to the existing selection. |
| Left-click empty canvas | Clear selection. |
| Ctrl + A | Select all. |
| Right-click | Context menu; see Arranging. |
| Delete / Backspace | Delete selection. |

The *reference* sprite for alignment is the first sprite added to the current selection. It is drawn with a distinct outline.

### 4.2 Moving and nudging

| Gesture | Effect |
|---|---|
| Left-drag a selected sprite | Move the whole selection. Dragging an unselected sprite selects it first. |
| Arrow keys | Nudge selection 1 px. |
| Shift + arrow keys | Nudge 10 px. |

### 4.3 Scaling

A single selected sprite or group shows eight handles on its bounding box.

| Gesture | Effect |
|---|---|
| Drag a corner handle | Scale proportionally about the opposite corner. |
| Drag an edge handle | Scale proportionally about the opposite edge, keeping the center of that edge. |
| Shift while dragging a handle | Unlock proportions: corners scale freely, edges stretch one axis. |

Minimum size is 1 px on each axis.

### 4.4 Cropping

Crop mode applies to exactly one ungrouped selected sprite.

| Gesture | Effect |
|---|---|
| Double-click a sprite, Edit ▸ Crop, the context menu, or C | Enter crop mode. The full image is shown dimmed outside the crop rectangle; the crop rectangle has edge and corner handles. |
| Drag a crop handle | Move that edge in source pixels. Edges clamp to the image bounds and to 1 px minimum. |
| Enter or click outside | Leave crop mode and apply the crop: the trimmed pixels are removed (see Crop under Operations). |
| Escape | Leave crop mode, reverting the change made in this crop session. |

### 4.5 Arranging

Menu **Edit** has Cut, Copy and Paste; Cut is enabled only with a region.

Menu **Arrange**: Group (Ctrl+G), Ungroup (Ctrl+Shift+U), Bring to Front (Ctrl+Shift+]), Send to Back (Ctrl+Shift+[), Align Left / Right / Top / Bottom / Horizontal Center / Vertical Center, Side by Side, Stack, Flatten (Ctrl+F; the editor takes this key from the browser's Find). Items that need more than one sprite are disabled otherwise.

**Context menu.** A right-click on the canvas that does not pan (less than a few pixels of movement) opens a context menu at the pointer with Cut, Copy, Crop, Duplicate, Delete and all the Arrange items. Right-clicking an unselected sprite selects it first; right-clicking a selected sprite keeps the current selection so the commands apply to all of it. Escape or a click elsewhere closes it.

### 4.6 Clipboard

| Gesture | Effect |
|---|---|
| Ctrl + C | With a region: copy its pixels to the internal clipboard and, as PNG, to the system clipboard. Otherwise copy the selected sprites: their records to the internal clipboard and, as one PNG of the selection as it appears, to the system clipboard. |
| Ctrl + X | With a region: copy it as Ctrl+C does, then clear it to the background color (see 4.12). |
| Ctrl + V | If the system clipboard holds an image that Mosaic itself copied, paste the internal clipboard: copied sprites as Duplicate does, region pixels in place (see Paste pixels). If it holds any other image, import it as a new sprite at the view center. Otherwise, paste the internal clipboard. |
| Ctrl + D | Duplicate selection. |

Mosaic recognises its own copy by pixel size: Chrome re-encodes images it places on the system clipboard, so the bytes differ from what was copied. An outside image of exactly the same size is taken for Mosaic's own.

### 4.7 Navigation

| Gesture | Effect |
|---|---|
| Mouse wheel | Zoom in or out about the pointer. |
| Right-drag or middle-drag | Pan. A right-click without movement opens the context menu instead. |
| Space + left-drag | Pan (alternative). |
| Ctrl + 0 | Reset zoom to 100%. |
| Ctrl + 1 | Fit all sprites in view. |

A zoom readout in the status bar shows the current percentage and offers Reset and Fit All.

Zoom range is 5% to 3200%. The context menu is suppressed on the canvas so right-drag can pan.

### 4.8 Importing

| Gesture | Effect |
|---|---|
| Drop image files from the OS onto the canvas | One sprite per file at the drop point, offset so they do not overlap exactly. |
| File ▸ Import Images (Ctrl+I) | Multi-select file picker; sprites placed at the view center. |
| Ctrl + V with image data | See Clipboard. |

Accepted: any format the browser decodes (PNG, JPEG, GIF first frame, WebP, BMP, SVG). Files that fail to decode are reported in a brief message and skipped.

### 4.9 Files

Menu **File**: New (no shortcut; browsers reserve Ctrl+N), Open (Ctrl+O), Open Recent ▸, Save (Ctrl+S), Save As (Ctrl+Shift+S), Import Images (Ctrl+I), Export PNG (Ctrl+E), Export Selection as PNG (Ctrl+Shift+E).

- Open and Save As use the browser's native file dialogs (`showOpenFilePicker`, `showSaveFilePicker`) with the `.mmsc` type suggested. Save writes to the handle retained from Open or Save As; a never-saved document falls back to Save As.
- Export PNG renders the bounding box of all sprites; Export Selection as PNG renders the bounding box of the selection. Both are transparent where nothing is drawn, at true pixel size, and go through a save dialog suggesting a `.png` name.
- The document is *dirty* after any undoable operation and clean after Save, Save As, New or Open. Closing or reloading a dirty tab prompts the browser's leave-page warning. New and Open on a dirty document ask for confirmation first.
- Open Recent lists the last ten file handles stored in the browser's IndexedDB. Chrome may ask for permission again before reading one.
- The window title is `name.mmsc — Mosaic`, with a leading `•` when dirty.

### 4.10 Undo

Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo. Unlimited within the session.

### 4.11 Region

A *region* is a rectangle of pixels inside one sprite. It applies to exactly one ungrouped selected sprite, so a sprite must be selected first.

| Gesture (Region tool) | Effect |
|---|---|
| Left-drag inside the region | Move the region's pixels within the image (see Move region). While dragging, the space left behind already shows the background color and the pixels follow the pointer in whole source-pixel steps. The region moves with them. |
| Left-drag elsewhere inside the selected sprite | Draw a new region, replacing any existing one. Edges snap to whole source pixels and clamp to the sprite. |
| Left-click inside the selected sprite | Clear the region. |
| Left press outside the selected sprite | Switch to the Select tool, then act as a Select-tool press: a click on another sprite selects it (Shift adds it), a click on empty canvas clears the selection, a drag on empty canvas draws a marquee. The region is cleared. |
| Escape | Clear the region; a second Escape clears the selection. |
| Ctrl + C, Ctrl + X, Delete / Backspace | Copy, cut, or clear the region to the background color (see Clipboard, Operations and 4.12). The region stays after cut and delete. |

Over the region the cursor is a move cursor; elsewhere in the sprite, a crosshair. The region is drawn as a dashed light line over a solid dark one. It is stored in source pixels relative to the sprite's visible part, so moving, nudging or scaling the sprite keeps it on the same pixels. It disappears when the sprite stops being the only selected sprite, when crop mode is entered, when the tool changes, or when an undo leaves it outside the sprite. The status bar shows its size and position in source pixels.

### 4.12 Background color

The background color is what Cut and Delete leave in a region. It is an opaque color or *transparent*; there is no partial transparency. It does not affect flatten or the exports, which stay transparent wherever nothing is drawn.

| Gesture | Effect |
|---|---|
| Click the background swatch in the tool palette | Open a small panel beside it with Transparent, White, Black and a custom color. Its tooltip names the current color. |
| Click Transparent, White or Black | Set the background and close the panel. |
| Click the custom color | Open the browser's color picker; the background follows the chosen color as it changes. |
| Click elsewhere or Escape | Close the panel. |

The swatch shows the current color, or a checkerboard when transparent; the current choice in the panel is outlined. The background is an editor setting, not part of the document: it is remembered in this browser (local storage) and is not saved in `.mmsc` files. It starts as transparent.

### 4.13 Text

The Text tool adds text as an image. Text is edited only while its box is open; once placed it is pixels like any other sprite.

| Gesture (Text tool) | Effect |
|---|---|
| Left-click on the canvas | Open a text box with its top-left at the click point. A bar above it (below it near the top edge) holds the font, the size and the color. |
| Type | Enter starts a new line. The box grows with the text and shows it at the current zoom in the chosen font, size and color. |
| Change font, size or color | Applies to all of the box's text at once. |
| Click the canvas, click outside the box, Escape, or Ctrl+Enter | Place the text (see Place text) and switch to Select with it selected. A box with no visible characters places nothing. |
| Ctrl shortcuts other than text editing (for example Ctrl+S) | Place the text, then run the shortcut. Undo, redo, cut, copy, paste, select all and delete act on the text in the box. |

Size is in canvas pixels, so text placed at size 32 is 32 pixels tall at 100% zoom however the view is zoomed while typing. Fonts are a fixed list of common families, each with a generic fallback, using what is installed on the machine; because the result is pixels, a placed text looks the same on a machine without that font. Line height is 1.25 times the size. Font, size and color are editor settings remembered in this browser (local storage), not part of the document; they start as the system sans-serif, 32 and white. Switching to another application while typing keeps the box open.

## 5. User interface

- Full-window layout: a menu bar on top (File, Edit, Arrange, View), a narrow tool palette down the left edge (tools, then the background color swatch), the canvas filling the remainder, and a one-line status bar at the bottom (zoom readout, selection summary, transient messages).
- Dark theme throughout, defined as CSS custom properties in `frontend/shared/styles.css`. Canvas background is a dark neutral; a subtle dot grid marks canvas pixels at 100% and scales with zoom.
- Selected sprites show a thin accent outline; the reference sprite's outline is thicker. Handles are small filled squares.
- Groups are outlined as one bounding box when selected.
- Transient errors (decode failure, save failure) appear in the status bar for a few seconds; nothing modal.

## 6. Local API

Served by the Go binary alongside the static files. Loopback only. Every response, static or API, carries the header `X-Mosaic: 1` so a starting instance can recognise a running one.

| Method and path | Request | Response |
|---|---|---|
| `POST /api/pack` | `multipart/form-data`: field `document` (JSON text) and one or more `image` file parts named `<id>.<ext>` | `application/octet-stream`: the `.mmsc` bytes |
| `POST /api/unpack` | body: `.mmsc` bytes | JSON `{ "document": <document.json>, "images": { "<id>.<ext>": "<base64>" } }` |

Errors return a plain-text message with status 400 (bad input) or 500. The backend validates the document's `version` and that images and sprites agree, and does not otherwise interpret the document.

## 7. Code organization

```text
backend/main.go       flags (-addr, -frontend), static file server, API mount
backend/api/          HTTP handlers; translate between HTTP and mmsc
backend/mmsc/         Pack and Unpack; the only code that knows the archive layout
frontend/index.html   page shell: menu bar, canvas, status bar
frontend/app/main.js      wiring, keyboard shortcuts, menu actions
frontend/app/document.js  model (images, sprites, groups), mutations, undo/redo, dirty flag
frontend/app/view.js      canvas rendering, zoom/pan transform, hit-testing, handle geometry
frontend/app/tools.js     pointer interactions: select, marquee, move, scale, crop, pan
frontend/app/arrange.js   align, side by side, stack, z-order, group/ungroup
frontend/app/raster.js    render sprites to an offscreen canvas and encode PNG (flatten, exports, crop, region pixels, text)
frontend/app/region.js    region geometry and the region operations (copy, clear, paste pixels)
frontend/app/text.js      the Text tool's text box and options; places text as a new image sprite
frontend/app/files.js     import (paste, drop, picker), open/save via File System Access API, recent files, API calls
frontend/app/menu.js      menu bar, context menu and status bar DOM
frontend/app/keymap.js    the shortcut table: action name -> key string(s); the one file to edit for bindings
frontend/app/keys.js      key-string normalizing, event naming, display formatting, keymap validation
frontend/shared/styles.css dark theme tokens and layout
```

The document module has no DOM or canvas dependency. The view converts between screen and canvas coordinates; everything else works in canvas pixels.

## 8. Design decisions

- **Free sprites on an infinite canvas, no frame.** Matches Image Composer's working style and the owner's description. Exports use the content bounding box, so no frame is needed.
- **Go backend, stdlib only.** Needed for ZIP packing without a browser library, and it serves the page on loopback so the File System Access API has a secure context. It owns the `.mmsc` format so the browser never parses archives.
- **Name: Mosaic, extension `.mmsc`.** Renamed from imbrica (extension `.imbr`) on 2026-11-21, before any release. Files saved as `.imbr` were prototype files only; nothing reads them under the old name.
- **ZIP for `.mmsc`.** Canonical container for compound documents (`.docx`, `.sketch`, `.epub`), inspectable by renaming, keeps images byte-identical. Chosen over base64-in-JSON for size and inspectability, and over a project folder because one file is self-contained and the user chooses where it goes.
- **Chrome/Edge required.** Only the File System Access API gives a real Save As dialog and write-back to the same file from a web page. Safari and a desktop wrapper (for example Wails) are future options that reuse the same frontend.
- **Default port 47615, with ordered fallback.** An uncommon port below the macOS ephemeral range (49152 and up) rarely collides. When it is busy, the server first checks whether the holder is Mosaic (by its `X-Mosaic` header) and, if so, reports the address and exits rather than running twice. Otherwise it tries the next nine ports in order. Ordered rather than random fallback keeps the origin, and with it the browser's per-origin Open Recent list, stable from run to run. An explicit `-addr` is used exactly, since the user chose it. Chosen 2026-11-21.
- **Destructive crop, applied on leaving crop mode.** Replaced non-destructive crop (a stored source rectangle) on 2026-11-21 at the owner's request: cropping should actually remove the cropped parts. Like flatten, it creates a new image rather than editing the original, so originals stay byte-for-byte and undo works. The new image is always PNG: lossless, at the cost of larger files than a JPEG source; re-encoding as JPEG would degrade quality on every crop. The `crop` field stays readable so sprites saved with a stored crop still open correctly.
- **Flat groups, ungroup to edit.** Simplest model that supports "move and align these as one."
- **Reference sprite = first selected.** More predictable than bounding-box alignment when snapping one image to another.
- **Undo by snapshot.** Each operation snapshots the sprite and image-metadata arrays (small records; pixel data is never copied). Flatten is undoable because originals stay in memory until the document is saved and closed.
- **Scale proportional by default, Shift to distort.** Image composition rarely wants distortion.
- **Front/Back only.** Forward/Backward stepping deferred until needed.
- **Right-click is both pan and menu.** Distinguished by movement: a press that moves more than a few pixels pans, a still press opens the context menu on release. Keeps one-handed navigation without losing the menu.
- **Shortcuts are stored as Ctrl and displayed per platform.** The key handler accepts Ctrl or ⌘ for every shortcut, so the same tables serve both platforms.
- **Shortcuts live in a data file, not in the menu code.** `keymap.js` is a plain object so it can later become the default layer under a user override (a JSON file or browser storage) if a settings interface is wanted. Menus reference actions only and look their keys up. It is a JavaScript module rather than JSON because it needs no fetch at startup and allows a comment beside each binding. Invalid entries are skipped and reported while the rest of the map loads, so a typo never stops the editor.
- **Tool palette with Select and Region tools.** Added 2026-11-21 so pixel-level actions have a home without overloading the Select tool's gestures; further tools join the palette. Crop stays a mode entered from any tool rather than becoming a tool. Tools have single-letter shortcuts (V, M), following image-editor convention.
- **Region inside one selected sprite, rectangle only.** The owner's choice: a region is "part of an image", so a sprite is selected first. A region spanning several sprites (copying a composite) and other shapes (ellipse, lasso) are not planned now. Cut and delete produce a new PNG with an alpha channel, so cleared pixels are transparent whatever the source format; like crop, they never modify the original image.
- **Background color for cleared regions, transparent by default.** Added 2026-11-21 so it is visible and chosen what Cut and Delete leave behind. It is an editor setting kept in browser storage, like the active tool, rather than a document property, so the `.mmsc` format is unchanged and one choice carries across documents. Opaque or transparent only; the native color input has no alpha, and partial transparency was not asked for. It does not apply to flatten or export, whose empty areas stay transparent.
- **Shift-drag inside the selected sprite starts a region; pressing outside it returns to Select.** Agreed 2026-11-21. The owner first asked for pressing Shift alone to switch tools; that would break Shift-click and Shift-marquee additive selection whenever a sprite is selected, so the switch happens on a Shift-drag that starts inside the one selected sprite, which had no useful meaning before. A Shift-click there still removes it from the selection. Returning to Select on any press outside the selected sprite keeps Shift-click and Shift-marquee working from the Region tool as well.
- **Moving region pixels commits on every drag.** Added 2026-11-21. Each drag is one undo step that writes a new image, rather than a floating selection held until deselected; simpler, and nothing is lost between drags because the region follows the pixels. Pixels are clipped at the image edge, keeping the move "within the image", and land as a paste (composited over) so it matches Paste.
- **Region copy goes to the system clipboard too**, so pixels can be pasted into other applications. Pasting back into Mosaic places the pixels where they were copied from.
- **Sprite copy goes to the system clipboard too.** Agreed 2026-11-24. Copying sprites used to fill only the internal clipboard, so an older image left on the system clipboard (a screenshot, say) won the next paste. Copy now also writes the selection as one PNG: other applications receive the combined image, and Mosaic recognises its own copy and pastes the separate sprites. Whatever was copied last wins, as users expect.
- **Text becomes an image when placed.** Agreed 2026-11-21: the owner does not need to edit text after placing it. Drawing it into a PNG leaves the document model, the `.mmsc` format and the backend unchanged, makes every existing operation work on text, and makes the file independent of installed fonts. The cost is that placed text cannot be edited, and scaling it up blurs like any image. Fonts come from a fixed list rather than the machine's full font list, which would need a permission prompt (Local Font Access API).
- **No rotation yet.** Rotation complicates crop, alignment and flatten; deferred as a future feature.

## 9. Future features

Not in scope now; listed so they are not implemented by accident and so costly-to-reverse choices keep them possible.

- Rotation (90° steps and free) and flip
- Opacity per sprite
- Snapping and smart guides while dragging
- Editable text (kept as text after placing); bold, italic, alignment and per-character styling; choosing from every installed font
- Pixel editing beyond crop and region clear (effects, color)
- Region shapes other than rectangles (ellipse, lasso); regions spanning several sprites; resizing a region's outline after drawing it, or moving the outline without its pixels; nudging region pixels with the arrow keys; a floating selection that stays separate until committed
- Bring Forward / Send Backward
- Nested groups; editing inside a group without ungrouping
- Safari support; desktop packaging (for example Wails) with `.mmsc` file association
- Single-binary distribution with the frontend embedded

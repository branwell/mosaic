# Status — working notes

Possible bugs, loose ends, and things noticed but not fixed. Not a source of requirements; see `spec.md`.

## Loose ends

- **Not yet verified by hand in a real browser session:** Open, Save, Save As, Export and Open Recent all need user-gesture file dialogs, which the headless check cannot drive. Everything up to the dialog (packing, unpacking, PNG rendering) is covered by the automated check and the Go tests. First manual run should walk the smoke test in `runbook.md`, especially the save, inspect and reopen loop.
- **No automated frontend tests in the repo.** The prototype was checked with ad hoc headless Chrome scripts that were not kept. Adding a test tool needs approval (see `AGENTS.md`).
- **`keymap.js` and `spec.md` disagree.** `keymap.js` has zoom in and out bindings (`Ctrl+=`, `Ctrl+-`) that §4.7 doesn't list. Awaiting a decision on which is correct. (The crop key mismatch was settled as `C` on 2026-11-21.)
- **Paste from the system clipboard** relies on the browser firing a `paste` event while the canvas has focus; verified in principle only. Click the canvas once after loading if Ctrl+V seems dead.
- **Recent files** store `FileSystemFileHandle`s in IndexedDB; Chrome may re-prompt for permission on first use after a restart. Entries whose files were moved or deleted are not pruned yet.
- **Undo stack is unbounded.** Snapshots are small (sprite records only), but a very long session with thousands of edits will grow memory. Cap it if that becomes real.
- **Held arrow keys** create one undo step per repeat. Coalescing nudges into a single step would be friendlier.
- **Single-binary distribution:** the frontend is served from disk via `-frontend`. Embedding it with `embed` is a future step (listed in `spec.md`).
- **Stray `go.mod` at the repository root** (`module github.com/branwell/mosaic`, `go 1.27.4`). It governs no code: `backend/` is its own module and all imports use `mosaic/...`. It is not in the layout in `AGENTS.md`. Probably left by an accidental `go mod init`; awaiting a decision to delete it.

- **Region tool checked headless only.** Region clear, copy geometry, undo, Escape, the background fill, and drawing and moving a region with synthesized mouse events were verified in headless Chrome. Not yet checked by hand: the system clipboard write (region and sprite copy) (Chrome may ask for clipboard permission), paste-in-place after a region copy, and the custom color picker.
- **Text tool checked headless only.** Opening the box, placing on click, Escape, empty text, undo, the paste guard, and that the placed image lands where the box showed the text (Georgia, Impact) were verified in headless Chrome. Opening, typing, using the size field and placing were also verified with real (trusted) mouse and key input over the DevTools protocol, after synthetic events had missed a bug where the canvas took focus from the new box. Not yet checked by hand: the native color picker and font dropdown keeping the box open, and Ctrl shortcuts placing the text first.
- **Own-copy detection on paste is by size.** An outside image with exactly the size of the last copy (region or sprites) is pasted as Mosaic's internal clipboard instead of imported (spec §4.6). Rare; a better signal would need clipboard read permission.

## Possible bugs

(none known)

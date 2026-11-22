# Runbook

How to build, test, run and troubleshoot Mosaic. Approved behavior lives in `spec.md`; this file covers operating the software.

## Prerequisites

- Go 1.23 or later (see `backend/go.mod`). Only the standard library is used, so there is nothing to download.
- Chrome or Edge. The editor needs the File System Access API.
- No network access is needed to build or run.

## Build and test

All Go commands run from `backend/`.

| Task | Command |
|---|---|
| Test | `go test ./...` |
| Vet | `go vet ./...` |
| Format check | `gofmt -l .` (no output means all files are formatted) |
| Build check | `go build ./...` |
| Build a binary | `go build -o mosaic .` |

The frontend has no build step. Files under `frontend/` are served as they are.

## Run

```sh
cd backend
go run .
```

Then open <http://127.0.0.1:47615> in Chrome or Edge. On startup the server prints `Mosaic: serving <frontend path> on http://<addr>`. Open the address it prints: if port 47615 is busy, the server may be on a neighbouring port (see **Runtime behavior**).

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `-addr` | `127.0.0.1:47615` | Address to listen on. Keep it on loopback. An address given here is used exactly, with no fallback. |
| `-frontend` | `../frontend` | Path to the frontend folder, resolved against the current directory. |

To run a built binary from another directory, pass `-frontend` with the path to the repository's `frontend/` folder.

## Runtime behavior

- **Loopback only, no outbound connections.** The server serves the static frontend and the local API (`/api/pack`, `/api/unpack`; see `spec.md` §6). Loopback also gives the page the secure context that the File System Access API requires.
- **Busy port.** With the default address, the server tries ports 47615 to 47624 in order and uses the first free one, printing a note when it is not 47615. If a busy port is already served by Mosaic (recognised by the `X-Mosaic` response header), it prints `Mosaic is already running on http://<addr>` and exits without starting a second server. With an explicit `-addr`, a busy port is an error.
- **Frontend served from disk.** Edits to `frontend/` take effect on the next browser reload. Static responses send `Cache-Control: no-store`, so the browser does not keep stale editor files.
- **No server-side state.** Documents are files the user picks through the browser's dialogs. The Open Recent list is kept in the browser's IndexedDB (database `mosaic`), separately for each browser profile and origin.
- **Keymap check at startup.** Problems in `frontend/app/keymap.js` (unknown action, duplicate key, reserved key) are reported in the status bar when the page loads.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `frontend folder … has no index.html` at startup | `-frontend` resolves against the current directory. Run from `backend/`, or pass `-frontend` with the path to `frontend/`. |
| `Mosaic is already running on http://…` | An earlier Mosaic is still serving. Open the printed address, or stop that process first if you want to restart it (for example after changing Go code). |
| `listen on … ports 47615-47624: … address already in use` | All ten default ports are busy with other programs. Start with a free port, for example `-addr 127.0.0.1:47700`. |
| `listen on …: … address already in use` with `-addr` | The port you named is busy. Pick another one; explicit addresses do not fall back. |
| "Opening and saving files needs Chrome or Edge" | The browser lacks the File System Access API, or the page is not in a secure context. Use Chrome or Edge, and open the page on `127.0.0.1` or `localhost`, not on a LAN address. |
| Ctrl+V does not paste an image | The browser fires `paste` only while the page has focus. Click the canvas once, then paste again. |
| Open Recent asks for permission again | Chrome asks again for access to stored file handles after a restart. Allow it. An entry whose file was moved or deleted fails to open; it is not removed from the list yet (see `status.md`). |
| Recent list is empty | The list is stored per browser profile and origin. Changing the port or host (`localhost` versus `127.0.0.1`) starts a separate, empty list. This includes the server falling back to a neighbouring port because 47615 was busy; check the startup message. |
| Editor changes don't show up | Reload the page. If a module still looks stale, hard-reload (Ctrl+Shift+R). |
| Shortcut does not work or appears to be missing | Look for a keymap error in the status bar after loading. Browsers reserve some combinations (Ctrl+N, Ctrl+T, Ctrl+W). |
| "Unsaved changes" prompt on reload or close | The document has unsaved edits. Save first, or confirm to discard them. |

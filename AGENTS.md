# Mosaic — Agent Guide

## Mission

Mosaic is a simple image composition editor in the spirit of Microsoft Image Composer: an infinite canvas of free-floating image sprites that can be positioned, scaled, cropped, grouped, aligned and flattened, then saved as a self-contained `.mmsc` file or exported as a PNG.

Development is exploratory and incremental. Begin with minimal scaffolding and evolve the application through small, reviewable changes. Favor readable, maintainable code, clear separation of concerns, and minimal coupling. Avoid speculative abstractions and unnecessary complexity.

When tradeoffs arise, prioritize:

1. Data integrity and correctness (never lose or alter the user's original image bytes).
2. Approved requirements and user-visible behavior.
3. Security and safe operation (see **Operating constraints**).
4. Simplicity, readability, and maintainability.
5. Performance when required by an approved use case.

## Design approach

1. Evaluate independently of the current stack. Start with the problem, established practices, and available alternatives before considering the current implementation.
2. Challenge existing architectural decisions when feature delivery or best practices would be constrained by them. Current choices are not permanent constraints, except those listed under **Operating constraints**.
3. Distinguish logical design from implementation. Design the document model and system boundaries first, then consider storage and rendering technology.
4. Consider future requirements without overengineering. Keep plausible growth in mind when a choice would be costly to reverse (the `.mmsc` format in particular), but don't implement complexity before it's justified.
5. Make explicit recommendations, then ask. Evaluate tradeoffs and recommend the best option, even when that means suggesting changes to existing decisions.

## Operating constraints

These hold in every mode and are not up for silent revision:

- **No network.** Runtime and build must not depend on internet access or external services. Nothing is loaded from a CDN. The only network traffic is the browser talking to the local server on loopback.
- **No outside dependencies.** The Go backend uses the standard library only. The frontend is plain HTML, CSS and JavaScript with no build step. Ask before adding any library, module or tool; if one is approved, it is vendored into the repository.
- **On-prem.** The application may run in a locked-down environment. Assume no package manager, no telemetry, and no outbound connections.
- **Browser target.** Chrome or Edge (File System Access API). Other browsers are a future concern.

## Source of truth

- `spec.md` is authoritative for approved behavior: principles, the document model, the `.mmsc` format, the interaction model, UI, the local API, code organization and design decisions.
- `runbook.md` is the operating guide: build, test and run commands, runtime behavior, and troubleshooting. Keep it current when any of these change, and don't repeat its content in other documents.
- `README.md` is orientation only, not a source of requirements.
- `status.md` holds working notes (possible bugs, loose ends), not requirements. Check it before working in an area it mentions, and add to it when you find a problem that isn't being fixed now.
- If authoritative documents conflict with each other or with approved behavior, report the discrepancy and wait for instructions. Never silently reconcile them.

## Stack and boundaries

- **Backend:** Go, standard library only. One binary that serves the frontend on loopback and packs/unpacks `.mmsc` files. `backend/api/` owns HTTP concerns; `backend/mmsc/` owns the file format.
- **Frontend:** pure HTML/CSS/JavaScript on Canvas 2D, served by the Go binary. `frontend/app/` is the editor; `frontend/shared/` holds styles and small utilities.
- **Persistence:** files chosen by the user through the browser's file dialogs. No database. The `data/` folder is scratch space for local testing and is not committed.
- **Separation of concerns.** The document model (sprites, groups, images, undo) knows nothing about the DOM or canvas. Rendering, pointer interaction and file I/O are separate modules. Keep visual styles in CSS, not assigned from JavaScript.
- **Original bytes are sacred.** Imported and pasted images are stored and saved unmodified. Only flatten and export produce new pixels, and both create new assets rather than altering existing ones.

Layout (verify the working tree before editing any listed path):

```text
mosaic/
├── AGENTS.md            # Agent workflow and boundaries
├── README.md            # Orientation: what it is
├── spec.md              # Authoritative requirements and design decisions
├── runbook.md           # Build, run, runtime behavior, troubleshooting
├── status.md            # Working notes: possible bugs, loose ends
├── backend/             # Go application (stdlib only)
│   ├── go.mod
│   ├── main.go          # Entry point: flags, static server, API mount
│   ├── api/             # HTTP handlers for /api/*
│   └── mmsc/            # .mmsc pack/unpack and its tests
├── frontend/            # Static UI served by the Go binary; no build step
│   ├── index.html
│   ├── app/             # Editor modules (document, view, tools, arrange, raster, files, menu)
│   └── shared/          # Styles (dark theme) and small utilities
└── data/                # Local scratch files; not committed
```

## Conventions

`gofmt`; pass `context.Context` through request-scoped operations; wrap errors with operation context (`fmt.Errorf("pack document: %w", err)`). JavaScript uses ES modules, `const`/`let`, no transpilation. Canvas coordinates are in document pixels; convert to and from screen pixels only at the view boundary.

## Commands

Build, test and run commands are in `runbook.md`. Run the tests and `gofmt` before reporting Go work as done.

## Scope rules

**ALWAYS**
- Implement only approved scope; deferred ideas (listed under **Future features** in `spec.md`) are not implied tasks.
- Read `spec.md` before any task.
- Record agreed requirements and design decisions as they are made, in `spec.md`: requirements in the section that owns them, decisions under **Design decisions**.
- Follow the **Interaction model** in `spec.md` for any new UI, and document new gestures there.

**ASK FIRST**
- Before changing the document model, the `.mmsc` format, the architecture, or user-visible behavior.
- Before adding libraries, modules, endpoints, build steps, or features.
- Before introducing any dependency on the network or on a specific operating system.

**NEVER**
- Silently resolve conflicts between active documents; report the conflict and wait for instructions.
- Commit, reset, or discard user work unless explicitly asked.
- Claim that checks were run when they were not.
- Commit anything under `data/`.
- Hard-code absolute or machine-specific paths.
- Read, search, use, create, or modify anything in `_ignore/`. It holds the human's private working files, which are not a source of truth. Treat it as if it does not exist.

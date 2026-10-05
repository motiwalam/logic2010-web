# Logic 2010 on the web

A web version of **Logic 2010**, UCLA Philosophy's program for learning formal logic,
live at **https://motiwala.ca/logic2010/**. It has the desktop program's six exercise
modules: Symbolization, Parsing, Truth Tables, Derivations, Invalidity and Recognizing Rules.

- **No sign-up needed.** Open the site and start solving; work is saved in the browser.
- **Optional accounts** (username and password only) sync your work to the server, so you
  can pick it up on another device.
- **Everyone's saved work is public, read-only.** The *People* page lists users and their
  progress. Open anyone's work to look through it, or **fork** it into your own workspace.
- **Your own files.** Import the desktop program's work files (`derivation.rec`, … or the
  older `derwork.txt`-style files), or export yours as `.rec` files (one module, or all as a
  zip). Exported files load in the desktop program's local mode (`./run.sh --local`).
- **Both notations** of the course (notation 1 and 2), each with its own work.
- **Expand** (Derivations): shows a derivation with one rule per line (a view; the work is
  unchanged), so queued
  justifications such as `2 3 mp 5 sl adj 4 mp` become a line per step, with repeated and
  unused lines removed.
- **Tidy** (Derivations): cleans up your derivations in bulk (blank, unused and repeated
  lines; notation), after showing what will change.

The desktop program lives in the sibling repository `../logic2010`. This version reads the
same course data files (`data/`, synced with `scripts/sync-data.sh`) and writes the same work
file format.

## How it is built

| Part | Where | What |
|---|---|---|
| Engine | `src/engine/` | A TypeScript port of the desktop program's logic: data and work files, messages, formula parser, rules and scheme matching, and each module's checking. No UI code. |
| UI | `src/ui/` | React. The shell (navigation, settings, accounts, People, import/export) and one screen per module in `src/ui/modules/<module>/`. See `src/ui/README.md`. |
| Workspace | `src/workspace/` | The student's work files: kept in the browser (IndexedDB) and synced to the server when signed in. |
| Server | `server/` | Node 24, no npm dependencies: serves the app and a small JSON API for accounts and work files, stored in SQLite. See `server/README.md`. |
| Deployment | `deploy/` | `deploy/deploy.sh` builds and deploys to motiwala.ca behind Apache. See `deploy/README.md`. |

**Fidelity.** The engine is a faithful port: the same checks, verdicts, messages and saved
work as the desktop program. This is tested *differentially*: the Java programs in
`tools/oracle/` run the desktop program's own classes headless over the course data (every
formula, every problem and worked example, real student work, and thousands of generated
cases), and the tests in `tests/` compare the port's results with theirs. See `PORTING.md`
for the conventions and `NOTES.md` for the desktop program's quirks the port reproduces
(and the few places it differs).

## Development

Needs Node 24 or newer. The oracle also needs a JDK and the desktop repository at
`../logic2010` (built with its `./build.sh`).

```sh
npm install
npm run dev          # the app at http://localhost:5173/logic2010/
npm run server       # the API (and built app) at http://127.0.0.1:8710/logic2010/; the dev server proxies /api to it
npm test             # all tests
npx tsc              # type check
npm run build        # production build into dist/
tools/oracle/generate.sh   # regenerate the test fixtures from the desktop program
```

## Deploying

```sh
deploy/deploy.sh --dry-run   # show what would happen
deploy/deploy.sh             # build, upload a new release, switch to it
deploy/deploy.sh --rollback  # back to the previous release
```

The server runs as the systemd service `logic2010` on 127.0.0.1:8710; Apache proxies
`/logic2010/` to it. The database is `/var/lib/logic2010/logic2010.db`, backed up daily to
`/var/lib/logic2010/backups/`.

# Porting guide

This repository is a web version of Logic 2010. The desktop program's source is in the
sibling repository `../logic2010` (branch `main`; Java in
`logic/src/main/java/edu/ucla/phil/logic/`, course data in `data/`, overview in its
`README.md` and `data/README.md`). Detailed architecture notes live on that repository's
`reverse-engineering` branch: `git -C ../logic2010 show reverse-engineering:docs/ARCHITECTURE.md`,
and `docs/modules/{app,formula,rules,derivation,parsing,symbolizer,truthinval,server}.md`.

## The rule

**Behavior must match the desktop program.** Same checks, same verdicts, same error and
information messages (from the same message catalogues), same problem states, and the same
saved-work format (`.rec` files that the desktop program writes and reads, byte for byte
where practical). The web program reads the same `data/` files.

The *user interface* is free to differ and should improve on the desktop's where that
helps: web-native layout, clear keyboard handling, no modal-window sprawl. But every
feature a student can use on the desktop must be reachable in the web version (except those
tied to UCLA's course server: registration, submission, server backups, updates,
instructor/developer-only tools, which are replaced by this site's own accounts and sync).

## Layout

```
data/                 course data, copied from ../logic2010/data (scripts/sync-data.sh)
src/engine/           the logic engine: a port of the desktop program's non-UI code.
                      Pure TypeScript, no DOM, no React. Runs in the browser and in Node tests.
  util/               Java-compat helpers (java.ts), small generic utilities
  data/               record files, DataFiles (readable/legacy formats), Scrambler, DataSource
  program/            LogicProgram (non-formula parts), messages, options, selectors, user/digest
  problems/           ProblemSet / ProblemEntry / module framework (read, merge, write work)
  formula/            syntax tables, Expression tree, parser, schemes, FormulaParseNode,
                      TruthTableEvaluator
  rules/              rules, theorems, rule properties, ArgumentParser, BoundVariableMap, displays
  modules/<module>/   per-module models: derivation, truth, invalidity, parsing,
                      symbolization, recognition
src/ui/               React user interface
src/sync/             client for the accounts/work server API
server/               Node server: static files + accounts + work storage (no npm deps)
deploy/               deployment scripts and config for motiwala.ca
tests/                vitest tests; tests/fixtures holds oracle output
tools/oracle/         Java "oracle" programs run against the desktop program's classes
```

## Translation conventions

- **One TypeScript file per Java class** (small helper classes may share a file with the
  class that uses them). Keep the Java class and method names (so code can be
  cross-referenced), start each file with a comment naming the Java file(s) it ports, and
  keep the Java comments that explain behavior. Readable TypeScript, not transliterated
  Java: use `const`, early returns, typed fields; drop dead code the docs identify as unused.
- No `any`. `strict` TypeScript. Run `npx tsc` and `npx vitest run` before you finish.
- `Vector` → array; `Hashtable` → `Map`, **unless its iteration order is observable**
  (saved in work files, shown to the user, or deciding which of several results is used).
  Then use `JavaHashtable` from `src/engine/util/java.ts` with a hash function that
  reproduces the Java key class's `hashCode` (`stringHash` for String, the value for
  Integer; port custom `hashCode` methods exactly). Same for `Enumeration` order.
- Java semantics to watch:
  - integer division and overflow: `Math.trunc(a / b)`, `| 0`, `Math.imul`
  - `String.trim()` removes chars `<= ' '` only; `String.compareTo` compares UTF-16 units
    (JS `<` on strings does too); `toUpperCase`/`toLowerCase` on ASCII only data is safe
  - `Character.isDigit`/`isLetter` are Unicode-aware; `char` arithmetic
  - `==` on Strings in Java is identity — check what the code meant
  - `Hashtable` does not allow null keys/values
  Add small helpers to `src/engine/util/java.ts` when useful (e.g. `javaTrim`).
- **Global state.** `LogicProgram`'s static state (notation, symbol tables, links,
  options, messages, rule and theorem tables) is program-wide configuration, loaded once:
  keep it as module-level singletons. Per-student state (problem sets, work) must **not**
  be static: it belongs to a workspace object, because the web app can show another
  user's work read-only next to your own.
- **Dialogs.** Where engine code asks the user something (a Swing dialog), define an
  interface of async methods that the UI implements, and make the engine code `async`
  along that path (`await ui.chooseFormula(...)`). Where the desktop code avoids dialogs
  (serial mode, previews, restating problems) the port must also work without a UI.
- **Messages.** Message texts come from `data/messages/*.rec` through the ported
  `Message` catalogue and `<param>` substitution — never hard-code a message the catalogue
  has. Hard-coded Java strings (e.g. "Please choose a conjunct:") are kept as they are.
- **Data files** are read through `DataSource` (`src/engine/data/DataSource.ts`). Tests use
  `tests/support/fsDataSource.ts`.
- The student identity used for work-file digests is the desktop's local-mode user
  (firstName `Logic`, lastName `User`, studentID `demo`, institution `Demo`,
  `derDigestVers:1`), so that exported `.rec` files load in `./run.sh --local`.

## Testing against the oracle

`tools/oracle/` holds Java programs in package `edu.ucla.phil.logic` compiled against
`../logic2010/build/logic-classes`, so they can call the desktop program's package-private
code directly. `Oracle.init()` starts the engine headless (links, notation, messages,
options, rules, theorems, local user) from this repository's `data/`.

- `tools/oracle/build.sh` compiles; `SYNTAX=1|2 tools/oracle/run.sh <Class> [args]` runs.
- Headless AWT: creating a window throws `HeadlessException` (so an accidental dialog fails
  instead of hanging). Plain Swing components (JPanel etc.) can be created.
- Write oracle programs that print JSON, add a `tools/oracle/gen-<area>.sh` that writes
  them to `tests/fixtures/`, and write vitest tests that compare the port against the
  fixtures. Prefer broad, generated coverage (every formula in the data files, every rule,
  every worked example) over hand-picked cases. Commit the fixtures.
- `tools/oracle/generate.sh` rebuilds and regenerates everything.

Differential tests are the evidence that the port is faithful: when the port and the
oracle disagree, the oracle is right (unless you have found a bug in the Java program;
then note it in `NOTES.md` and match the Java behavior anyway).

## Working in parallel

Several agents work in this repository at once, each owning some directories (stated in
its brief). Do not edit files another area owns; if you need a change there, keep it
minimal, and mention it in your final report. Do not commit — the coordinator commits.

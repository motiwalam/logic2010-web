# The user interface: shell, shared components, module contract

`src/ui/` is the React app shell and the components module screens are built from.
`src/workspace/` is the student's work (persistence, sync, import/export), independent of
React. Read PORTING.md first: behaviour matches the desktop; the UI may improve on it.

## Adding a module screen

Create `src/ui/modules/<id>/index.tsx` (ids: `derivation`, `truth-tables`, `invalidity`,
`parsing`, `symbolization`, `recognition`) whose default export is a `ModuleDefinition`.
The registry finds it by glob; nothing else needs editing. Until then the module shows
a placeholder that lists the course problems.

```tsx
import { lazy } from 'react';
import { defineModule } from '../registry';

export default defineModule({
  id: 'derivation',
  title: 'Derivations',
  description: 'Build natural-deduction proofs, line by line.',
  workFile: 'derivation.rec',
  icon: '∴',
  component: lazy(() => import('./DerivationScreen')),   // Suspense is provided
  summarize: (text, { notation }) => ({ completed, attempted, total }),
  helpKeys: ['derStart', 'derHelp', 'derTips', 'derFAQ'],  // optional
});
```

`component` receives `ModuleProps` (`registry.ts`):

| prop | |
|---|---|
| `work: WorkSource` | `getFile(path)`, `saveFile(path, text)`, `paths()`, `subscribe`, `getRevision()` |
| `readOnly` | true when showing someone else's work: never call `saveFile`; hide editing |
| `notation` | the notation the engine is loaded with (1 or 2) |
| `workPath` | `syntax<n>/<workFile>`, the file to read and write |
| `problem` | the problem named in the URL, or null |
| `openProblem(name, {replace?})` | changes the URL (`/derivation/Deriv%201.002`); use `replace` when choosing a problem on your own |
| `dialogs` | the dialog API below |

Rules:

- **Reading work:** `work.getFile(workPath)` is the readable `.rec` text or null (no work
  yet: start from the course problems, as the desktop's first start does). Pass it to the
  engine: `readWork(set, 'derwork.txt', text == null ? null : { fileName: 'derivation.rec', text })`,
  then `verifyDigest(set, UserInfo.localUser())`.
- **Saving:** `work.saveFile(workPath, writeProblems(set, 'derwork.txt', UserInfo.localUser()).text)`
  whenever the desktop would save (or after each change). Saving is cheap: it is kept locally
  at once and synced to the server debounced. Re-render on `useWorkRevision(work)` if the
  file can change underneath (a sync, an import in another tab of the shell).
- **Engine reloads:** switching the notation reloads the program-wide engine tables; the shell
  remounts your component (keyed by the engine generation), so do not cache engine objects
  across mounts in module-level variables.
- **summarize(text)** gives `{ completed, attempted, total }` (completed = checked correct;
  total = counted problems, as the desktop's "Completed / Not completed" count). It runs with
  the engine loaded for the file's notation and is stored on the server with each upload
  (the People page shows it).
- Screens render inside the page: use `ModuleLayout` for the frame. A thrown error shows a
  recoverable error panel, not a blank page.

## Shared components (`src/ui/components/`)

**`ModuleLayout`** `{ sidebar, sidebarLabel?, header, toolbar, message, aside?, footer?, children }`
— problem list on the left (collapsible; a drawer on narrow screens), then the title panel,
toolbar, message bar and the work area. `aside` is an optional right panel.

**`ProblemHeader`** `{ name, statement?, status?, note?, actions? }` — `statement` as a string
is a maggie formula shown in symbols; `status` is an engine state number (`STATE_*`), a
`ProblemState`, or `{ text, tone: 'good'|'bad'|'warn'|'neutral' }`. `StatusPill` alone too.

**`ProblemList`** `{ rows, selected, onOpen, filter?, countLabel?, searchPlaceholder? }`, ref
`{ focusSearch() }` (bind Ctrl+O to it). Rows: `{kind:'heading', text}` or
`{kind:'problem', id, label, hover?, searchText?, state, restricted?, counted?}`; states are
coloured as the desktop (correct green, incorrect/incomplete red, restricted orange) with a
glyph for colour-blind users. Up/Down/PageUp/PageDown/Home/End move, Enter opens, Escape
clears the search. `defaultFilter` matches every word; for the desktop's exact list, search
and counts use `listFromModel(new ProblemListModel(set, set.exercises, {...}), set)` from
`modules/problemRows.ts`, which returns `{ rows, filter, countLabel, hint, searchPlaceholder, formulaSearch }`
(the derivation search semantics of the Java README come with it, plus the web's formula
search: `P->Q`, `concl:Q`, `premise:~P`, `concl:"forall x Fx"`; see
`engine/problems/formulaSearch.ts`). Pass `hint`, `searchPlaceholder` and
`searchHelp={<FormulaSearchHelp />}` (the "?" tip) to `ProblemList`; symbolization uses
`listFromModel(model, set, { formulas: false, statements: true })`. `nextProblem(rows, current, delta)` for Next.

**`MessageView`** `{ message, onAction?, onDismiss?, explain? }` — a catalogue message in place:
`message` is `{ title, text?, isError?, buttons?, expanded? }` (an engine `Message` fits:
`{ title: m.title, text: m.text, isError: m.isError, buttons: m.buttons }` after
`Message.substitute`). `\n` and `\l` escapes are expanded unless `expanded`. The long text
is behind "Explain". Buttons come from the `buttons` spec (`DialogHandler`); `onAction`
gets `{ label, action, index }`.

**`FormulaInput`** `{ value, onChange, onEnter?, onKeyDown?, id?, ariaLabel?, invalid?, allowPlaceholders?, keypad?, keypadOpen?, readOnly?, ... }`,
ref `{ focus(), insert(maggie), selectValueRange(start, end), input }`. The value is maggie
ASCII; the field shows symbols; typed ASCII forms, `forall x`/`exists x` and pasted
variants (¬ ⊃ ≡ ...) are translated with the caret kept. Ctrl+Shift+A/B/C/D/E/I/N/O/T/U/Enter
(and Alt+letter) insert `& <-> -> % ! <> ~ | .: @ [m]`; Ctrl+B selects enclosing brackets;
Ctrl+E the enclosing formula; Alt+1..9 `{1}`..`{9}` when `allowPlaceholders`. The keypad
(∀→ button or right-click) is `SymbolKeypad`, usable alone. Pure logic in
`formula/formulaText.ts`. `FormulaText { value }` shows a maggie formula read-only.

**`Toolbar`** `{ label }`, **`ToolButton`** `{ label, onClick, shortcut?, altShortcuts?, variant?, disabled? }`
— the shortcut ('Mod+K' = Ctrl+K / ⌘K) is shown and bound while the button is enabled.
Desktop shortcuts: Ctrl+O select problem, Ctrl+K check, Ctrl+S save, Ctrl+P print. Browsers
keep Ctrl+N; use `shortcut="Alt+ArrowDown" altShortcuts={['Alt+N']}` for Next. **`Menu`**
`{ label, items }` for drop-downs. **`useShortcuts({ 'Mod+K': fn })`** for keys without a button.

**Printing:** `window.print()`; the print stylesheet keeps only the problem header, message
and work area.

## Dialogs (`src/ui/dialogs/dialogs.tsx`)

`import { dialogs } from '../../dialogs/dialogs'` — usable from engine-facing code, no React
needed. All return promises:

- `dialogs.message(msg)` → `{ label, action, index } | null` (a catalogue message with its buttons)
- `dialogs.confirm({ title, body?, confirmLabel?, danger? })` → boolean
- `dialogs.choose({ title, prompt?, choices: [{ value, label, formula?, description?, disabled? }] })` → value | null
- `dialogs.prompt({ title, prompt?, label?, initial?, formula?, validate? })` → string | null (`formula: true` gives a FormulaInput; the value is maggie)
- `dialogs.open(close => <jsx/>, { title, dismissValue })` for anything else
- `dialogs.notify(text, { tone })` for toasts

Implement the engine's async UI interfaces (e.g. a derivation query handler) on top of these.

## Workspace (`src/workspace/`)

`WorkspaceStore` (subscribe/getSnapshot) holds `path → FileRecord`, persisted in IndexedDB
(localStorage/memory fallback), synced when signed in (debounced PUT with `baseVersion`,
retry with backoff offline, 409 → conflicts the user settles: keep mine / take server's).
Replaced content (imports, forks, resets, taking the server's copy, sign-in merges) goes to
`backups` first. `ReadOnlyWorkspace` is someone else's work. `fileTypes.ts` recognizes
uploaded work files (name, header, fields; legacy `derwork.txt` etc. are converted);
`transfer.ts` plans imports, exports (zip via `zip.ts`), forks and resets.

`/dev/components` shows every shared component live.

## Cross-module links

A module opens a problem in another module (the desktop's Invalidity → Derivation and
Invalidity → Truth Table buttons, which start the other module with a problem record) by
navigating to

```
/<module id>?new=<encodeURIComponent(record)>
```

`record` is a problem record in the work-file line format (`TaggedRecord`), without a name,
exactly as the desktop passes it to `LPxxx.startup`:

- Truth Tables: `<statement>`=` — e.g. `Fa0->Ga0 . Fa0 .: Ga0`=` (maggie notation).
- Derivation: `<argument>`-`=` — the statement under `-`, then an empty `=` field, e.g.
  `@x(Fx->Gx) . Fa .: Ga`-`=`.

A value without a backquote is a bare statement; the receiving screen puts it under its
statement tag. The receiving screen loads it as a new, unsaved user problem (problemIndex -1,
as `LPxxx.loadProblem(record)`), then removes the parameter with
`openProblem(null, { replace: true })`. Build the URL with
`href({ name: 'module', module, problem: null }) + '?new=' + encodeURIComponent(record)` and
`navigate(url)` (see `newProblemUrl` in `modules/invalidity/InvalidityScreen.tsx`; the
Truth Tables screen's handling is in `modules/truth/TruthScreen.tsx`, `useNewProblemParam`
in `modules/truth/common.tsx`).

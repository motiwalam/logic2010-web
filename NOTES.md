
## Engine core (data, program, problems): Java quirks reproduced

- `ProblemSet.createListView`: problems left out of the list (hidden, or excluded by the
  selector) still write their row into `rowToProblem` at row 0, so row 0 (often a blank
  heading) maps to the last left-out problem. `ProblemListModel` reproduces this (see
  tests/fixtures/core/list.json: row 0 maps to a hidden problem).
- `LogicProgram.expandEscapes`: a trailing single backslash makes the text before it appear
  twice (`"ab\"` gives `"abab\"`).
- `ScramblingWriter` loses everything it writes (its `scramblePendingLine` writes through its
  own overridden `write`, which appends to the line it then clears). Unused; not ported.
- `LogicProgram.resetOptions` clears the `altsymbols` flag but not the wedge symbols it set.
- `DataFiles.choose` picks the newer of a readable file and its legacy counterpart; a
  DataSource has no modification times, so the port uses the file asked for, else the other.

## Formula and rules engine: Java quirks reproduced

- Parser: every alternative of the JavaCC grammar has unbounded lookahead and `one_line`
  looks ahead over the whole line, so any syntax error is reported at the first token of the
  line ("Parse error at position 1." for `P&&Q`). Lexical errors are reported where the lexer
  fails, but only if the lookahead reaches that token (`P) #` is a parse error at 1).
- Lexer (JavaCC `ASCII_CharStream`): characters are cut to their low 8 bits, so e.g. U+0140
  lexes as `@` and U+0120 as a blank; `[` followed by a digit continues as a `{n}` placeholder,
  so `F[1}` parses (the variable `[1}`); a lexical error on the final newline is reported at
  column 0 ("Lexical error at position 0.").
- `new FormulaParseNode(String)` does not convert quantifier words, so its text ranges fail
  (NullPointerException) for text with `forall`/`exists`; `parseFormula` itself is fine.
- `FormulaParseNode.checkParenthesization` throws a NullPointerException when the text and the
  tree do not line up (e.g. a tab or a character cut to a blank inside a formula), so
  `parseFormula` throws a non-parse exception there.
- `SchemeInstantiation.assignFreshLetters` looks at `pendingLetters.elementAt(0)` on every
  pass (not `j`).
- `RuleProperties.addConverse` can add a converse twice (empty `if (!contains)` block).
- `BoundVariableMap.matches` uses binder indexes of the instantiated pattern to index the
  instance's binders (an index out of range throws, as in Java).

## Parsing and Recognition modules: Java quirks reproduced, and deviations

- Parsing messages: `parerr004` (wrong main connective) is not in messages/parsing.rec, so its
  message would be "bad error id"; the desktop never shows these messages (Check only sets the
  status to the summary), so this is invisible.
- `ParsingProblemPanel.resetWork` updates the tree's status label before clearing the root's
  selection, so in main-connective mode with autoCheck the label can show the old verdict.
- Loading a record fires the notation radio button's item event (as a click does): a saved
  "N" collapses the tree, and with autoCheck the result label is set on load.
- Loading a problem clears `lastUserProblem` (Parsing `clearProblem`, Recognition `reset`), and
  the User Problem dialogs set it just before loading, so they never start with the last one.
- "Delete the work on this problem" (the Java repository's `saveDeletedWork`) reloads the
  problem with `loadProblem`, which sets `problemIndex` to -1: the window is detached from the
  list, and the next Save asks for a new name.
- Deviations (Java throws, the port does not): a `*` main-connective value that is empty
  (`charAt(0)`) is read as not correct; an expansion string naming more children than a node
  has stops restoring there; a null statement (the empty new problem) counts as "" for the
  notation code (Java: NullPointerException when choosing a notation with autoCheck, or on Check).
- Clicks: the desktop tests a click's pixel x against the pixel positions of the operator
  ranges; the port takes the index of the character clicked (equivalent). The oracle replays
  mousePressed this way, without the flash.

## Symbolization (src/engine/modules/symbolization): Java behavior reproduced

- `matchTree` lets the *student's* unanalysed (NONE) node match anything (the test is on
  `this.connective`, the student tree), not the answer's as the notes say. Unfinished
  branches therefore never get error buttons; the check reports "Incomplete" first anyway.
- A binder never mismatches by its variable (only the connective is compared), so symerr002
  appears only on the binder buttons `showError` adds for a captured variable.
- Error buttons added by a hint (`showHint` when the node does not line up) are put on the
  panel without setting its `errorButton`, so a later Check's `clearErrors` does not remove
  them; they go when the node's connective changes or the problem is reloaded.
  `ConnectivePanel.buttons` keeps them, `errorButton` is the one `clearError` removes.
- Direct entry: after the "Badly Formed Expression" message the desktop goes on (the dialog
  is modal), finds the closest answer and, since the student's formula is then null,
  copies the answer's English into the unchanged tree (`copyTextFrom` also runs when either
  formula is null). The oracle's headless dialog throws there, so the fixtures compare only
  the tree after `buildFromText` for malformed input.
- "Delete the work on this problem" (`saveDeletedWork`) reloads the problem with
  `loadProblem`, which resets `problemIndex` to -1: the window forgets which problem of the
  list it shows (the next Save asks for a name).
- Answer Manager Delete/Replace joins the remaining answer keys with '.' without escaping
  them again, so a key containing '.' (e.g. "Symb 1.004-1" after `copyAnswersToUserKey`)
  is split into two keys on the next load.
- `addAnswer` / `addUserAnswer` compare `answerKeys != ""` by identity; the port compares by
  value (a Java substring of length 0 is the interned "" in current JDKs, so they agree).
- An atomic node whose code carries argument types ("*F{11}0") gets no child nodes, and the
  desktop then fails (NullPointerException) in isIncomplete, toString and the child
  snapshot. The data never has such codes and the Atomic Expression dialog escapes '{', so
  users cannot type one; the port treats the missing children as absent.
- Edit ▸ Statement / Scheme / Answers exist on the desktop only for an administrator
  install; the engine offers them (LPSymbolizer.editStatement/editScheme/openAnswerManager)
  with the desktop's permission checks (SymNot012, SymNot005).
- NodeMessage texts (and the Up action's replacement text) are kept with their \n, \l
  escapes; the desktop expands them (LogicProgram.expandEscapes) before showing them.
- The logPrint / logSubmit submission log (symdata.txt) is not kept.

## Truth Tables and Invalidity modules: Java quirks reproduced

- Truth problem states (the problem list, submissions: `getProblemState`) are computed by a
  scratch module whose options are those of an unnamed new problem (selectors match a null
  name only through their `u` flag), so a problem's own doAllRows/doAllWffs/doSetUp/doAllNodes
  settings affect only the Check button, not its listed state. `checkFull` trusts the `+`/`-`
  signs of the saved cell codes (only sentence-letter cells are re-derived from the row).
- A checked counterexample row that is out of range (hand-edited record) makes `checkFull`
  throw (ArrayIndexOutOfBoundsException; RangeError in the port).
- Each tree edit that leaves the edited node shown wrong adds 2 to the error count: the
  desktop's two linked views of the tree (valueTree and mirrorTree) each count it.
- The setup stage's OK-button stage (`TruthSetupButtons.stage`) persists across problems:
  loading a problem whose saved setup is past the letters keeps the previous problem's stage.
- `saveProblem` writes only `$ = @ # % * &` (and `e`, `t`): other `%` options, `!` and `u`
  fields of a problem are dropped when its work is saved.
- A user problem's text is offered again only when it was rejected (loading a problem clears
  `lastUserProblem`).
- Invalidity: quantifier expansion (Expand, the expanded Truth Table argument) names the
  elements `variableLetter(0)` + index: `a0, a1` in notation 1 but `i0, i1` in notation 2,
  where `i` is a variable letter.
- Invalidity: Expand at universe size 1 fails (NullPointerException) when the selection has
  no second part (e.g. `~P`), so nothing happens; the port returns without a change.
- Invalidity: the interpretation editor's cell labels for arity >= 2 start with a comma and
  do not separate the last element, e.g. `R(,01)` for R(0,1) (EditorCell.label keeps them).
- Invalidity: `getPrintProblems`' printIncorrect test lets every problem through; the Truth
  Table toolbar button sends the workspace selection, and `"null`="` when nothing is selected.
- Interpretations are equal by name and arity whatever their kind (`SymbolInterpretation.equals`).

Not reproduced (a bug of the desktop's recent "Delete Work sticks" change):
- `TruthDialogs/InvalidityDialogs.saveDeletedWork` reloads the problem with `loadProblem`,
  which sets `problemIndex` to -1, so the next save of that problem asks for a new name and
  adds a copy. The port keeps the problem's index.

## Derivation module: Java quirks reproduced, and deviations

- `DerivationProblemSet.removeProblem` means to drop a user rule UR... from the user rules but
  compares the whole name with "UR", so only a problem named exactly `UR` is dropped.
- `Justification.decode` has no branch for type 5 (`ASS BD`, encoded `5:L`/`5:R`): the choice
  is written but read back as null, so it is asked again.
- `InterchangeJustification.identityInstantiation` maps only the first letter (loops with
  `elementAt(0)`).
- `DerivationLine.moveIntoPreviousBox` / `moveOutOfBox` call `focus.requestFocus()` without a
  null check (a NullPointerException when no field has the focus); reproduced (TypeError).
- `DerivationMessage.format` does not substitute parameters in a module without a window
  (`doSubs`), so a hidden module's messages keep their `<param>`s (and `m` fields written from
  one would too). The web modules substitute (`doSubs` true); hidden replays use false.
- In a module without a window, rule queries after an incomplete instantiation (UI, EG, EI,
  LL..., EL, other schemes) fail without a message (`matchRule`: `frame == null`); restating
  relies on the cached justifications (`:` fields) instead.
- Validation messages of the rule queries (dernot0xx) open message windows even while
  checking in serial mode when the answers come from `RULE/answer`; so do they here.
- `LPDerivation.listRules` on an empty item (e.g. "MP..DN") throws
  StringIndexOutOfBoundsException; the port skips it (not in the course data).
- `DerivationProblemEntry.computeState` runs a whole check synchronously in Java; checking is
  asynchronous here, so an entry created with a state to compute starts `STATE_UNCHECKED` and
  `DerivationWorkspace.updateState` (awaited by the problem operations) computes it.
- `loadProblem`'s `boxAndCancel` for a `#` field may open a message window (dernot009/011 on
  malformed work); the port shows it without waiting (loading is synchronous).
- The oracle for this module (tools/oracle/derivation) shadows `BaseDialog` and `MessageDialog`
  with panels that hand every dialog to `OracleDialogs` (recorded, answered from a script), and
  gives the module a fake `ModuleFrame` (Unsafe.allocateInstance) so the rule queries run.
  It runs with bytecode verification off (`-XX:-BytecodeVerificationRemote`).

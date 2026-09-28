
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

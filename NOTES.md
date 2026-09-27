
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

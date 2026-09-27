
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

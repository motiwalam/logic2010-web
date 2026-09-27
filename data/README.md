# Logic 2010 data files

Everything course-specific the program reads is in this directory, as plain text you can read and edit:
- the problems and answer keys
- the rules and theorems
- messages, options and tips
- the links file, which names the course and says where everything is

`run.sh` copies this directory into the runtime directory. That copy becomes the program's `Contents/Resources`, and any file here that is newer than its copy is copied again. So edits here take effect on the next start.

## Files

| File | Contents |
|---|---|
| `version.conf` | Version of the program's core files, e.g. `version: 20200601`. |
| `links.conf` | The course (institution, term, course, notation) and where every other file is: data files, help PDFs, web pages, server URLs. |
| `options.rec` | Options, one record per part of the program (`section: logic`, `derivation`, `parsing`, `truth`, `invalidation`, `symbolization`, `recognition`). |
| `derivation-tips.rec` | The derivation strategy tips, an outline. |
| `messages/general.rec`, `messages/<module>.rec` | Message catalogues: dialog texts, error and information messages. |
| `syntax1/`, `syntax2/` | Everything that depends on the formula notation. `links.conf` picks one (`syntax:`), and `run.sh --local --syntax N` overrides it. |
| `syntaxN/derivation-problems.rec` | Derivation problems (with worked examples). |
| `syntaxN/invalidity-problems.rec` | Invalidity problems. |
| `syntaxN/parsing-problems.rec` | Parsing problems. |
| `syntaxN/recognition-problems.rec` | Rule-recognition problems. |
| `syntaxN/symbolization-problems.rec` | Symbolization problems. |
| `syntaxN/symbolization-answers.rec` | Symbolization answer keys. |
| `syntaxN/truth-table-problems.rec` | Truth-table problems. |
| `syntaxN/rules.list` | Rules of inference. |
| `syntaxN/theorems.list` | Theorems. |
| `syntax2/text/` | The textbook chapters (PDF), opened by the *Logic Text* menu button. |
| `local/` | Additions by the instructor: problem files with the same names, which the program reads in addition to the core ones, and `local/options.rec`. |
| `docs/` | Help documents (PDF). |

## Formats

### Record files (`.rec`)

```
# A comment (ignored).
## A heading (shown in the program's problem lists)

problem: Deriv 1.001EG1
statement: " ~Q .: (P->Q)->~P"
show: (P->Q)->~P
line: P->Q
reason: ASS CD
...
common-name: Deriv 1.001EG1

problem: Deriv 1.002
...
```

**Records.**
- A record is a run of `field: value` lines. Records are separated by blank lines or `## heading` lines.
- Indentation before a field name is ignored; the tips outline uses it to show nesting.
- `# comment` lines may appear anywhere.

**Fields.**
- A field may repeat. Order matters: for example, a derivation is its lines in order.
- Every file lists its field names and their meanings in its header comment.
- An unknown field name is reported on standard error and ignored.
- A field the program has no name for can be written `tag-X: value`, where `X` is the program's internal one-character tag.

**Values.**
- A value is the rest of the line, with surrounding blanks removed. It may be empty (`end-box:`).
- If surrounding blanks matter, or the value starts with `"`, write it as a JSON-style quoted string: `"prefix:Deriv "`, `"\"SHOW CONC\""`.
- Inside values, the program's own conventions apply:
  - `\n` is a line break in messages
  - `\l` toggles the translation of ASCII formula notation (`->`, `@x`, …) into logic symbols
  - `<name>` in messages is a parameter filled in by the program
  - formulas are written in ASCII notation. Quantifiers may be written as words, `forall x Fx` and `exists x Fx`, or as symbols, `@xFx` and `!xFx`. The words are recognized only in fields that hold formulas (the argument, Show and line fields of derivations, arguments and formulas of the other modules, and the part of a symbolization node before its `:`), and in rule and theorem bodies. The program writes the words when it saves work.

**Options** (`options.rec`): records with the same `section` may appear several times. All their fields apply, in order. A problem selector such as `{"1.7","1.72"}` names problems (and `u` means user-created ones); `~` in front negates it.

### Lists (`rules.list`, `theorems.list`)

```
## Double Negation
DNE        ~~P.:P
DNI        P.:~~P
DN         DNE.DNI
```

- Each line is a name, blanks, then the definition.
- A rule is either a schema (`premises .: conclusion`, with the premises separated by `.`) or a list of other rules joined with `.`, which makes a compound rule.
- A theorem line is a number and a formula.
- `## text` lines are headings in the program's rule list; `#` lines are comments.

### Settings (`.conf`)

```
# comment
key: value
```

In `links.conf`, file locations may start with these directory names:
- `ruleDir/`: `syntax1/` or `syntax2/`, whichever notation is in use
- `linkDir/`: this directory
- `progDir/`: the program's directory

## Your work

The program saves each module's work in the runtime directory's `Contents/Resources/work/`, as record files like the ones above:

| File | Contents |
|---|---|
| `derivation.rec` | Derivation problems and your work on them |
| `invalidity.rec`, `parsing.rec`, `recognition.rec`, `symbolization.rec`, `truth-tables.rec` | The same for the other modules |
| `symbolization-answers.rec` | Answer keys for symbolization problems you created |
| `user.txt`, `prefs.txt` | Your user information and display preferences (`key:value` lines) |

- A work file holds every problem of its module, not only the ones you worked on. The program starts it from the course's problem file on first save.
- The fields are those of the course file (`derivation.rec` uses the fields of `syntaxN/derivation-problems.rec`, and so on).
- In `derivation.rec`, each Show line's box is indented under it, so a derivation reads as it looks in the program. The indentation is for reading only.
- The last line, `# digest: ...`, is a checksum of the records and your user information. If the records do not match it, the program refuses the file ("Could not digest file"), so a file edited by hand stops loading.

Work saved by older versions (`derwork.txt`, `truwork.txt`, …, `keywork.txt`, in the one-line-per-record format) is still read. It is converted to the readable file when the module is first opened. Server backups still carry the work in that older format, under the older names, so they remain compatible with the course server and other installations.

## Older formats

The official Logic 2010 releases ship these same files with meaningless names (`ghost.txt`, `ghoul.txt`, …), scrambled with a running-key cipher, in a one-line-per-record format with one-character field tags. The program still reads those files. In normal (server) mode the course server may send course files in that format, and when both a readable file and its old-format counterpart exist, the newer one is used. The `reverse-engineering` branch has the converter (`tools/convert-data.py`) and documents the old formats.

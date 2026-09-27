/**
 * The formula parser. Replaces FormulaParser.java and the two JavaCC-generated parsers
 * (syntax1/Syntax1Parser, Syntax1TokenManager, Syntax1CharStream, ... and the same for
 * syntax2) with one hand-written parser that accepts the same language, builds the same
 * trees and fails at the same places.
 *
 * Grammar (every alternative has unbounded syntactic lookahead in the JavaCC grammar, so the
 * parser tries the alternatives in order with backtracking, like a PEG):
 *
 *   one_line = formula EOL | term EOL | EOL | EOF
 *   formula  = conjexp { ("<->" | "->") conjexp }
 *   conjexp  = unary { ("&" | "|") unary }
 *   unary    = "~" unary | "@" VAR unary | "!" VAR unary | equation | member | primary
 *   equation = term "=" term | term "<>" term          (<> gives ~(t=t), shown as t<>t)
 *   member   = term "[m]" term
 *   primary  = "(" formula ")" | (PRED | SEN) "(" term {term} ")" | PRED term | SEN | UNK
 *   term     = VAR | OP "(" term {term} ")" | OP | "%" VAR unary
 *
 * Because one_line looks ahead over the whole line before committing, a syntax error is
 * always reported at the first token of the line. A lexical error is reported where the lexer
 * fails, when the lookahead first reaches that token; the tokens are therefore read lazily,
 * in the same order as JavaCC reads them.
 *
 * The lexer reproduces the JavaCC token manager, including its quirks: the char stream keeps
 * only the low 8 bits of each character (ASCII_CharStream), tabs advance the column to the
 * next multiple of 8, and "[" followed by a digit continues as a {n} placeholder, so "[1}" is
 * a variable.
 */
import { getSyntax } from '../program/symbols';
import {
  AtomicFormula,
  ConnectiveFormula,
  DescriptionTerm,
  type Expression,
  type Formula,
  IdentityFormula,
  MembershipFormula,
  OperationTerm,
  QuantifiedFormula,
  SimpleTerm,
  type Term,
} from './Expression';

/** Port of FormulaParseException.java (and the JavaCC ParseException subclasses). */
export class FormulaParseException extends Error {
  constructor(message?: string | null) {
    super(message ?? undefined);
    this.name = 'FormulaParseException';
    // Java's getMessage() is null when there is none
    if (message == null) this.javaMessage = null;
    else this.javaMessage = message;
  }

  /** The Java exception's getMessage() (may be null). */
  javaMessage: string | null;
}

/** Port of FormulaLexerError.java (and the JavaCC TokenMgrError subclasses). */
export class FormulaLexerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FormulaLexerError';
  }
}

// Token kinds (Syntax1Constants / Syntax2Constants)
const EOF = 0;
const EOL = 4;
const VAR = 5;
const PRED = 6;
const SEN = 7;
const OP = 8;
const UNK = 9;
const IFF = 10;
const IF = 11;
const AND = 12;
const OR = 13;
const EQ = 14;
const NEQ = 15;
const MEMBER = 16;
const NOT = 17;
const ALL = 18;
const SOME = 19;
const LPAREN = 20;
const RPAREN = 21;
const DESC = 22;

const LITERAL_IMAGES: (string | null)[] = [
  '', null, null, null, '\n', null, null, null, null, null, '<->', '->', '&', '|', '=', '<>', '[m]', '~', '@', '!', '(', ')', '%',
];

interface Token {
  kind: number;
  image: string;
  beginLine: number;
  beginColumn: number;
}

/** Letter classes of the notation: the kind of a token starting with this (masked) char, or -1. */
function letterKind(c: number, syntax: number): number {
  const ch = String.fromCharCode(c);
  if (syntax === 1) {
    if (ch >= 'a' && ch <= 'z') return VAR;
    if (ch >= 'P' && ch <= 'Z') return SEN;
    if (ch >= 'F' && ch <= 'O') return PRED;
    if (ch >= 'A' && ch <= 'E') return OP;
  } else {
    if (ch >= 'i' && ch <= 'z') return VAR;
    if (ch >= 'A' && ch <= 'O') return PRED;
    if (ch >= 'P' && ch <= 'Z') return SEN;
    if (ch >= 'a' && ch <= 'h') return OP;
  }
  return -1;
}

const isDigit = (c: number) => c >= 48 && c <= 57;
const isNonZeroDigit = (c: number) => c >= 49 && c <= 57;
const isUpper = (c: number) => c >= 65 && c <= 90;

/**
 * The NFA of the token manager for the letter tokens, placeholders {n} and unknowns ?ABC.
 * States: 'start'; 'sub0'/'sub1'/'subN' (subscript after a letter of kind k: "0", or [1-9]
 * then [0-9]*); 'brace' (after "{": [1-9]), 'braceDigits' ([0-9]* then "}"), 'unk' ([A-Z]*).
 */
type NfaState =
  | { s: 'start' }
  | { s: 'sub0'; kind: number }
  | { s: 'sub1'; kind: number }
  | { s: 'subN'; kind: number }
  | { s: 'brace' }
  | { s: 'braceDigits' }
  | { s: 'braceClose' }
  | { s: 'unk' };

class Lexer {
  readonly text: string;
  readonly codes: number[];
  readonly lines: number[];
  readonly columns: number[];
  pos = 0;
  readonly syntax: number;

  constructor(text: string, syntax: number) {
    this.text = text;
    this.syntax = syntax;
    this.codes = [];
    this.lines = [];
    this.columns = [];
    // SimpleCharStream.UpdateLineColumn, starting at line 1, column 0
    let line = 1;
    let column = 0;
    let prevCR = false;
    let prevLF = false;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) & 255;
      column++;
      if (prevLF) {
        prevLF = false;
        column = 1;
        line++;
      } else if (prevCR) {
        prevCR = false;
        if (c === 10) {
          prevLF = true;
        } else {
          column = 1;
          line++;
        }
      }
      if (c === 9) {
        column--;
        column += 8 - (column & 7);
      } else if (c === 10) {
        prevLF = true;
      } else if (c === 13) {
        prevCR = true;
      }
      this.codes.push(c);
      this.lines.push(line);
      this.columns.push(column);
    }
  }

  private error(lastRead: number, begin: number): FormulaLexerError {
    // getEndLine/getEndColumn: the position of the last character read
    let line = this.lines[lastRead];
    let column = this.columns[lastRead];
    const c = this.codes[lastRead];
    const eof = lastRead + 1 >= this.codes.length;
    if (eof) {
      if (c !== 10 && c !== 13) column++;
      else {
        line++;
        column = 0;
      }
    }
    const after = lastRead - begin + 1 <= 1 ? '' : this.text.substring(begin, lastRead + 1);
    const ch = String.fromCharCode(c);
    return new FormulaLexerError(
      'Lexical error at line ' +
        line +
        ', column ' +
        column +
        '.  Encountered: ' +
        (eof ? '<EOF> ' : '"' + addEscapes(ch) + '" (' + c + '), ') +
        'after : "' +
        addEscapes(after) +
        '"',
    );
  }

  private token(kind: number, begin: number, end: number): Token {
    this.pos = end;
    return {
      kind,
      image: LITERAL_IMAGES[kind] ?? this.text.substring(begin, end),
      beginLine: this.lines[begin],
      beginColumn: this.columns[begin],
    };
  }

  next(): Token {
    const n = this.codes.length;
    while (this.pos < n && (this.codes[this.pos] === 32 || this.codes[this.pos] === 9 || this.codes[this.pos] === 13)) {
      this.pos++;
    }
    const begin = this.pos;
    if (begin >= n) {
      // EOF: FillBuff backs up to the last character
      const last = Math.max(0, n - 1);
      return { kind: EOF, image: '', beginLine: this.lines[last] ?? 1, beginColumn: this.columns[last] ?? 0 };
    }
    const c = this.codes[begin];
    switch (c) {
      case 10:
        return this.token(EOL, begin, begin + 1);
      case 33:
        return this.token(SOME, begin, begin + 1);
      case 37:
        return this.token(DESC, begin, begin + 1);
      case 38:
        return this.token(AND, begin, begin + 1);
      case 40:
        return this.token(LPAREN, begin, begin + 1);
      case 41:
        return this.token(RPAREN, begin, begin + 1);
      case 61:
        return this.token(EQ, begin, begin + 1);
      case 64:
        return this.token(ALL, begin, begin + 1);
      case 124:
        return this.token(OR, begin, begin + 1);
      case 126:
        return this.token(NOT, begin, begin + 1);
      case 45: // "-" : "->"
        if (this.codes[begin + 1] === 62) return this.token(IF, begin, begin + 2);
        return this.failAfter(begin, begin + 1, null);
      case 60: {
        // "<" : "<->" or "<>"
        const c1 = this.codes[begin + 1];
        if (c1 === 62) return this.token(NEQ, begin, begin + 2);
        if (c1 === 45) {
          if (this.codes[begin + 2] === 62) return this.token(IFF, begin, begin + 3);
          return this.failAfter(begin, begin + 2, null);
        }
        return this.failAfter(begin, begin + 1, null);
      }
      case 91: {
        // "[" : "[m]"; otherwise the NFA continues in the "{" state (a JavaCC quirk)
        const c1 = this.codes[begin + 1];
        if (c1 === 109) {
          if (this.codes[begin + 2] === 93) return this.token(MEMBER, begin, begin + 3);
          return this.failAfter(begin, begin + 2, null);
        }
        return this.nfa(begin, begin + 1, [{ s: 'brace' }]);
      }
      default:
        return this.nfa(begin, begin, [{ s: 'start' }]);
    }
  }

  /** A literal failed at position at: the NFA starts there with no states (or the given ones). */
  private failAfter(begin: number, at: number, _states: null): Token {
    throw this.error(at, begin);
  }

  /** Runs the NFA from position at with the given states; longest match wins. */
  private nfa(begin: number, at: number, start: NfaState[]): Token {
    let states = start;
    let matchedKind = -1;
    let matchedEnd = -1;
    let i = at;
    for (;;) {
      const c = this.codes[i];
      let kind = Number.MAX_SAFE_INTEGER;
      const next: NfaState[] = [];
      const add = (st: NfaState) => {
        if (!next.some((x) => x.s === st.s)) next.push(st);
      };
      for (const st of states) {
        switch (st.s) {
          case 'start': {
            if (c === 63) {
              kind = Math.min(kind, UNK);
              add({ s: 'unk' });
            } else if (c === 123) {
              add({ s: 'brace' });
            } else {
              const k = letterKind(c, this.syntax);
              if (k !== -1) {
                kind = Math.min(kind, k);
                add({ s: 'sub0', kind: k });
                add({ s: 'sub1', kind: k });
              }
            }
            break;
          }
          case 'sub0':
            if (c === 48) kind = Math.min(kind, st.kind);
            break;
          case 'sub1':
            if (isNonZeroDigit(c)) {
              kind = Math.min(kind, st.kind);
              add({ s: 'subN', kind: st.kind });
            }
            break;
          case 'subN':
            if (isDigit(c)) {
              kind = Math.min(kind, st.kind);
              add({ s: 'subN', kind: st.kind });
            }
            break;
          case 'brace':
            if (isNonZeroDigit(c)) {
              add({ s: 'braceDigits' });
              add({ s: 'braceClose' });
            }
            break;
          case 'braceDigits':
            if (isDigit(c)) {
              add({ s: 'braceDigits' });
              add({ s: 'braceClose' });
            }
            break;
          case 'braceClose':
            if (c === 125) kind = VAR;
            break;
          case 'unk':
            if (isUpper(c)) {
              kind = Math.min(kind, UNK);
              add({ s: 'unk' });
            }
            break;
        }
      }
      if (kind !== Number.MAX_SAFE_INTEGER) {
        matchedKind = kind;
        matchedEnd = i + 1;
      }
      if (next.length === 0 || i + 1 >= this.codes.length) break;
      states = next;
      i++;
    }
    if (matchedKind === -1) throw this.error(i, begin);
    return this.token(matchedKind, begin, matchedEnd);
  }
}

function addEscapes(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    switch (c) {
      case 0:
        break;
      case 8:
        out += '\\b';
        break;
      case 9:
        out += '\\t';
        break;
      case 10:
        out += '\\n';
        break;
      case 12:
        out += '\\f';
        break;
      case 13:
        out += '\\r';
        break;
      case 34:
        out += '\\"';
        break;
      case 39:
        out += "\\'";
        break;
      case 92:
        out += '\\\\';
        break;
      default:
        if (c >= 32 && c <= 126) out += s.charAt(i);
        else out += '\\u' + ('0000' + c.toString(16)).slice(-4);
    }
  }
  return out;
}

/** The result of parsing a rule at token index k: the node and the next index, or null. */
type Parsed<T> = { node: T; next: number } | null;

class Parser {
  private readonly lexer: Lexer;
  private readonly tokens: Token[] = [];

  constructor(text: string, syntax: number) {
    this.lexer = new Lexer(text, syntax);
  }

  /** The k-th token, read on demand (a lexical error is thrown when it is first needed). */
  private tok(k: number): Token {
    while (this.tokens.length <= k) {
      const last = this.tokens[this.tokens.length - 1];
      if (last && last.kind === EOF) {
        this.tokens.push(last);
        continue;
      }
      this.tokens.push(this.lexer.next());
    }
    return this.tokens[k];
  }

  private is(k: number, kind: number): boolean {
    return this.tok(k).kind === kind;
  }

  oneLine(): Expression | null {
    const f = this.formula(0);
    if (f && this.is(f.next, EOL)) return f.node;
    const t = this.term(0);
    if (t && this.is(t.next, EOL)) return t.node;
    if (this.is(0, EOL)) return null;
    if (this.is(0, EOF)) return null;
    const first = this.tok(0);
    throw new FormulaParseException(
      'Encountered "' + (first.kind === EOF ? '<EOF>' : addEscapes(first.image)) + '" at line ' + first.beginLine +
        ', column ' + first.beginColumn + '.',
    );
  }

  private formula(k: number): Parsed<Formula> {
    const first = this.conjexp(k);
    if (!first) return null;
    let node: Formula = first.node;
    let next = first.next;
    for (;;) {
      const op = this.tok(next).kind;
      if (op !== IFF && op !== IF) break;
      const right = this.conjexp(next + 1);
      if (!right) break;
      const c = new ConnectiveFormula(this.tok(next).image);
      c.setLeft(node);
      c.setRight(right.node);
      node = c;
      next = right.next;
    }
    return { node, next };
  }

  private conjexp(k: number): Parsed<Formula> {
    const first = this.unary(k);
    if (!first) return null;
    let node: Formula = first.node;
    let next = first.next;
    for (;;) {
      const op = this.tok(next).kind;
      if (op !== AND && op !== OR) break;
      const right = this.unary(next + 1);
      if (!right) break;
      const c = new ConnectiveFormula(this.tok(next).image);
      c.setLeft(node);
      c.setRight(right.node);
      node = c;
      next = right.next;
    }
    return { node, next };
  }

  private unary(k: number): Parsed<Formula> {
    if (this.is(k, NOT)) {
      const body = this.unary(k + 1);
      if (body) {
        const c = new ConnectiveFormula(this.tok(k).image);
        c.setLeft(body.node);
        return { node: c, next: body.next };
      }
    }
    for (const q of [ALL, SOME]) {
      if (this.is(k, q) && this.is(k + 1, VAR)) {
        const body = this.unary(k + 2);
        if (body) {
          const f = new QuantifiedFormula(this.tok(k).image);
          f.setVariable(new SimpleTerm(this.tok(k + 1).image));
          f.setBody(body.node);
          return { node: f, next: body.next };
        }
      }
    }
    const equation = this.equation(k);
    if (equation) return equation;
    const member = this.member(k);
    if (member) return member;
    return this.primary(k);
  }

  private equation(k: number): Parsed<Formula> {
    const left = this.term(k);
    if (left && this.is(left.next, EQ)) {
      const right = this.term(left.next + 1);
      if (right) {
        const f = new IdentityFormula(this.tok(left.next).image);
        f.setLeft(left.node);
        f.setRight(right.node);
        return { node: f, next: right.next };
      }
    }
    const left2 = this.term(k);
    if (left2 && this.is(left2.next, NEQ)) {
      const right = this.term(left2.next + 1);
      if (right) {
        const f = new IdentityFormula('=');
        f.setLeft(left2.node);
        f.setRight(right.node);
        return { node: f.negate().markAsInequality(), next: right.next };
      }
    }
    return null;
  }

  private member(k: number): Parsed<Formula> {
    const left = this.term(k);
    if (!left || !this.is(left.next, MEMBER)) return null;
    const right = this.term(left.next + 1);
    if (!right) return null;
    const f = new MembershipFormula(this.tok(left.next).image);
    f.setElement(left.node);
    f.setSet(right.node);
    return { node: f, next: right.next };
  }

  /** "(" term {term} ")" at k: the arguments and the index after ")". */
  private argumentList(k: number): { args: Term[]; next: number } | null {
    if (!this.is(k, LPAREN)) return null;
    const first = this.term(k + 1);
    if (!first) return null;
    const args = [first.node];
    let next = first.next;
    for (;;) {
      const t = this.term(next);
      if (!t) break;
      args.push(t.node);
      next = t.next;
    }
    if (!this.is(next, RPAREN)) return null;
    return { args, next: next + 1 };
  }

  private primary(k: number): Parsed<Formula> {
    if (this.is(k, LPAREN)) {
      const inner = this.formula(k + 1);
      if (inner && this.is(inner.next, RPAREN)) return { node: inner.node, next: inner.next + 1 };
    }
    if (this.is(k, PRED) || this.is(k, SEN)) {
      const list = this.argumentList(k + 1);
      if (list) {
        const f = new AtomicFormula(this.tok(k).image);
        for (const a of list.args) f.addArgument(a);
        return { node: f, next: list.next };
      }
    }
    if (this.is(k, PRED)) {
      const arg = this.term(k + 1);
      if (arg) {
        const f = new AtomicFormula(this.tok(k).image);
        f.addArgument(arg.node);
        return { node: f, next: arg.next };
      }
    }
    if (this.is(k, SEN) || this.is(k, UNK)) return { node: new AtomicFormula(this.tok(k).image), next: k + 1 };
    return null;
  }

  private term(k: number): Parsed<Term> {
    if (this.is(k, VAR)) return { node: new SimpleTerm(this.tok(k).image), next: k + 1 };
    if (this.is(k, OP)) {
      const list = this.argumentList(k + 1);
      if (list) {
        const t = new OperationTerm(this.tok(k).image);
        for (const a of list.args) t.addArgument(a);
        return { node: t, next: list.next };
      }
    }
    if (this.is(k, OP)) return { node: new OperationTerm(this.tok(k).image), next: k + 1 };
    if (this.is(k, DESC) && this.is(k + 1, VAR)) {
      const body = this.unary(k + 2);
      if (body) {
        const d = new DescriptionTerm(this.tok(k).image);
        d.setVariable(new SimpleTerm(this.tok(k + 1).image));
        d.setBody(body.node);
        return { node: d, next: body.next };
      }
    }
    return null;
  }
}

/**
 * FormulaParser.reinit + parse: parses one line of text (the caller appends "\n") in the
 * current notation. Returns null for a blank line. Throws FormulaParseException for a syntax
 * error and FormulaLexerError for a lexical error; variables are not linked yet.
 */
export function parseLine(text: string, syntax: number = getSyntax()): Expression | null {
  return new Parser(text, syntax).oneLine();
}

#!/usr/bin/env node
// Builds the formula test corpus for one notation:  node formula-corpus.mjs <1|2> <out-dir>
// Writes, one JSON string per line:
//   formula-inputs-N.txt       every formula-like text in the notation's data files (problem
//                              statements split at "." and ".:", Show and line formulas,
//                              arguments, parsing and truth-table formulas, symbolization node
//                              codes, rule and theorem bodies), plus generated malformed
//                              mutations of them and hand-written edge cases
//   recognition-args-N.txt     the recognition problems' arguments
//   instantiations-N.txt       the encoded scheme instantiations in cached justifications
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const syntax = Number(process.argv[2]);
const outDir = process.argv[3];
const data = join(dirname(fileURLToPath(import.meta.url)), '../../data', 'syntax' + syntax);

function unquote(v) {
  v = v.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function fields(file) {
  const out = [];
  for (const line of readFileSync(join(data, file), 'utf8').split('\n')) {
    const m = /^\s*([a-z-]+):(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out.push([m[1], unquote(m[2])]);
  }
  return out;
}

const seen = new Set();
const base = [];
function add(s) {
  if (s == null || s.includes('\n')) return;
  if (!seen.has(s)) {
    seen.add(s);
    base.push(s);
  }
}
function addArgument(s) {
  add(s.trim());
  const i = s.indexOf('.:');
  const premises = i === -1 ? s : s.substring(0, i);
  if (i !== -1) add(s.substring(i + 2).trim());
  for (const p of premises.split('.')) add(p.trim());
}

const recognition = [];
const instantiations = [];
for (const file of [
  'derivation-problems.rec',
  'invalidity-problems.rec',
  'parsing-problems.rec',
  'recognition-problems.rec',
  'truth-table-problems.rec',
  'symbolization-problems.rec',
  'symbolization-answers.rec',
]) {
  for (const [k, v] of fields(file)) {
    if (k === 'statement' || k === 'argument') addArgument(v);
    if (k === 'argument' && file.startsWith('recognition')) recognition.push(v);
    if (k === 'show' || k === 'line' || k === 'formula' || k === 'collapsed-show') add(v.trim());
    if (k === 'node') {
      const code = v.substring(0, Math.max(0, v.indexOf(':')));
      add(code);
      add(code.replace(/^\*\s*/, '').replace(/\{\}\d*$/, ''));
    }
    if (k === 'cached-justification' && v.startsWith('1:')) {
      const body = v.substring(2);
      const i = body.indexOf('}');
      const j = body.lastIndexOf(',');
      if (i !== -1 && j > i) instantiations.push(body.substring(i + 1, j));
    }
  }
}
for (const f of ['rules.list', 'theorems.list']) {
  for (const line of readFileSync(join(data, f), 'utf8').split('\n')) {
    if (line.startsWith('#') || !line.trim()) continue;
    const m = /^\s*\S+\s+(.*)$/.exec(line);
    if (m && (f === 'theorems.list' || m[1].includes('.:'))) addArgument(m[1]);
  }
}

// deterministic mutations
let seed = 12345 + syntax;
function rand(n) {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed % n;
}
const inserts = [
  '(', ')', '~', '&', '|', '->', '<->', '@', '!', '=', '<>', '[m]', '%', ' ', '\t', '-', '<', '[', '{', '}', '{1}', '{0}',
  '?', '?A', '#', '.', ',', '0', '1', '12', 'x', 'a', 'i', 'b', 'F', 'A', 'P', 'Z', 'G', 'O', 'h', 'forall x', 'exists y',
  '→', '∀', 'ŀ', 'Ħ', '[1}', '[m', '<-', '\r',
];
const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const mutations = [];
const valid = base.filter((s) => s.length > 0 && s.length < 60);
for (let n = 0; n < 2500 && valid.length > 0; n++) {
  const s = valid[rand(valid.length)];
  const p = rand(s.length + 1);
  let m;
  switch (rand(5)) {
    case 0:
      m = s.substring(0, p) + s.substring(p + 1);
      break;
    case 1:
      m = s.substring(0, p) + inserts[rand(inserts.length)] + s.substring(p);
      break;
    case 2:
      m = p + 1 < s.length ? s.substring(0, p) + s[p + 1] + s[p] + s.substring(p + 2) : s + ')';
      break;
    case 3: {
      const q = [...s].map((c, i) => (/[A-Za-z]/.test(c) ? i : -1)).filter((i) => i >= 0);
      if (q.length === 0) m = '(' + s;
      else {
        const i = q[rand(q.length)];
        m = s.substring(0, i) + letters[rand(letters.length)] + s.substring(i + 1);
      }
      break;
    }
    default:
      m = '(' + s + ')';
  }
  mutations.push(m);
}
const edge = [
  '', ' ', '\t', 'P', 'a', 'A', 'i', 'Fa', 'F(a)', 'F(a b)', 'Fab', 'P(a)', 'P->Q->R', 'P<->Q<->R', 'P&Q|R', '(P&Q)&R', 'P&(Q&R)',
  '((P))', '(P)', '~(P)', '~~P', 'a=b', 'a<>b', '~a=b', '~(a=b)', 'a[m]b', '%xFx', '%x Fx=a', 'F%xGx', '@xFx', '@x(Fx)', '!x!yGxy',
  '@x@xFx', 'P ->Q', 'P-> Q', 'P - > Q', 'P <- > Q', 'P#Q', 'P##', '#', ')', '(', '()', 'P)', '(P', 'P Q', 'x', '{1}', 'F{1}',
  'F({1} {2})', '?A', '?', '?AB->P', 'P->?Q', '[1}', 'F[1}', '[m]', '[m', '[x', 'a0', 'a01', 'a10', 'F0a', 'P1&P0', 'P00',
  '\tP&Q', '  P&', 'P&\t&Q', 'P\r&Q', 'P->', '<>', 'forall x Fx', 'forallx Fx', 'exists y (Gy & forall x Fx)', 'forall Fx',
  'P→Q', '∀xFx', 'ŀxFx', 'P Ħ Q', 'A(a)', 'B(a b)=c', 'f(i)=j', 'Fi', 'A', 'Pa', 'P(a b c)', 'F(a)(b)', '@x Fx & Gx',
  '%x(Fx&Gx)', '@x(Fx->%y Gy=x)', 'P&Q&R&S', 'P|Q&R', '(P|Q)&R', 'P->(Q->R)', '(P->Q)->R', '~(P&Q)', '~(P->Q)',
];
const inputs = [...base, ...edge.filter((s) => !seen.has(s)), ...mutations];
const lines = (a) => a.map((s) => JSON.stringify(s)).join('\n') + '\n';
writeFileSync(join(outDir, `formula-inputs-${syntax}.txt`), lines(inputs));
writeFileSync(join(outDir, `recognition-args-${syntax}.txt`), lines(recognition));
writeFileSync(join(outDir, `instantiations-${syntax}.txt`), lines([...new Set(instantiations)]));
console.error(`syntax ${syntax}: ${base.length} data texts, ${inputs.length} inputs, ${recognition.length} arguments, ${instantiations.length} instantiations`);

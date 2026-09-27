/**
 * Port of BoundVariableNames.java: the names of an expression's bound variables in binder
 * order (a Vector in Java; here an array, null for "no name"). Text form: "x.y.z."
 */
import { javaTrim } from '../util/java';

export type BoundVariableNames = (string | null)[];

export function encodeBoundVariableNames(names: readonly (string | null | undefined)[]): string {
  let s = '';
  for (const n of names) s += (n == null ? '' : n) + '.';
  return s;
}

export function decodeBoundVariableNames(s: string): BoundVariableNames {
  const names: BoundVariableNames = [];
  let i: number;
  while ((i = s.indexOf('.')) !== -1) {
    const name = javaTrim(s.substring(0, i));
    names.push(name === '' ? null : name);
    s = s.substring(i + 1);
  }
  return names;
}

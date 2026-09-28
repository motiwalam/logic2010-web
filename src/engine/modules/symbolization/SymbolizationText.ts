/**
 * The text helpers of SymbolizationTextPanel.java (collapseWhitespace) and
 * SymbolizationNode.java (setEnglishText / getEnglishText escapes).
 */

function isCollapsibleSpace(c: string): boolean {
  return c <= ' ' && c !== '\n';
}

function adjustIndexes(indexes: number[] | null, i: number, j: number): void {
  if (indexes == null) return;
  for (let k = indexes.length; --k >= 0; ) {
    if (indexes[k] > i && indexes[k] <= j) indexes[k] = i;
  }
}

/**
 * SymbolizationTextPanel.collapseWhitespace: runs of blanks (other than newlines) become
 * the first of them, a trailing blank is removed, and a leading run is dropped. Empty text
 * becomes four blanks (so an empty node still shows a box). indexes (e.g. a selection) are
 * moved with the text.
 */
export function collapseWhitespace(s: string | null, indexes: number[] | null = null): string {
  if (s == null) s = '';
  const chars = s.split('');
  let i = 0;
  let j = 0;
  const k = chars.length;
  while (i < k) {
    while (i < k && isCollapsibleSpace(chars[i])) i++;
    while (i < k && !isCollapsibleSpace(chars[i])) {
      adjustIndexes(indexes, j, i);
      chars[j++] = chars[i++];
    }
    if (i < k) {
      adjustIndexes(indexes, j, i);
      chars[j++] = chars[i++];
    }
  }
  if (j > 0 && isCollapsibleSpace(chars[j - 1])) j--;
  adjustIndexes(indexes, j, k);
  return j === 0 ? '    ' : chars.slice(0, j).join('');
}

/** SymbolizationNode.setEnglishText's unescaping: "\n" is a newline, "\c" is c. */
export function unescapeEnglish(s: string | null): string {
  let out = '';
  if (s == null) return out;
  for (;;) {
    const i = s.indexOf('\\');
    if (i === -1) return out + s;
    out += s.substring(0, i);
    if (i + 1 < s.length) {
      const c = s.charAt(i + 1);
      out += c === 'n' ? '\n' : c;
      s = s.substring(i + 2);
    } else {
      return out;
    }
  }
}

/** SymbolizationNode.getEnglishText's escaping of collapsed text: newline as "\n", "\" as "\\". */
export function escapeEnglish(text: string): string {
  let s = '';
  let s1 = collapseWhitespace(text);
  for (;;) {
    const i = s1.indexOf('\\');
    const j = s1.indexOf('\n');
    if (i === -1 && j === -1) return s + s1;
    if (i === -1 || (j !== -1 && i >= j)) {
      s += s1.substring(0, j) + '\\n';
      s1 = s1.substring(j + 1);
    } else {
      s += s1.substring(0, i) + '\\\\';
      s1 = s1.substring(i + 1);
    }
  }
}

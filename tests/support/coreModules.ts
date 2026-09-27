/**
 * Minimal ProblemSet subclasses for testing the problem framework: the modules'
 * getProblemStatement and hasWork (LPxxx.getProblemStatement / hasWork), no checking.
 */
import { DelimitedTokenizer } from '../../src/engine/util/DelimitedTokenizer';
import { TaggedRecord } from '../../src/engine/data/TaggedRecord';
import { ProblemEntry } from '../../src/engine/problems/ProblemEntry';
import { ProblemSet } from '../../src/engine/problems/ProblemSet';

class TestEntry extends ProblemEntry {
  computeState(): number {
    return 0;
  }
}

function derivationLines(t: TaggedRecord): number {
  let j = 0;
  let k = 0;
  for (let l = 0; l < t.getFieldCount(); l++) {
    const c = t.tagAt(l);
    if (c === '-' || c === '+') {
      j++;
      k++;
    } else if (c === '<') j++;
    else if (c === '#') {
      j++;
      if (--k === 0) break;
    } else if (c === '=') {
      if (--k === 0) break;
    }
  }
  return j;
}

function symbolizationSymbol(t: TaggedRecord): string | null {
  const s = t.valueAt(t.indexOfTag('+'));
  if (s == null) return t.indexOfTag('-') === -1 ? null : '?';
  const d = new DelimitedTokenizer('\\:');
  d.setInput(s);
  const s1 = d.nextToken();
  return d.getRemaining() == null ? null : s1;
}

export class TestProblemSet extends ProblemSet {
  searchNotes: (string | null)[] | null = null;

  constructor(readonly module: number) {
    super();
  }

  static nameOfEntry(record: string): string | null {
    return TaggedRecord.nameOf(record);
  }

  getProblemStatement(t: TaggedRecord): string | null {
    switch (this.module) {
      case 0:
        return t.valueAt(t.indexOfAnyTag('-+'));
      case 1:
        return t.valueAt(t.indexOfTag('?'));
      case 4: {
        const s = t.valueAt(t.indexOfTag('-'));
        if (s != null) return s;
        const n = t.valueAt(t.indexOfTag('+'));
        if (n == null) return null;
        const d = new DelimitedTokenizer('\\:');
        d.setInput(n);
        d.nextToken();
        return d.getRemaining();
      }
      default:
        return t.valueAt(t.indexOfAnyTag('='));
    }
  }

  hasWork(t: TaggedRecord): boolean {
    switch (this.module) {
      case 0:
        return derivationLines(t) > 1;
      case 1:
        return t.indexOfTag('#') !== -1 || t.indexOfTag('&') !== -1;
      case 2:
        return t.indexOfTag('[') !== -1 || t.indexOfTag(']') !== -1 || t.indexOfTag('*') !== -1;
      case 3:
        return t.indexOfTag('*') !== -1;
      case 4:
        return t.indexOfTag('-') === -1 ? symbolizationSymbol(t) !== '?' : t.indexOfTag('+') !== -1;
      default:
        return t.indexOfAnyTag('@*#&') !== -1;
    }
  }

  getWork(): string | null {
    return null;
  }

  removeWork(): string | null {
    return null;
  }

  createEntry(record: string, unchecked: boolean): ProblemEntry {
    return new TestEntry(record, unchecked, null);
  }

  getModuleIndex(): number {
    return this.module;
  }

  async restateProblems(): Promise<void> {}

  override getSearchNote(t: TaggedRecord): string | null {
    if (this.searchNotes == null) return null;
    const i = this.indexOfName(t.getName());
    return i === -1 ? null : this.searchNotes[i];
  }
}

/** A DataSource over the repository's data with some files replaced. */
export function overlay(base: import('../../src/engine/data/DataSource').DataSource, files: Record<string, string>) {
  return {
    async readText(path: string) {
      return path in files ? files[path] : base.readText(path);
    },
  };
}

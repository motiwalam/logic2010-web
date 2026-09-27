/**
 * Port of HighlightedText.java: a string plus one IntervalSet of character ranges per
 * highlight layer (null entries allowed). The UI renders the layers as colors (the desktop's
 * TextHighlighter builds a Swing document from it).
 */
import { IntervalSet } from '../program/IntervalSet';
import { stringHash } from '../util/java';

export class HighlightedText {
  text: string | null;
  layers: (IntervalSet | null)[] | null;

  constructor(text: string | null = null, layers: (IntervalSet | null)[] | null = null) {
    this.text = text;
    this.layers = layers;
  }

  length(): number {
    return this.text == null ? 0 : this.text.length;
  }

  layerCount(): number {
    return this.layers == null ? 0 : this.layers.length;
  }

  copy(): HighlightedText {
    if (this.layers == null) return new HighlightedText(this.text, null);
    return new HighlightedText(this.text, this.layers.map((l) => l!.copy()));
  }

  /** Appends text, or highlighted text (its layers shifted to the end of this text). */
  append(other: HighlightedText | string | null): HighlightedText {
    if (other instanceof HighlightedText) {
      const n = this.length();
      const k = other.layerCount();
      if (k > this.layerCount()) {
        if (this.layers == null) this.layers = [];
        while (this.layers.length < k) this.layers.push(null);
      }
      for (let l = 0; l < k; l++) {
        const mine = this.layers![l];
        const theirs = other.layers![l];
        if (theirs != null) {
          const shifted = theirs.copy().shift(n);
          if (mine == null) this.layers![l] = shifted;
          else mine.union(shifted);
        }
      }
      return this.append(other.text);
    }
    if (this.text == null) this.text = other;
    else if (other != null) this.text = this.text + other;
    return this;
  }

  substring(start: number, end: number = this.length()): HighlightedText {
    const n = this.length();
    if (start > n) start = n;
    if (end > n) end = n;
    const result = new HighlightedText();
    if (this.text != null) result.text = this.text.substring(start, end);
    if (this.layers != null) {
      result.layers = this.layers.map((l) =>
        l == null ? null : l.intersect(IntervalSet.range(start, end - start)).shift(-start),
      );
    }
    return result;
  }

  hasHighlights(): boolean {
    return (this.layers ?? []).some((l) => l != null && !l.isEmpty());
  }

  sharesHighlightLayer(other: HighlightedText): boolean {
    const n = Math.min(this.layerCount(), other.layerCount());
    for (let j = 0; j < n; j++) {
      const a = this.layers![j];
      const b = other.layers![j];
      if (a != null && !a.isEmpty() && b != null && !b.isEmpty()) return true;
    }
    return false;
  }

  equals(o: unknown): boolean {
    if (!(o instanceof HighlightedText)) return false;
    if (!(this.length() === 0 ? o.length() === 0 : this.text === o.text)) return false;
    const [fewer, more] = this.layerCount() < o.layerCount() ? [this, o] : [o, this];
    const j = fewer.layerCount();
    for (let i = 0; i < j; i++) {
      const a = fewer.layers![i];
      const b = more.layers![i];
      const aEmpty = a == null || a.isEmpty();
      const bEmpty = b == null || b.isEmpty();
      if ((!aEmpty || !bEmpty) && (aEmpty || bEmpty || !a!.equals(b))) return false;
    }
    for (let l = j; l < more.layerCount(); l++) {
      const c = more.layers![l];
      if (c != null && !c.isEmpty()) return false;
    }
    return true;
  }

  hashCode(): number {
    let h = this.length() === 0 ? 0 : stringHash(this.text!);
    for (let k = 0; k < this.layerCount(); k++) {
      h = Math.imul(h, 40701);
      const l = this.layers![k];
      if (l != null && !l.isEmpty()) h = (h + l.hashCode()) | 0;
    }
    return h;
  }
}

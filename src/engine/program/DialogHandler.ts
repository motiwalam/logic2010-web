/**
 * The button spec of a message dialog, as data. Port of the non-UI part of
 * DialogHandler.java.
 *
 * A spec such as "Retry:retry. Quit:quit;0" lists buttons, each a label with an optional
 * action after ':', separated by '.'; the number after ';' is the default button's index.
 * A backslash escapes the next character. A null spec is "OK".
 */
import { DelimitedTokenizer } from '../util/DelimitedTokenizer';
import { javaTrim, parseJavaInt } from '../util/java';

export class DialogHandler {
  readonly labels: string[] = [];
  /** The action of each button (null if it has none). */
  readonly actions: (string | null)[] = [];
  /** The default button's index, or -1. */
  readonly defaultIndex: number = -1;

  constructor(spec: string | null) {
    if (spec == null) spec = 'OK';
    const parts = new DelimitedTokenizer('\\;');
    const buttons = new DelimitedTokenizer('\\:.');
    const action = new DelimitedTokenizer('\\.');
    parts.setInput(spec);
    buttons.setInput(parts.nextToken(true));
    const rest = parts.getRemaining();
    if (rest != null) {
      const n = parseJavaInt(javaTrim(rest));
      if (n != null) this.defaultIndex = n;
    }
    for (;;) {
      const label = buttons.nextToken();
      if (label == null) return;
      let act: string | null = null;
      if (buttons.getDelimiter() === ':') {
        action.setInput(buttons.getRemaining());
        act = javaTrim(action.nextToken() ?? 'null');
        buttons.setInput(action.getRemaining());
      }
      this.labels.push(javaTrim(label));
      this.actions.push(act);
    }
  }

  getLabels(): string[] {
    return this.labels;
  }

  getDefaultIndex(): number {
    return this.defaultIndex;
  }

  /** The action of the button with the label (getSelectedAction), or null. */
  actionFor(label: string): string | null {
    const i = this.labels.indexOf(label);
    return i === -1 ? null : this.actions[i];
  }
}

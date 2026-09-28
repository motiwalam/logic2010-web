import type { Notation } from '../../workspace/paths';
import { useNotation } from '../app/notation';
import { dialogs } from '../dialogs/dialogs';
import { useEngine } from '../engine/engine';
import { setPrefs } from '../prefs';

/** The notation setting (switching reloads the engine; work is kept per notation). */
export function NotationSwitch({ compact }: { compact?: boolean }) {
  const notation = useNotation();
  const engine = useEngine();
  const choose = (n: Notation) => {
    if (n === notation) return;
    setPrefs({ notation: n });
    dialogs.notify(`Notation ${n}. Your notation ${notation} work is kept; switch back any time.`);
  };
  return (
    <div className={'notation-switch' + (compact ? ' is-compact' : '')} role="group" aria-label="Formula notation">
      <span className="notation-label" id="notation-label">
        Notation
      </span>
      {([1, 2] as const).map((n) => (
        <button
          key={n}
          type="button"
          className={n === notation ? 'is-on' : ''}
          aria-pressed={n === notation}
          aria-describedby="notation-label"
          disabled={engine.status === 'loading'}
          title={n === 2 ? 'Notation 2: the current textbook' : 'Notation 1'}
          onClick={() => choose(n)}
        >
          {n}
        </button>
      ))}
    </div>
  );
}


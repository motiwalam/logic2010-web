import { useNotation } from '../app/notation';
import { formatShortcut } from '../components/shortcuts';
import { useEngine } from '../engine/engine';
import { helpFor, textbookChapters } from '../help';
import { MODULE_CATALOG } from '../modules/registry';

const FORMULA_KEYS: [string, string, string][] = [
  ['→', '->', 'C'],
  ['↔', '<->', 'B'],
  ['∧', '&', 'A'],
  ['∨', '|', 'O'],
  ['∼', '~', 'N'],
  ['∀x', '@x or forall x', 'U'],
  ['∃x', '!x or exists x', 'E'],
  ['≠', '<>', 'I'],
  ['℩', '%', 'D'],
  ['∴', '.:', 'T'],
];

export function HelpPage() {
  const engine = useEngine();
  const notation = useNotation();
  const ready = engine.status === 'ready';
  const chapters = textbookChapters(notation);
  return (
    <main id="main" className="page help">
      <div className="page-head">
        <h1>Help</h1>
        <p className="muted">The course’s help documents open as PDFs in a new tab.</p>
      </div>

      <section className="help-section" aria-labelledby="help-typing">
        <h2 id="help-typing">Typing formulas</h2>
        <p>
          Type the plain-text form of a symbol and it turns into the symbol as you type, or use the shortcut, or click it on the keypad (the ∀→ button at
          the end of a formula field). Where the browser keeps a Ctrl+Shift key for itself, Alt with the same letter works too.
        </p>
        <table className="keys-table">
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Type</th>
              <th scope="col">Shortcut</th>
            </tr>
          </thead>
          <tbody>
            {FORMULA_KEYS.map(([sym, ascii, key]) => (
              <tr key={sym}>
                <td className="formula">{sym}</td>
                <td>
                  <code>{ascii}</code>
                </td>
                <td>
                  <kbd className="kbd">{formatShortcut('Mod+Shift+' + key)}</kbd> or <kbd className="kbd">{formatShortcut('Alt+' + key)}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          In a formula field, {formatShortcut('Mod+B')} selects the brackets around the cursor (press again to widen) and {formatShortcut('Mod+E')} the
          enclosing formula.
        </p>
      </section>

      {chapters.length > 0 && (
        <section className="help-section" aria-labelledby="help-text">
          <h2 id="help-text">The textbook</h2>
          <p className="muted small">Terence Parsons, An Exposition of Symbolic Logic with Kalish-Montague derivations (notation 2).</p>
          <ul className="doc-list">
            {chapters.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noopener">
                  {c.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="help-section" aria-labelledby="help-general">
        <h2 id="help-general">The program</h2>
        <DocList docs={ready ? helpFor(null) : []} />
      </section>
      {MODULE_CATALOG.map((m) => (
        <section key={m.id} className="help-section" aria-labelledby={'help-' + m.id}>
          <h2 id={'help-' + m.id}>{m.title}</h2>
          <DocList docs={ready ? helpFor(m.id) : []} />
        </section>
      ))}
      {!ready && <p className="muted">Loading the list of documents…</p>}
    </main>
  );
}

function DocList({ docs }: { docs: ReturnType<typeof helpFor> }) {
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.key}>
          <a href={d.url} target="_blank" rel="noopener">
            {d.title}
          </a>
          <span className="muted small"> {d.about}</span>
        </li>
      ))}
    </ul>
  );
}

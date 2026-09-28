// FormulaInput: a text field for formulas. The value is ASCII "maggie" notation (as stored
// in work files); the field shows logic symbols. Port of the behaviour of the desktop's
// FormulaTextPane / FormulaEntryField:
//   - typing ASCII forms (-> <-> & | ~ @ ! .: <> [m] %) or "forall x"/"exists x" shows symbols
//   - Ctrl+Shift+A/B/C/D/E/I/N/O/T/U/Enter insert & <-> -> % ! <> ~ | .: @ [m]
//     (Alt+letter does the same, for browsers that keep some Ctrl+Shift keys for themselves)
//   - Ctrl+B selects the enclosing brackets (repeat to widen); Ctrl+E the enclosing formula
//   - Alt+1..9 inserts the placeholders {1}..{9} (when allowPlaceholders)
//   - the symbol keypad (button at the end of the field, or right-click) inserts symbols

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { SchematicLetter } from '../../engine/formula/SchematicLetter';
import { operationLetters, predicateLetters, sentenceLetters } from '../../engine/program/symbols';
import {
  fromValue,
  insertText,
  keypadRows,
  normalize,
  selectEnclosingBrackets,
  selectEnclosingFormula,
  SHORTCUT_SYMBOLS,
  type FieldState,
} from '../formula/formulaText';
import { getPrefs } from '../prefs';
import { formatShortcut, isMac } from './shortcuts';

export interface FormulaInputProps {
  /** The formula in maggie notation. */
  value: string;
  onChange(value: string): void;
  /** Enter was pressed (without Ctrl+Shift). */
  onEnter?(e: KeyboardEvent<HTMLInputElement>): void;
  onKeyDown?(e: KeyboardEvent<HTMLInputElement>): void;
  onFocus?(): void;
  onBlur?(): void;
  id?: string;
  ariaLabel?: string;
  describedBy?: string;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  /** Allow Alt+1..9 to insert {1}..{9}. */
  allowPlaceholders?: boolean;
  /** Offer the keypad (default true). */
  keypad?: boolean;
  /** Start with the keypad open (default: the user's preference). */
  keypadOpen?: boolean;
  className?: string;
  /** Size of the field in characters (default: fills its container). */
  size?: number;
}

export interface FormulaInputHandle {
  focus(): void;
  /** Inserts maggie text at the caret. */
  insert(text: string): void;
  /** Selects a range of the value (maggie positions). */
  selectValueRange(start: number, end: number): void;
  input: HTMLInputElement | null;
}

export const FormulaInput = forwardRef<FormulaInputHandle, FormulaInputProps>(function FormulaInput(props, ref) {
  const { value, onChange, readOnly, disabled } = props;
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<FieldState>(() => fromValue(value));
  const pendingSelection = useRef<[number, number] | null>(null);
  const lastSelection = useRef<[number, number]>([state.selStart, state.selEnd]);
  const composing = useRef(false);
  const [keypadOpen, setKeypadOpen] = useState(props.keypadOpen ?? getPrefs().keypadOpen);
  const editable = !readOnly && !disabled;

  // value changed from outside
  useEffect(() => {
    if (value !== state.value) setState(fromValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useLayoutEffect(() => {
    const sel = pendingSelection.current;
    if (sel && input.current) {
      input.current.setSelectionRange(sel[0], sel[1]);
      lastSelection.current = sel;
      pendingSelection.current = null;
    }
  });

  const apply = useCallback(
    (next: FieldState) => {
      setState(next);
      pendingSelection.current = [next.selStart, next.selEnd];
      if (next.value !== state.value) onChange(next.value);
    },
    [onChange, state.value],
  );

  const current = (): FieldState => {
    const el = input.current;
    if (!el) return state;
    const inField = document.activeElement === el;
    const [s, e] = inField ? [el.selectionStart ?? 0, el.selectionEnd ?? 0] : lastSelection.current;
    return { ...state, display: el.value, selStart: s, selEnd: e };
  };

  const insert = (text: string) => {
    if (!editable) return;
    apply(insertText(current(), text));
  };

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    insert,
    selectValueRange: (start, end) => {
      // maggie positions -> display positions
      const s = fromValue(state.value.slice(0, start)).display.length;
      const t = fromValue(state.value.slice(0, end)).display.length;
      input.current?.focus();
      input.current?.setSelectionRange(s, t);
    },
    input: input.current,
  }));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    props.onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    // Ctrl+Shift+letter (desktop) or Alt+letter: a connective
    if ((mod && e.shiftKey && !e.altKey) || (e.altKey && !mod && !e.shiftKey)) {
      const sym = SHORTCUT_SYMBOLS[e.code];
      if (sym) {
        e.preventDefault();
        insert(sym);
        return;
      }
    }
    if (e.altKey && !mod && props.allowPlaceholders && /^Digit[1-9]$/.test(e.code)) {
      e.preventDefault();
      insert(SchematicLetter.placeholder(Number(e.code.slice(5)) - 1));
      return;
    }
    if (mod && !e.shiftKey && !e.altKey && (e.code === 'KeyB' || e.code === 'KeyE')) {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart ?? 0;
      const t = el.selectionEnd ?? s;
      const range = e.code === 'KeyB' ? selectEnclosingBrackets(el.value, s, t) : selectEnclosingFormula(el.value, s, t);
      if (range) el.setSelectionRange(range[0], range[1]);
      return;
    }
    if (e.key === 'Enter' && props.onEnter && !mod && !e.shiftKey) {
      e.preventDefault();
      props.onEnter(e);
      return;
    }
    if (e.key === 'Escape' && keypadOpen) {
      setKeypadOpen(false);
      e.preventDefault();
    }
  };

  const rememberSelection = () => {
    const el = input.current;
    if (el) lastSelection.current = [el.selectionStart ?? 0, el.selectionEnd ?? 0];
  };

  const showKeypad = props.keypad !== false && editable;
  const keypadId = (props.id ?? 'formula') + '-keypad';

  return (
    <div className={'formula-input' + (props.invalid ? ' is-invalid' : '') + (props.className ? ' ' + props.className : '')}>
      <div className="formula-input-row">
        <input
          ref={input}
          id={props.id}
          className="input formula"
          type="text"
          value={state.display}
          size={props.size}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          readOnly={readOnly}
          disabled={disabled}
          autoFocus={props.autoFocus}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          aria-describedby={props.describedBy}
          aria-invalid={props.invalid || undefined}
          onChange={(e) => {
            const el = e.currentTarget;
            if (composing.current) {
              setState({ ...state, display: el.value });
              return;
            }
            apply(normalize(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length));
          }}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={(e) => {
            composing.current = false;
            const el = e.currentTarget;
            apply(normalize(el.value, el.selectionStart ?? 0, el.selectionEnd ?? 0));
          }}
          onKeyDown={onKeyDown}
          onSelect={rememberSelection}
          onBlur={() => {
            rememberSelection();
            props.onBlur?.();
          }}
          onFocus={props.onFocus}
          onContextMenu={(e) => {
            if (showKeypad && !e.shiftKey) {
              e.preventDefault();
              setKeypadOpen(true);
            }
          }}
        />
        {showKeypad && (
          <button
            type="button"
            className={'keypad-toggle' + (keypadOpen ? ' is-open' : '')}
            aria-expanded={keypadOpen}
            aria-controls={keypadId}
            title="Symbol keypad"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setKeypadOpen(!keypadOpen)}
          >
            <span aria-hidden="true">∀→</span>
            <span className="visually-hidden">Symbol keypad</span>
          </button>
        )}
      </div>
      {showKeypad && keypadOpen && (
        <SymbolKeypad
          id={keypadId}
          onInsert={insert}
          onBackspace={() => {
            const st = current();
            if (st.selStart !== st.selEnd) apply(normalize(st.display.slice(0, st.selStart) + st.display.slice(st.selEnd), st.selStart, st.selStart));
            else if (st.selStart > 0) apply(normalize(st.display.slice(0, st.selStart - 1) + st.display.slice(st.selStart), st.selStart - 1, st.selStart - 1));
          }}
          onPaste={async () => {
            try {
              insert(await navigator.clipboard.readText());
            } catch {
              // clipboard not available
            }
          }}
          onCopy={() => {
            const st = current();
            const text = st.selStart !== st.selEnd ? st.display.slice(st.selStart, st.selEnd) : st.display;
            void navigator.clipboard?.writeText(text).catch(() => undefined);
          }}
          onClose={() => {
            setKeypadOpen(false);
            input.current?.focus();
          }}
        />
      )}
    </div>
  );
});

export interface SymbolKeypadProps {
  id?: string;
  onInsert(maggie: string): void;
  onBackspace?(): void;
  onCopy?(): void;
  onPaste?(): void;
  onClose?(): void;
}

/**
 * The symbol keypad (the desktop's SymbolKeypadDialog): connectives, sentence letters,
 * punctuation, operation and predicate letters, variables and digits of the current notation.
 * Buttons do not take focus, so the caret stays in the field.
 */
export function SymbolKeypad({ id, onInsert, onBackspace, onCopy, onPaste, onClose }: SymbolKeypadProps) {
  const rows = keypadRows({ sentence: sentenceLetters, operation: operationLetters, predicate: predicateLetters });
  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div id={id} className="keypad" role="group" aria-label="Symbol keypad">
      {rows.map((row) => (
        <div key={row.title} className="keypad-row" role="group" aria-label={row.title}>
          {row.keys.map((k) => (
            <button
              key={k.insert}
              type="button"
              className={'keypad-key' + (row.title === 'Connectives' || row.title === 'Punctuation' ? ' is-symbol' : '')}
              onMouseDown={keep}
              onClick={() => onInsert(k.insert)}
              aria-label={k.name}
              title={k.shortcut ? `${k.name} (${formatShortcut('Mod+Shift+' + k.shortcut)} or ${formatShortcut('Alt+' + k.shortcut)})` : k.name}
            >
              {k.label}
            </button>
          ))}
        </div>
      ))}
      <div className="keypad-row keypad-actions">
        <button type="button" className="keypad-key is-wide" onMouseDown={keep} onClick={() => onInsert(' ')}>
          space
        </button>
        {onBackspace && (
          <button type="button" className="keypad-key is-wide" onMouseDown={keep} onClick={onBackspace} aria-label="Backspace">
            ⌫
          </button>
        )}
        {onCopy && (
          <button type="button" className="keypad-key is-wide" onMouseDown={keep} onClick={onCopy}>
            copy
          </button>
        )}
        {onPaste && (
          <button type="button" className="keypad-key is-wide" onMouseDown={keep} onClick={onPaste}>
            paste
          </button>
        )}
        {onClose && (
          <button type="button" className="keypad-key is-wide keypad-close" onMouseDown={keep} onClick={onClose}>
            close
          </button>
        )}
      </div>
    </div>
  );
}

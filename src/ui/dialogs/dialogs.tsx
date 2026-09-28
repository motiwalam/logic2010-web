// Promise-based dialogs, usable from React and from plain code (engine paths that ask the
// user something: `const term = await dialogs.prompt({...})`). <DialogHost/> (in the app
// shell) renders them as modal <dialog> elements; toasts are rendered by it too.

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { DialogHandler } from '../../engine/program/DialogHandler';
import { FormulaInput } from '../components/FormulaInput';
import { FormulaText } from '../components/FormulaText';
import { MessageBody, type MessageLike } from '../components/MessageView';

export type Tone = 'neutral' | 'info' | 'error' | 'danger';

export interface OpenOptions<T> {
  /** The dialog's title (also its accessible name). */
  title: ReactNode;
  /** What Escape or the close button resolves with. */
  dismissValue: T;
  tone?: Tone;
  size?: 'small' | 'medium' | 'large';
}

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

export interface Choice<T> {
  value: T;
  label: ReactNode;
  /** A formula (maggie) shown in logic symbols instead of / after the label. */
  formula?: string;
  description?: ReactNode;
  disabled?: boolean;
}

export interface ChooseOptions<T> {
  title: string;
  prompt?: ReactNode;
  choices: Choice<T>[];
  /** Initially focused choice index. */
  initial?: number;
  /** Show a Cancel button (default true); cancelling resolves null. */
  cancellable?: boolean;
}

export interface PromptOptions {
  title: string;
  prompt?: ReactNode;
  label?: string;
  initial?: string;
  placeholder?: string;
  /** A formula field (value in maggie notation, shown in symbols, with the keypad). */
  formula?: boolean;
  /** An error message for the value, or null if it is acceptable. */
  validate?: (value: string) => string | null | Promise<string | null>;
  confirmLabel?: string;
}

export interface MessageResult {
  /** The label of the button pressed. */
  label: string;
  /** Its action from the button spec (null if none). */
  action: string | null;
  index: number;
}

export interface Toast {
  id: number;
  text: ReactNode;
  tone: 'info' | 'success' | 'error';
}

export interface DialogApi {
  /** A custom dialog: render gets `close(value)`. */
  open<T>(render: (close: (value: T) => void) => ReactNode, opts: OpenOptions<T>): Promise<T>;
  /** A catalogue message with its buttons (`b` spec); null if dismissed with Escape. */
  message(msg: MessageLike): Promise<MessageResult | null>;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** One of several choices (e.g. which conjunct); null if cancelled. */
  choose<T>(opts: ChooseOptions<T>): Promise<T | null>;
  /** A line of text or a formula; null if cancelled. */
  prompt(opts: PromptOptions): Promise<string | null>;
  /** A short, non-blocking notice. */
  notify(text: ReactNode, opts?: { tone?: Toast['tone']; timeoutMs?: number }): void;
}

interface Entry {
  id: number;
  opts: OpenOptions<unknown>;
  render: (close: (value: unknown) => void) => ReactNode;
  resolve: (value: unknown) => void;
}

let entries: Entry[] = [];
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
let snapshot = { entries, toasts };

function emit(): void {
  snapshot = { entries, toasts };
  for (const l of [...listeners]) l();
}

function close(id: number, value: unknown): void {
  const e = entries.find((x) => x.id === id);
  if (!e) return;
  entries = entries.filter((x) => x.id !== id);
  emit();
  e.resolve(value);
}

export const dialogs: DialogApi = {
  open<T>(render: (close: (value: T) => void) => ReactNode, opts: OpenOptions<T>): Promise<T> {
    return new Promise<T>((resolve) => {
      const id = nextId++;
      entries = [
        ...entries,
        {
          id,
          opts: opts as OpenOptions<unknown>,
          render: render as (close: (value: unknown) => void) => ReactNode,
          resolve: resolve as (value: unknown) => void,
        },
      ];
      emit();
    });
  },

  message(msg) {
    const handler = new DialogHandler(msg.buttons ?? null);
    return dialogs.open<MessageResult | null>(
      (done) => (
        <>
          <MessageBody message={msg} showExplanation />
          <DialogButtons>
            {handler.getLabels().map((label, i) => (
              <button
                key={i}
                type="button"
                className={i === handler.getDefaultIndex() || (handler.getDefaultIndex() < 0 && i === 0) ? 'btn btn-primary' : 'btn'}
                autoFocus={i === handler.getDefaultIndex() || (handler.getDefaultIndex() < 0 && i === 0)}
                onClick={() => done({ label, action: handler.actions[i], index: i })}
              >
                {label}
              </button>
            ))}
          </DialogButtons>
        </>
      ),
      { title: <MessageTitle message={msg} />, dismissValue: null, tone: msg.isError ? 'error' : 'info', size: 'medium' },
    );
  },

  confirm(opts) {
    return dialogs.open<boolean>(
      (done) => (
        <>
          {opts.body != null && <div className="dialog-text">{opts.body}</div>}
          <DialogButtons>
            <button type="button" className="btn" onClick={() => done(false)} autoFocus={opts.danger}>
              {opts.cancelLabel ?? 'Cancel'}
            </button>
            <button type="button" className={opts.danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => done(true)} autoFocus={!opts.danger}>
              {opts.confirmLabel ?? 'OK'}
            </button>
          </DialogButtons>
        </>
      ),
      { title: opts.title, dismissValue: false, tone: opts.danger ? 'danger' : 'neutral', size: 'small' },
    );
  },

  choose<T>(opts: ChooseOptions<T>) {
    return dialogs.open<T | null>((done) => <ChooseBody opts={opts} done={done} />, {
      title: opts.title,
      dismissValue: null,
      size: 'medium',
    });
  },

  prompt(opts) {
    return dialogs.open<string | null>((done) => <PromptBody opts={opts} done={done} />, {
      title: opts.title,
      dismissValue: null,
      size: 'medium',
    });
  },

  notify(text, opts = {}) {
    const toast: Toast = { id: nextId++, text, tone: opts.tone ?? 'info' };
    toasts = [...toasts, toast].slice(-4);
    emit();
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== toast.id);
      emit();
    }, opts.timeoutMs ?? (toast.tone === 'error' ? 9000 : 5000));
  },
};

function useDialogState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function MessageTitle({ message }: { message: MessageLike }) {
  return <MessageBody message={message} titleOnly />;
}

export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className="dialog-buttons">{children}</div>;
}

function ChooseBody<T>({ opts, done }: { opts: ChooseOptions<T>; done: (v: T | null) => void }) {
  const [index, setIndex] = useState(opts.initial ?? opts.choices.findIndex((c) => !c.disabled));
  const name = useRef('choice-' + nextId++).current;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = opts.choices[index];
    if (c && !c.disabled) done(c.value);
  };
  return (
    <form onSubmit={submit}>
      {opts.prompt != null && <div className="dialog-text">{opts.prompt}</div>}
      <fieldset className="choice-list">
        <legend className="visually-hidden">{opts.title}</legend>
        {opts.choices.map((c, i) => (
          <label key={i} className={'choice' + (i === index ? ' is-selected' : '') + (c.disabled ? ' is-disabled' : '')}>
            <input
              type="radio"
              name={name}
              checked={i === index}
              disabled={c.disabled}
              onChange={() => setIndex(i)}
              onDoubleClick={() => !c.disabled && done(c.value)}
              autoFocus={i === index}
            />
            <span className="choice-label">
              {c.label}
              {c.formula != null && <FormulaText value={c.formula} />}
              {c.description != null && <span className="choice-description">{c.description}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <DialogButtons>
        {opts.cancellable !== false && (
          <button type="button" className="btn" onClick={() => done(null)}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={index < 0}>
          Choose
        </button>
      </DialogButtons>
    </form>
  );
}

function PromptBody({ opts, done }: { opts: PromptOptions; done: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useRef('prompt-' + nextId++).current;
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    if (opts.validate) {
      setBusy(true);
      const err = await opts.validate(value);
      setBusy(false);
      if (err) {
        setError(err);
        return;
      }
    }
    done(value);
  };
  return (
    <form onSubmit={submit}>
      {opts.prompt != null && <div className="dialog-text">{opts.prompt}</div>}
      <div className="field">
        <label htmlFor={id}>{opts.label ?? opts.title}</label>
        {opts.formula ? (
          <FormulaInput
            id={id}
            value={value}
            onChange={(v) => {
              setValue(v);
              setError(null);
            }}
            onEnter={() => void submit()}
            autoFocus
            invalid={error != null}
            describedBy={error ? id + '-error' : undefined}
            placeholder={opts.placeholder}
          />
        ) : (
          <input
            id={id}
            className="input"
            value={value}
            placeholder={opts.placeholder}
            autoFocus
            aria-invalid={error != null}
            aria-describedby={error ? id + '-error' : undefined}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
        )}
        {error && (
          <p id={id + '-error'} className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogButtons>
        <button type="button" className="btn" onClick={() => done(null)}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {opts.confirmLabel ?? 'OK'}
        </button>
      </DialogButtons>
    </form>
  );
}

function ModalDialog({ entry, top }: { entry: Entry; top: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = 'dlg-title-' + entry.id;
  const opener = useRef<Element | null>(null);
  if (opener.current == null && typeof document !== 'undefined') opener.current = document.activeElement;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // the element React focused (autoFocus) before showModal moved the focus to the first button
    const wanted = document.activeElement instanceof HTMLElement && d.contains(document.activeElement) ? document.activeElement : null;
    if (!d.open) {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    }
    const fallback = d.querySelector<HTMLElement>('.modal-body input:not([type=hidden]), .modal-body .btn-primary, .modal-body button');
    (wanted ?? fallback)?.focus();
    const back = opener.current;
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);
  const tone = entry.opts.tone ?? 'neutral';
  return (
    <dialog
      ref={ref}
      className={`modal modal-${entry.opts.size ?? 'medium'} tone-${tone}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (top) close(entry.id, entry.opts.dismissValue);
      }}
    >
      <header className="modal-header">
        <h2 id={titleId} className="modal-title">
          {entry.opts.title}
        </h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => close(entry.id, entry.opts.dismissValue)}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="modal-body">{entry.render((v) => close(entry.id, v))}</div>
    </dialog>
  );
}

/** Renders the open dialogs and toasts; put one in the app shell. */
export function DialogHost() {
  const { entries: open, toasts: shown } = useDialogState();
  return (
    <>
      {open.map((e, i) => (
        <ModalDialog key={e.id} entry={e} top={i === open.length - 1} />
      ))}
      <div className="toasts" role="status" aria-live="polite">
        {shown.map((t) => (
          <div key={t.id} className={'toast toast-' + t.tone}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

// Catalogue messages (data/messages/*.rec): a title (`error:` or `info:`), a longer
// explanation (`text:`), and buttons (`buttons:` spec). The engine substitutes <param>s;
// the escapes \n and \l (logic symbols) are expanded here.

import { useId, useState } from 'react';
import { DialogHandler } from '../../engine/program/DialogHandler';
import { expandEscapes } from '../../engine/program/symbols';

/** A message as the engine's Message class has it (or built by hand). */
export interface MessageLike {
  title: string;
  /** The explanation (the catalogue's `text:` field), shown behind "Explain". */
  text?: string | null;
  isError?: boolean;
  /** Button spec, e.g. "Retry:retry. Quit:quit;0" (null: OK). */
  buttons?: string | null;
  /** The texts are already expanded (no \n or \l escapes to interpret). */
  expanded?: boolean;
}

const NO_EXPLANATION = 'no further explanation available';

function expand(s: string | null | undefined, expanded?: boolean): string {
  if (s == null) return '';
  return expanded ? s : expandEscapes(s);
}

export function hasExplanation(m: MessageLike): boolean {
  const t = m.text?.trim();
  return !!t && t !== NO_EXPLANATION && t !== m.title.trim();
}

function Icon({ error }: { error?: boolean }) {
  return error ? (
    <svg className="msg-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 5.5v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="1.1" fill="currentColor" />
    </svg>
  ) : (
    <svg className="msg-icon" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
      <circle cx="10" cy="10" r="8.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 9v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="10" cy="5.9" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** The title line and (optionally) the explanation, without buttons. */
export function MessageBody({ message, showExplanation, titleOnly }: { message: MessageLike; showExplanation?: boolean; titleOnly?: boolean }) {
  const title = expand(message.title, message.expanded);
  if (titleOnly) {
    return (
      <span className={'msg-title-inline ' + (message.isError ? 'is-error' : 'is-info')}>
        <Icon error={message.isError} />
        <span className="visually-hidden">{message.isError ? 'Error: ' : 'Note: '}</span>
        {title}
      </span>
    );
  }
  if (!showExplanation || !hasExplanation(message)) return null;
  return (
    <div className="msg-body">
      <p className="msg-explanation">{expand(message.text, message.expanded)}</p>
    </div>
  );
}

export interface MessageViewProps {
  message: MessageLike;
  /** A button of the message's spec was pressed. Without it, only a Dismiss button is shown. */
  onAction?(result: { label: string; action: string | null; index: number }): void;
  onDismiss?(): void;
  /** Open the explanation initially. */
  explain?: boolean;
  className?: string;
}

/**
 * A message shown in place (the module's message bar): the title with error/info styling,
 * "Explain" to reveal the long text, and the message's buttons.
 */
export function MessageView({ message, onAction, onDismiss, explain, className }: MessageViewProps) {
  const [open, setOpen] = useState(!!explain);
  const id = useId();
  const labels = onAction ? new DialogHandler(message.buttons ?? null) : null;
  const buttons = labels && !(labels.getLabels().length === 1 && labels.getLabels()[0] === 'OK') ? labels : null;
  const canExplain = hasExplanation(message);
  return (
    <div
      className={'msg ' + (message.isError ? 'msg-error' : 'msg-info') + (className ? ' ' + className : '')}
      role={message.isError ? 'alert' : 'status'}
    >
      <div className="msg-main">
        <Icon error={message.isError} />
        <span className="visually-hidden">{message.isError ? 'Error: ' : 'Note: '}</span>
        <span className="msg-title">{expand(message.title, message.expanded)}</span>
        <span className="msg-actions">
          {canExplain && (
            <button type="button" className="btn btn-small btn-quiet" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
              {open ? 'Hide explanation' : 'Explain'}
            </button>
          )}
          {buttons?.getLabels().map((label, i) => (
            <button
              key={i}
              type="button"
              className={'btn btn-small' + (i === buttons.getDefaultIndex() ? ' btn-primary' : '')}
              onClick={() => onAction?.({ label, action: buttons.actions[i], index: i })}
            >
              {label}
            </button>
          ))}
          {onDismiss && (
            <button type="button" className="icon-btn" aria-label="Dismiss message" onClick={onDismiss}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </span>
      </div>
      {canExplain && open && (
        <p id={id} className="msg-explanation">
          {expand(message.text, message.expanded)}
        </p>
      )}
    </div>
  );
}

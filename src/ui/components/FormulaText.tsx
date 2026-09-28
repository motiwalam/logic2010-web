import { toDisplay } from '../formula/formulaText';

/** A formula stored in ASCII (maggie) notation, shown in logic symbols in the formula font. */
export function FormulaText({ value, className, block }: { value: string; className?: string; block?: boolean }) {
  const Tag = block ? 'div' : 'span';
  return <Tag className={'formula' + (className ? ' ' + className : '')}>{toDisplay(value)}</Tag>;
}

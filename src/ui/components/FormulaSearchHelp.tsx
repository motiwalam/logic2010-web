// The search syntax of the problem lists with formula search (engine/problems/formulaSearch.ts).

import { FORMULA_SEARCH_HELP } from '../../engine/problems/formulaSearch';

export function FormulaSearchHelp() {
  return (
    <>
      <dl>
        {FORMULA_SEARCH_HELP.map(([example, meaning]) => (
          <div key={example} style={{ display: 'contents' }}>
            <dt>{example}</dt>
            <dd>{meaning}</dd>
          </div>
        ))}
      </dl>
      <p>Every term must match. A formula matches wherever it occurs, whatever its bound variables are called; forall x / exists x work too.</p>
    </>
  );
}

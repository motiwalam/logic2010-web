import { lazy } from 'react';
import { defineModule } from '../registry';
import { loadModule, summarizeSet } from './support';

export default defineModule({
  id: 'symbolization',
  title: 'Symbolization',
  description: 'Translate English sentences into the formulas of logic, part by part.',
  workFile: 'symbolization.rec',
  extraFiles: ['symbolization-answers.rec'],
  icon: '∀x',
  component: lazy(() => import('./SymbolizationScreen')),
  summarize: async (text) => {
    // the user key (symbolization-answers.rec) has no problems to count
    if (/^answer-key:/m.test(text)) return {};
    try {
      const m = await loadModule(text, null);
      return summarizeSet(m.problems!);
    } catch {
      return {};
    }
  },
  helpKeys: ['symHelp', 'symSamp'],
});

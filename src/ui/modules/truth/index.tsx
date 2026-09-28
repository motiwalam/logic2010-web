import { lazy } from 'react';
import { loadTruthModule, TruthWorkspace } from '../../../engine/modules/truth/LPTruthAnalysis';
import { truModule } from '../../../engine/program/ModuleConstants';
import { summarizeSet, workUser } from '../parsing/shared';
import { defineModule } from '../registry';

export default defineModule({
  id: 'truth-tables',
  title: 'Truth Tables',
  description: 'Fill in truth tables and decide validity, tautology and consistency.',
  workFile: 'truth-tables.rec',
  icon: 'TF',
  component: lazy(() => import('./TruthScreen')),
  summarize: async (text) => {
    await loadTruthModule();
    const ws = await TruthWorkspace.open({ fileName: 'truth-tables.rec', text }, workUser(truModule));
    return summarizeSet(ws.problems);
  },
  helpKeys: ['truHelp', 'truRefs'],
});

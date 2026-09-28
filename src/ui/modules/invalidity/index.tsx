import { lazy } from 'react';
import { InvalidityWorkspace, loadInvalidityModule } from '../../../engine/modules/invalidity/LPInvalidation';
import { invModule } from '../../../engine/program/ModuleConstants';
import { summarizeSet, workUser } from '../parsing/shared';
import { defineModule } from '../registry';

export default defineModule({
  id: 'invalidity',
  title: 'Invalidity',
  description: 'Give interpretations that show arguments invalid.',
  workFile: 'invalidity.rec',
  icon: '⊭',
  component: lazy(() => import('./InvalidityScreen')),
  summarize: async (text) => {
    await loadInvalidityModule();
    const ws = await InvalidityWorkspace.open({ fileName: 'invalidity.rec', text }, workUser(invModule));
    return summarizeSet(ws.problems);
  },
  helpKeys: ['invHelp', 'invRefs'],
});

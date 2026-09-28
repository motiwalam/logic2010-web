import { lazy } from 'react';
import { DerivationConfig } from '../../../engine/modules/derivation/DerivationConfig';
import { DerivationWorkspace } from '../../../engine/modules/derivation/DerivationWorkspace';
import { derModule } from '../../../engine/program/ModuleConstants';
import { summarizeSet, workUser } from '../parsing/shared';
import { defineModule } from '../registry';

export default defineModule({
  id: 'derivation',
  title: 'Derivations',
  description: 'Build natural-deduction proofs, line by line.',
  workFile: 'derivation.rec',
  icon: '∴',
  component: lazy(() => import('./DerivationScreen')),
  summarize: async (text) => {
    const config = await DerivationConfig.load();
    const ws = await DerivationWorkspace.open(config, { fileName: 'derivation.rec', text }, workUser(derModule));
    return summarizeSet(ws.problems);
  },
  helpKeys: ['derStart', 'derHelp', 'derTips', 'derFAQ'],
});

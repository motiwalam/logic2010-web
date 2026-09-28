import { lazy } from 'react';
import { ParsingModule } from '../../../engine/modules/parsing/LPParsing';
import { parModule } from '../../../engine/program/ModuleConstants';
import { defineModule } from '../registry';
import { summarizeSet, workUser } from './shared';

export default defineModule({
  id: 'parsing',
  title: 'Parsing',
  description: 'Tell formulas from non-formulas, and break formulas down into their parse trees.',
  workFile: 'parsing.rec',
  icon: '( )',
  component: lazy(() => import('./ParsingScreen')),
  summarize: async (text) => {
    const r = await ParsingModule.load({ work: { fileName: 'parsing.rec', text }, user: workUser(parModule) });
    return r.module ? summarizeSet(r.module.problems) : {};
  },
  helpKeys: ['parHelp'],
});

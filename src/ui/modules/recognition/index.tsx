import { lazy } from 'react';
import { RecognitionModule } from '../../../engine/modules/recognition/LPRecognition';
import { recModule } from '../../../engine/program/ModuleConstants';
import { summarizeSet, workUser } from '../parsing/shared';
import { defineModule } from '../registry';

export default defineModule({
  id: 'recognition',
  title: 'Recognizing Rules',
  description: 'Say which rule of inference an argument is an instance of.',
  workFile: 'recognition.rec',
  icon: 'MP',
  component: lazy(() => import('./RecognitionScreen')),
  summarize: async (text) => {
    const r = await RecognitionModule.load({ work: { fileName: 'recognition.rec', text }, user: workUser(recModule) });
    return r.module ? summarizeSet(r.module.problems) : {};
  },
  helpKeys: ['recHelp', 'recRefs'],
});

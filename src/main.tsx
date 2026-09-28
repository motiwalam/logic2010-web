import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './sync/api';
import { App } from './ui/App';
import { createServices } from './ui/app/context';
import { applyPrefs } from './ui/prefs';
import './ui/styles/index.css';
import { openDefaultStore } from './workspace/storage';
import { WorkspaceStore } from './workspace/WorkspaceStore';

applyPrefs();

async function start(): Promise<void> {
  const store = new WorkspaceStore({ api, storage: await openDefaultStore() });
  const services = createServices(store);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
  try {
    await store.init();
  } catch (err) {
    console.error('Could not start the workspace', err);
  }
}

void start();

// A module's page: the module bar (title, help, work-file actions) and the module's screen
// (or its placeholder), for your own work or, read-only, someone else's.

import { Component, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { workPath, type ModuleId } from '../../workspace/paths';
import type { WorkSource } from '../../workspace/source';
import { useServices, useWorkRevision } from '../app/context';
import { exportModule, forkFlow, importFlow, resetFlow } from '../app/workActions';
import { Menu, type MenuItem } from '../components/Toolbar';
import { dialogs } from '../dialogs/dialogs';
import { useEngine } from '../engine/engine';
import { helpFor, textbookChapters } from '../help';
import { PlaceholderModule } from '../modules/Placeholder';
import { getModule, moduleInfo, type ModuleProps } from '../modules/registry';
import { Link, navigate } from '../router';
import { NotFoundPage } from './NotFoundPage';

const LAST_KEY = 'logic2010:last';

export function rememberLast(module: string, problem: string | null): void {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ module, problem }));
  } catch {
    // not remembered
  }
}

export function lastVisited(): { module: string; problem: string | null } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as { module: string; problem: string | null }) : null;
  } catch {
    return null;
  }
}

export function ModulePage({ moduleId, problem, source, owner }: { moduleId: string; problem: string | null; source?: WorkSource; owner?: string }) {
  const services = useServices();
  const engine = useEngine();
  const info = moduleInfo(moduleId);
  const work = source ?? services.own;
  const readOnly = work.readOnly;
  useWorkRevision(work);
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!readOnly && info) rememberLast(info.id, problem);
  }, [readOnly, info, problem]);

  if (!info) return <NotFoundPage />;
  const def = getModule(info.id);
  const notation = engine.notation;

  const openProblem = (name: string | null, opts?: { replace?: boolean }) =>
    navigate(owner ? { name: 'person', username: owner, module: info.id, problem: name } : { name: 'module', module: info.id, problem: name }, opts);

  const helpItems: MenuItem[] = engine.status === 'ready' ? helpFor(info.id as ModuleId).map((d) => ({ label: d.title, description: d.about, href: d.url, external: true })) : [];
  const chapters = engine.status === 'ready' ? textbookChapters(notation) : [];

  const workItems: (MenuItem | 'separator')[] = readOnly
    ? [
        { label: `Export ${owner}'s ${info.workFile}`, onSelect: () => exportModule(work, notation, info.id) },
        { label: `Fork into my workspace`, onSelect: () => void forkFlow(services.store, services.own, work, notation) },
      ]
    : [
        { label: `Export ${info.workFile}`, description: 'Download this module’s work file (the desktop program reads it too).', onSelect: () => exportModule(work, notation, info.id) },
        { label: 'Import a work file…', description: 'Replace this module’s work with a .rec file.', onSelect: () => void importFlow(services.store, services.own, notation, undefined, info.id) },
        'separator',
        { label: 'Start this module over…', danger: true, onSelect: () => void resetFlow(services.store, services.own, notation, info.id) },
      ];

  const props: ModuleProps = {
    work,
    readOnly,
    notation,
    workPath: workPath(notation, info.workFile),
    problem,
    openProblem,
    dialogs,
    barSlot,
  };

  let body: ReactNode;
  if (engine.status === 'error') body = <div className="page-state">The course files could not be loaded.</div>;
  else if (engine.status !== 'ready') body = <div className="page-state" aria-busy="true">Loading the course files…</div>;
  else if (def) {
    const Screen = def.component;
    body = (
      <ModuleErrorBoundary key={engine.generation + ':' + (owner ?? '')} title={info.title}>
        <Suspense fallback={<div className="page-state" aria-busy="true">Loading {info.title.toLowerCase()}…</div>}>
          <Screen {...props} />
        </Suspense>
      </ModuleErrorBoundary>
    );
  } else body = <PlaceholderModule key={engine.generation} info={info} props={props} />;

  return (
    <div className="module-page">
      {readOnly && owner && (
        <div className="readonly-banner" role="note">
          <span>
            You are viewing <strong>{owner}</strong>’s work. It is read-only.
          </span>
          <button type="button" className="btn btn-small btn-primary" onClick={() => void forkFlow(services.store, services.own, work, notation)}>
            Fork into my workspace
          </button>
          <Link to={{ name: 'module', module: info.id, problem }} className="btn btn-small">
            Open my own
          </Link>
        </div>
      )}
      <div className="module-bar">
        <div className="module-bar-title">
          <span className="module-glyph" aria-hidden="true">
            {def?.icon ?? info.icon}
          </span>
          <span className="module-bar-name">{info.title}</span>
          {owner && <span className="muted">— {owner}</span>}
        </div>
        <div className="module-bar-actions">
          <span className="module-bar-slot" ref={setBarSlot} />
          {(helpItems.length > 0 || chapters.length > 0) && (
            <Menu
              label="Help"
              buttonClass="btn btn-small btn-quiet"
              align="end"
              items={[...helpItems, ...(chapters.length ? (['separator'] as const) : []), ...chapters.map((c) => ({ label: c.title, href: c.url, external: true }))]}
            />
          )}
          <Menu label={readOnly ? 'Their work' : 'Work file'} buttonClass="btn btn-small btn-quiet" align="end" items={workItems} />
        </div>
      </div>
      {body}
    </div>
  );
}

class ModuleErrorBoundary extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="page-state" role="alert">
          <h2>The {this.props.title.toLowerCase()} screen stopped working.</h2>
          <p className="muted">{this.state.error.message}</p>
          <p>Your saved work is not affected.</p>
          <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

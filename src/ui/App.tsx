// The application shell: top bar (navigation, notation, sync status, account), banners,
// the routed page, and the dialog host.

import { useEffect, type ReactNode } from 'react';
import { openConflicts, openSignIn, signOutFlow } from './app/accountFlows';
import { AppContext, useServices, useWorkspace, type AppServices } from './app/context';
import { NotationSwitch } from './components/NotationSwitch';
import { Menu } from './components/Toolbar';
import { DialogHost } from './dialogs/dialogs';
import { loadEngine, useEngine } from './engine/engine';
import { ComponentsPage } from './pages/ComponentsPage';
import { HelpPage } from './pages/HelpPage';
import { HomePage } from './pages/HomePage';
import { ModulePage } from './pages/ModulePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PeoplePage } from './pages/PeoplePage';
import { PersonPage } from './pages/PersonPage';
import { SettingsPage } from './pages/SettingsPage';
import { usePrefs } from './prefs';
import { Link, navigate, useRoute, type Route } from './router';

export function App({ services }: { services: AppServices }) {
  return (
    <AppContext.Provider value={services}>
      <Shell />
    </AppContext.Provider>
  );
}

function Shell() {
  const route = useRoute();
  const prefs = usePrefs();
  const { store } = useServices();

  useEffect(() => {
    void loadEngine(prefs.notation);
  }, [prefs.notation]);

  // sync when the connection or the tab comes back; save when the page is hidden
  useEffect(() => {
    const online = () => void store.syncNow();
    const visible = () => {
      if (document.visibilityState === 'hidden') void store.flush();
      else void store.syncNow();
    };
    const hide = () => void store.flush();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', hide);
    };
  }, [store]);

  useEffect(() => {
    document.title = pageTitle(route);
  }, [route]);

  const wide = route.name === 'module' || (route.name === 'person' && route.module != null);
  return (
    <div className={'app' + (wide ? ' is-wide' : '')}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <TopBar route={route} />
      <Banners />
      <div className="app-content">{renderRoute(route)}</div>
      <DialogHost />
    </div>
  );
}

function pageTitle(route: Route): string {
  const base = 'Logic 2010';
  switch (route.name) {
    case 'module':
      return `${route.problem ? route.problem + ' – ' : ''}${route.module} – ${base}`;
    case 'people':
      return `People – ${base}`;
    case 'person':
      return `${route.username}'s work – ${base}`;
    case 'settings':
      return `Settings – ${base}`;
    case 'help':
      return `Help – ${base}`;
    default:
      return base;
  }
}

function renderRoute(route: Route): ReactNode {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'module':
      return <ModulePage key={route.module} moduleId={route.module} problem={route.problem} />;
    case 'people':
      return <PeoplePage query={route.query} />;
    case 'person':
      return <PersonPage username={route.username} moduleId={route.module} problem={route.problem} />;
    case 'settings':
      return <SettingsPage />;
    case 'help':
      return <HelpPage />;
    case 'components':
      return <ComponentsPage />;
    case 'not-found':
      return <NotFoundPage />;
  }
}

function Brand() {
  return (
    <Link to={{ name: 'home' }} className="brand" aria-label="Logic 2010, home">
      <span className="brand-mark" aria-hidden="true">
        ∴
      </span>
      <span className="brand-name">Logic 2010</span>
    </Link>
  );
}

function NavLink({ to, children, current }: { to: Route; children: ReactNode; current: boolean }) {
  return (
    <Link to={to} className={'nav-link' + (current ? ' is-current' : '')} aria-current={current ? 'page' : undefined}>
      {children}
    </Link>
  );
}

function TopBar({ route }: { route: Route }) {
  return (
    <header className="topbar">
      <Brand />
      <nav className="topnav" aria-label="Main">
        <NavLink to={{ name: 'home' }} current={route.name === 'home' || route.name === 'module'}>
          Exercises
        </NavLink>
        <NavLink to={{ name: 'people', query: '' }} current={route.name === 'people' || route.name === 'person'}>
          People
        </NavLink>
        <NavLink to={{ name: 'help' }} current={route.name === 'help'}>
          Help
        </NavLink>
      </nav>
      <div className="topbar-end">
        <NotationSwitch />
        <SyncBadge />
        <AccountMenu />
      </div>
    </header>
  );
}

const SYNC_TEXT: Record<string, string> = {
  local: 'Saved in this browser',
  saved: 'Saved',
  pending: 'Saving…',
  syncing: 'Saving…',
  offline: 'Offline, saved here',
  conflict: 'Needs your choice',
  'session-expired': 'Sign in to sync',
  error: 'Not synced',
};

function SyncBadge() {
  const ws = useWorkspace();
  const { store } = useServices();
  if (!ws.ready) return null;
  const s = ws.sync.state;
  const tone = s === 'saved' || s === 'local' ? 'ok' : s === 'pending' || s === 'syncing' ? 'busy' : 'warn';
  const onClick = () => {
    if (s === 'conflict') void openConflicts(store);
    else if (s === 'session-expired') void openSignIn(store);
    else if (s === 'offline' || s === 'error') void store.syncNow();
    else navigate({ name: 'settings', section: 'work' });
  };
  const detail = ws.sync.message ?? (s === 'local' ? 'Your work is saved in this browser. Create an account to keep it on the server.' : SYNC_TEXT[s]);
  return (
    <button type="button" className={'sync-badge tone-' + tone} onClick={onClick} title={detail} aria-live="polite">
      <span className="sync-dot" aria-hidden="true" />
      <span className="sync-text">{SYNC_TEXT[s]}</span>
    </button>
  );
}

function AccountMenu() {
  const ws = useWorkspace();
  const { store } = useServices();
  if (!ws.ready) return null;
  if (ws.account.kind === 'anonymous') {
    return (
      <button type="button" className="btn btn-small account-btn" onClick={() => void openSignIn(store)}>
        Sign in
      </button>
    );
  }
  const name = ws.account.username;
  return (
    <Menu
      label={<span className="account-name">{name}</span>}
      buttonClass="btn btn-small account-btn"
      align="end"
      items={[
        { label: 'Your public page', onSelect: () => navigate({ name: 'person', username: name, module: null, problem: null }) },
        { label: 'Settings and account', onSelect: () => navigate({ name: 'settings', section: 'account' }) },
        'separator',
        { label: 'Sign out', onSelect: () => void signOutFlow(store) },
      ]}
    />
  );
}

function Banners() {
  const ws = useWorkspace();
  const { store } = useServices();
  const engine = useEngine();
  const out: ReactNode[] = [];
  if (ws.ready && ws.storageKind === 'memory') {
    out.push(
      <div key="mem" className="banner tone-warn" role="status">
        This browser does not let the site store data, so your work is lost when you close the tab. Sign in, or export your work before leaving.
      </div>,
    );
  }
  if (ws.sync.state === 'conflict') {
    out.push(
      <div key="conflict" className="banner tone-warn" role="alert">
        Some of your work was changed on another device.
        <button type="button" className="btn btn-small" onClick={() => void openConflicts(store)}>
          Choose what to keep
        </button>
      </div>,
    );
  }
  if (ws.sync.state === 'session-expired') {
    out.push(
      <div key="session" className="banner tone-warn" role="status">
        Your session has ended. Your work is safe in this browser; sign in again to save it to your account.
        <button type="button" className="btn btn-small" onClick={() => void openSignIn(store)}>
          Sign in
        </button>
      </div>,
    );
  }
  if (engine.status === 'error') {
    out.push(
      <div key="engine" className="banner tone-bad" role="alert">
        The course files could not be loaded: {engine.error}
        <button type="button" className="btn btn-small" onClick={() => void loadEngine(engine.notation)}>
          Try again
        </button>
      </div>,
    );
  }
  return out.length ? <div className="banners">{out}</div> : null;
}

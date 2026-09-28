// Client-side routing with the History API under the Vite base ('/logic2010/'). The server
// answers unknown extension-less paths with index.html, so deep links work.
//
// Routes:
//   /                                  home
//   /<module>[?p=<problem>]            a module
//   /people                            everyone's work
//   /people/<user>/work                someone's work, read-only
//   /people/<user>/<module>[?p=<problem>]  a module of someone's work
// Problem names and usernames may contain dots, and the server's SPA fallback only covers
// paths whose last segment has no extension: so the problem goes in the query and the last
// segment is always a module id or "work".
//   /settings                          display, notation, account, your files
//   /help                              help documents
//   /dev/components                    the shared components (for module authors)

import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

export const BASE = (import.meta.env?.BASE_URL ?? '/').replace(/\/*$/, '/');

export type Route =
  | { name: 'home' }
  | { name: 'module'; module: string; problem: string | null }
  | { name: 'people'; query: string }
  | { name: 'person'; username: string; module: string | null; problem: string | null }
  | { name: 'settings'; section: string | null }
  | { name: 'help' }
  | { name: 'components' }
  | { name: 'not-found'; path: string };

const dec = (s: string | undefined) => (s == null || s === '' ? null : decodeURIComponent(s));

export function parseRoute(pathname: string, search = ''): Route {
  let p = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname === BASE.slice(0, -1) ? '' : pathname.replace(/^\//, '');
  p = p.replace(/\/+$/, '');
  const parts = p === '' ? [] : p.split('/');
  const params = new URLSearchParams(search);
  if (parts.length === 0) return { name: 'home' };
  const [first, ...rest] = parts;
  switch (first) {
    case 'people': {
      if (rest.length === 0) return { name: 'people', query: params.get('q') ?? '' };
      const mod = rest[1] == null || rest[1] === 'work' ? null : dec(rest[1]);
      return { name: 'person', username: dec(rest[0])!, module: mod, problem: mod ? params.get('p') : null };
    }
    case 'settings':
      return { name: 'settings', section: dec(rest[0]) };
    case 'help':
      return { name: 'help' };
    case 'dev':
      if (rest[0] === 'components') return { name: 'components' };
      return { name: 'not-found', path: p };
    default:
      if (/^[a-z-]+$/.test(first) && rest.length === 0) return { name: 'module', module: first, problem: params.get('p') };
      return { name: 'not-found', path: p };
  }
}

const enc = (s: string) => encodeURIComponent(s);

/** The URL of a route. */
export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return BASE;
    case 'module':
      return BASE + route.module + (route.problem ? '?p=' + enc(route.problem) : '');
    case 'people':
      return BASE + 'people' + (route.query ? '?q=' + encodeURIComponent(route.query) : '');
    case 'person':
      return BASE + 'people/' + enc(route.username) + '/' + (route.module ? route.module + (route.problem ? '?p=' + enc(route.problem) : '') : 'work');
    case 'settings':
      return BASE + 'settings' + (route.section ? '/' + route.section : '');
    case 'help':
      return BASE + 'help';
    case 'components':
      return BASE + 'dev/components';
    case 'not-found':
      return BASE + route.path;
  }
}

// ---- the current location as an external store ----

const listeners = new Set<() => void>();
let current = typeof location === 'undefined' ? '/' : location.pathname + location.search;

function notify(): void {
  current = location.pathname + location.search;
  for (const l of [...listeners]) l();
}

if (typeof window !== 'undefined') window.addEventListener('popstate', notify);

/** Guards that can stop navigation (e.g. unsaved input). Return false to stay. */
const guards = new Set<() => boolean>();

export function addNavigationGuard(guard: () => boolean): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

export function navigate(to: string | Route, opts: { replace?: boolean } = {}): void {
  const url = typeof to === 'string' ? to : href(to);
  if (url === location.pathname + location.search) return;
  for (const g of guards) if (!g()) return;
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  notify();
  if (!opts.replace) window.scrollTo(0, 0);
}

function getLocation(): string {
  return current;
}

export function useLocation(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getLocation,
    getLocation,
  );
}

export function useRoute(): Route {
  const loc = useLocation();
  const q = loc.indexOf('?');
  return parseRoute(q === -1 ? loc : loc.slice(0, q), q === -1 ? '' : loc.slice(q));
}

/** An <a> that navigates in-app (plain clicks only; modified clicks open tabs as usual). */
export function Link({ to, replace, onClick, ...rest }: { to: string | Route; replace?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const url = typeof to === 'string' ? to : href(to);
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(url, { replace });
  };
  return <a href={url} onClick={handle} {...rest} />;
}

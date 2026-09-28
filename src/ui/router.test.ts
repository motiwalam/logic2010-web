import { describe, expect, it } from 'vitest';
import { BASE, href, parseRoute, type Route } from './router';

describe('router', () => {
  const routes: Route[] = [
    { name: 'home' },
    { name: 'module', module: 'derivation', problem: null },
    { name: 'module', module: 'derivation', problem: 'Deriv 1.001' },
    { name: 'people', query: '' },
    { name: 'person', username: 'alice', module: null, problem: null },
    { name: 'person', username: 'al.ice', module: 'truth-tables', problem: 'Tru 2/3' },
    { name: 'settings', section: 'account' },
    { name: 'help' },
    { name: 'components' },
  ];
  it.each(routes)('round-trips %o', (route) => {
    const url = new URL(href(route), 'http://x');
    expect(parseRoute(url.pathname, url.search)).toEqual(route);
  });

  it('parses the base without a slash and searches', () => {
    expect(parseRoute(BASE.slice(0, -1) || '/')).toEqual({ name: 'home' });
    expect(parseRoute(BASE + 'people', '?q=bo')).toEqual({ name: 'people', query: 'bo' });
    expect(parseRoute(BASE + 'Bad_Path')).toEqual({ name: 'not-found', path: 'Bad_Path' });
  });
});

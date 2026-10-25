import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { checkPrimarySource } from '../src/thesis/source-fetch';

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(`<html><body>${body}</body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  });
const fetcher = (handler: (url: string) => Response | Promise<Response>) =>
  (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;

describe('checkPrimarySource', () => {
  it('reads a sec.gov page and verifies the figure', async () => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    const result = await checkPrimarySource(
      'sec_filing',
      'https://www.sec.gov/a.htm',
      '$416,161 million',
      'net sales',
      fetcher(() => html('Total net sales were $416,161 million.')),
    );
    expect(result.status).toBe('verified');
  });

  it('says not_found when the page is read but the figure is not on it', async () => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    const result = await checkPrimarySource(
      'sec_filing',
      'https://www.sec.gov/a.htm',
      '$900 million',
      'net sales',
      fetcher(() => html('Total net sales were $416,161 million.')),
    );
    expect(result.status).toBe('not_found');
  });

  it('does not follow a redirect off the primary host', async () => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    const seen: string[] = [];
    const result = await checkPrimarySource(
      'sec_filing',
      'https://www.sec.gov/a.htm',
      '1',
      'x',
      fetcher((url) => {
        seen.push(url);
        return new Response(null, { status: 302, headers: { location: 'https://evil.example.com/x' } });
      }),
    );
    expect(result.status).toBe('unreadable');
    expect(seen).toEqual(['https://www.sec.gov/a.htm']);
  });

  it('follows a redirect that stays on the primary host', async () => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    const result = await checkPrimarySource(
      'sec_filing',
      'https://www.sec.gov/a.htm',
      '$416,161 million',
      'net sales',
      fetcher((url) =>
        url.endsWith('/a.htm')
          ? new Response(null, { status: 301, headers: { location: '/b.htm' } })
          : html('Total net sales were $416,161 million.'),
      ),
    );
    expect(result.status).toBe('verified');
    expect(result.status === 'verified' && result.finalUrl).toBe('https://www.sec.gov/b.htm');
  });

  it('reports a PDF, an error status and a missing sec.gov User-Agent as unreadable', async () => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    const pdf = await checkPrimarySource(
      'central_bank',
      'https://www.federalreserve.gov/x.pdf',
      '4.25',
      'rate',
      fetcher(() => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } })),
    );
    expect(pdf.status).toBe('unreadable');
    const missing = await checkPrimarySource(
      'central_bank',
      'https://www.federalreserve.gov/x',
      '4.25',
      'rate',
      fetcher(() => new Response('no', { status: 404 })),
    );
    expect(missing.status).toBe('unreadable');
    delete process.env.SOURCE_FETCH_USER_AGENT;
    const noAgent = await checkPrimarySource(
      'sec_filing',
      'https://www.sec.gov/a.htm',
      '1',
      'x',
      fetcher(() => html('1')),
    );
    expect(noAgent.status).toBe('unreadable');
  });

  it('refuses a plain http link and a host outside the allowed list', async () => {
    process.env.SOURCE_FETCH_USER_AGENT = 'Tester test@example.com';
    const insecure = await checkPrimarySource('sec_filing', 'http://www.sec.gov/a', '1', 'x', fetcher(() => html('1')));
    expect(insecure.status).toBe('unreadable');
    const other = await checkPrimarySource('central_bank', 'https://www.sec.gov/a', '1', 'x', fetcher(() => html('1')));
    expect(other.status).toBe('unreadable');
  });
});

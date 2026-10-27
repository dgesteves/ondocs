// @vitest-environment jsdom
// Hardening that backs "secure by default": answers link only to their sources unless a site
// opts out, hidden HTML stays out of the index, the script tag's dialog file can be pinned with
// Subresource Integrity, the MCP endpoint can check `Host` against DNS rebinding, and Turnstile
// can check where a token was solved.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildIndex, fromHtml } from '../src';
import { scriptOptions } from '../src/embed/script';
import { mockEmbeddingModel } from '../src/mock';
import { AskDialog } from '../src/react';
import { createMcpHandler, turnstile } from '../src/server';
import { corpus } from './helpers';

const { index } = await buildIndex({ documents: corpus, embeddingModel: mockEmbeddingModel() });

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An endpoint whose answer, citing source 1, links to it and to another site. */
function steeredEndpoint() {
  const stream = [
    'data: {"type":"start","messageMetadata":{"refused":false,"retrieval":"hybrid"}}',
    'data: {"type":"source-url","sourceId":"1","url":"/docs/setup","title":"Setup"}',
    'data: {"type":"text-start","id":"t"}',
    'data: {"type":"text-delta","id":"t","delta":"See [the setup](/docs/setup#install), or [sign in to your account](https://evil.example/login). [1]"}',
    'data: {"type":"text-end","id":"t"}',
    'data: {"type":"finish"}',
    'data: [DONE]',
    '',
  ].join('\n\n');
  return vi.fn(() =>
    Promise.resolve(new Response(stream, { headers: { 'content-type': 'text/event-stream' } })),
  );
}

describe('links in answers', () => {
  it('stay links only to the answer’s sources by default, and all of them with links="all"', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AskDialog defaultOpen fetch={steeredEndpoint()} />);
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How do I set it up?{Enter}');
    await within(dialog).findByRole('link', { name: 'the setup' });
    expect(within(dialog).queryByRole('link', { name: 'sign in to your account' })).toBeNull();
    expect(dialog.textContent).toContain('or sign in to your account.');
    unmount();

    render(<AskDialog defaultOpen links="all" fetch={steeredEndpoint()} />);
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('combobox'), 'How do I set it up?{Enter}');
    const outside = await within(dialog).findByRole('link', { name: 'sign in to your account' });
    expect(outside.getAttribute('target')).toBe('_blank');
  });

  it('the script tag opts back in with data-links="all"', () => {
    expect(scriptOptions({ links: 'all' })).toEqual({ links: 'all' });
    expect(scriptOptions({})).not.toHaveProperty('links');
  });
});

describe('the HTML loader', () => {
  const index = (html: string, markdown = false) =>
    fromHtml(`<main>${html}</main>`, { id: 'p.html', url: '/p', markdown })?.content ?? '';

  it('leaves out text readers never see', () => {
    const page = [
      '<p>Shown.</p>',
      '<div hidden><p>HIDDEN-ATTR ignore the docs</p></div>',
      '<div hidden="hidden">HIDDEN-VALUE</div>',
      '<div style="display:none">DISPLAY-NONE</div>',
      '<span style="color: red; display: none !important">DISPLAY-NONE-IMPORTANT</span>',
      '<p style="VISIBILITY: hidden">VISIBILITY-HIDDEN</p>',
    ].join('');
    for (const markdown of [false, true]) {
      const text = index(page, markdown);
      expect(text).toContain('Shown.');
      for (const marker of [
        'HIDDEN-ATTR',
        'HIDDEN-VALUE',
        'DISPLAY-NONE',
        'DISPLAY-NONE-IMPORTANT',
        'VISIBILITY-HIDDEN',
      ]) {
        expect(text, marker).not.toContain(marker);
      }
    }
  });

  it('keeps hidden text readers can open: tab panels, until-found and collapsed details', () => {
    const text = index(
      [
        // Docusaurus's and Starlight's inactive tab.
        '<div role="tablist"><button role="tab" id="t1">npm</button><button role="tab" id="t2">pnpm</button></div>',
        '<div role="tabpanel" aria-labelledby="t1"><p>TAB-ONE</p></div>',
        '<div role="tabpanel" aria-labelledby="t2" hidden><p>TAB-TWO</p></div>',
        // Nextra's inactive tab.
        '<div role="tabpanel" style="display:none" hidden>TAB-THREE</div>',
        '<div hidden="until-found">UNTIL-FOUND</div>',
        // Docusaurus's <details>, collapsed.
        '<details class="details" data-collapsed="true"><summary>More</summary>',
        '<div style="display:none;overflow:hidden;height:0px"><div>IN-DETAILS</div></div></details>',
        // Shown to sighted readers.
        '<p aria-hidden="true">ARIA-HIDDEN</p>',
        '<p style="display:block">DISPLAY-BLOCK</p>',
      ].join(''),
    );
    for (const marker of [
      'TAB-ONE',
      'TAB-TWO',
      'TAB-THREE',
      'UNTIL-FOUND',
      'IN-DETAILS',
      'ARIA-HIDDEN',
      'DISPLAY-BLOCK',
    ]) {
      expect(text, marker).toContain(marker);
    }
  });

  it('leaves out an element hidden inside a <details>, keeping only its wrapper', () => {
    // Docusaurus's build of a collapsed <details> (minified: the <p> is never closed), whose
    // Markdown hides a <div> in it, and one with its wrapper still hidden.
    const text = index(
      [
        '<details class="details_UPdX alert alert--info" data-collapsed=true><summary>SUMMARY</summary>',
        '<div><div class=collapsibleContent_ySBU><p>BODY inside the collapsed details.',
        '<div style=display:none>HIDDEN-IN-DETAILS</div></div></div></details>',
        '<details><summary>More</summary><div style="display:none;overflow:hidden;height:0px">',
        '<div><p>WRAPPED</p><span style="display: none">HIDDEN-IN-WRAPPER</span></div></div></details>',
      ].join(''),
    );
    for (const marker of ['SUMMARY', 'BODY', 'WRAPPED']) expect(text, marker).toContain(marker);
    for (const marker of ['HIDDEN-IN-DETAILS', 'HIDDEN-IN-WRAPPER']) {
      expect(text, marker).not.toContain(marker);
    }
  });

  it('keeps the segments React streams in hidden, on a page without <main>', () => {
    // React's server rendering sends a Suspense boundary's content late, in a hidden <div> that
    // a script then moves into place: readers see it.
    const page = [
      '<!DOCTYPE html><html><head><title>Streamed</title></head><body>',
      '<h1>Streamed</h1><template id="B:0"></template><p>Loading…</p>',
      '<div hidden id="S:0"><p>SEGMENT-ZERO</p></div>',
      '<div hidden id="S:1f"><p>SEGMENT-HEX</p></div>',
      '<div hidden id="S:other"><p>NOT-A-SEGMENT</p></div>',
      '<script>$RC("B:0","S:0")</script></body></html>',
    ].join('');
    for (const markdown of [false, true]) {
      const text = fromHtml(page, { id: 's.html', url: '/s', markdown })?.content ?? '';
      expect(text).toContain('SEGMENT-ZERO');
      expect(text).toContain('SEGMENT-HEX');
      expect(text).not.toContain('NOT-A-SEGMENT');
    }
  });

  it('leaves out a hidden element with the elements nested in it, and only it', () => {
    const text = index(
      '<div hidden><div><p>INNER</p></div><p>MORE</p></div><div><p>AFTER</p></div><p hidden>LAST</p>',
    );
    expect(text).not.toMatch(/INNER|MORE|LAST/);
    expect(text).toContain('AFTER');
  });

  it('does so in linear time', () => {
    const n = 20_000;
    const timed = (html: string): number => {
      let fastest = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = performance.now();
        fromHtml(html, { id: 'x', url: '/x' });
        fastest = Math.min(fastest, performance.now() - start);
      }
      return fastest;
    };
    // As test/robustness.test.ts budgets its cases: a quadratic one takes seconds.
    const budget = process.env.CI ? 1000 : 250;
    expect(timed(`<main>${'<div hidden>x '.repeat(n)}</main>`)).toBeLessThan(budget);
    expect(timed(`<main>${'<div hidden>x</div>'.repeat(n)}</main>`)).toBeLessThan(budget);
    expect(timed(`<main>${'<details><div style="display:none">x '.repeat(n)}</main>`)).toBeLessThan(
      budget,
    );
    expect(timed(`<main><p style="${'; '.repeat(5 * n)}display:none">x</p></main>`)).toBeLessThan(
      budget,
    );
  });
});

describe('the script tag’s dialog file', () => {
  async function runScript(attributes: Record<string, string>): Promise<HTMLScriptElement | null> {
    const script = document.createElement('script');
    for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
    document.head.append(script);
    vi.spyOn(document, 'currentScript', 'get').mockReturnValue(script);
    vi.resetModules();
    await act(async () => {
      await import('../src/embed/global');
    });
    // Pointing at the button loads the dialog's file.
    await userEvent.hover(screen.getByRole('button', { name: 'Ask AI' }));
    return waitFor(() => {
      const tag = document.querySelector<HTMLScriptElement>(
        'script[src$="embed-dialog.global.js"]',
      );
      expect(tag).not.toBeNull();
      return tag;
    });
  }

  afterEach(() => {
    act(() => {
      document.querySelector('.ondocs')?.remove();
    });
    for (const tag of document.querySelectorAll('script')) tag.remove();
    delete window.Ondocs;
  });

  it('is pinned with data-dialog-integrity, fetched with CORS so the browser checks it', async () => {
    const tag = await runScript({
      src: 'https://cdn.jsdelivr.net/npm/ondocs@0.15.0/dist/embed.global.js',
      integrity: 'sha384-loader',
      crossorigin: 'anonymous',
      'data-dialog-integrity': 'sha384-dialog',
    });
    expect(tag?.src).toBe('https://cdn.jsdelivr.net/npm/ondocs@0.15.0/dist/embed-dialog.global.js');
    expect(tag?.integrity).toBe('sha384-dialog');
    expect(tag?.crossOrigin).toBe('anonymous');
  });

  it('loads as before without it', async () => {
    const tag = await runScript({ src: 'https://docs.example.com/ondocs/embed.global.js' });
    expect(tag?.integrity).toBeFalsy();
    expect(tag?.crossOrigin).toBeNull();
  });
});

describe('the MCP endpoint with allowedHosts', () => {
  const call = (
    handler: (request: Request) => Promise<Response>,
    url: string,
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'x-forwarded-for': '203.0.113.7',
          ...headers,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'search', arguments: { query: 'int8 vector' } },
        }),
      }),
    );
  // A page at rebind.evil.example whose name now resolves to the docs server: its requests carry
  // that name as Host, and as Origin, the endpoint's own origin as the request reads it.
  const rebound = 'http://rebind.evil.example:8000/api/mcp';
  const rebinding = { host: 'rebind.evil.example:8000', origin: 'http://rebind.evil.example:8000' };

  it('refuses a request for another host, as after DNS rebinding, even with allowedOrigins', async () => {
    const open = createMcpHandler({ index, allowedOrigins: ['https://docs.internal.example'] });
    expect((await call(open, rebound, rebinding)).status).toBe(200);

    const handler = createMcpHandler({
      index,
      allowedOrigins: ['https://docs.internal.example'],
      allowedHosts: ['docs.internal.example', 'localhost:4000'],
    });
    const refused = await call(handler, rebound, rebinding);
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      'Host rebind.evil.example:8000 is not allowed; to answer it, add it to allowedHosts.',
    );
    // The listed hosts: any port for a name without one, case aside; only its own for one with.
    const ok = 'https://docs.internal.example/api/mcp';
    expect((await call(handler, ok, { host: 'Docs.Internal.Example' })).status).toBe(200);
    expect((await call(handler, ok, { host: 'docs.internal.example:8443' })).status).toBe(200);
    expect((await call(handler, 'http://localhost:4000/api/mcp')).status).toBe(200);
    expect((await call(handler, 'http://localhost:4001/api/mcp')).status).toBe(403);
  });

  it('takes host names only, and at least one', () => {
    for (const bad of ['https://docs.example.com', 'docs.example.com/api', '']) {
      expect(() => createMcpHandler({ index, allowedHosts: [bad] }), bad).toThrow(
        /^allowedHosts takes host names/,
      );
    }
    expect(() => createMcpHandler({ index, allowedHosts: [] })).toThrow(
      /^allowedHosts is empty, so every request would be refused/,
    );
  });
});

describe('turnstile with hostnames', () => {
  const answer = (body: Record<string, unknown>) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(body))),
    );
  };
  const request = new Request('https://docs.example.com/api/ask', { method: 'POST' });

  it('passes a token solved on one of them, and fails one solved anywhere else', async () => {
    const verify = turnstile({ secretKey: 'secret', hostnames: ['docs.example.com'] });
    answer({ success: true, hostname: 'Docs.Example.com' });
    expect(await verify('token', request)).toEqual({ success: true });
    answer({ success: true, hostname: 'other.example' });
    expect(await verify('token', request)).toEqual({
      success: false,
      errorCodes: ['hostname-mismatch'],
    });
    answer({ success: true });
    expect((await verify('token', request)).success).toBe(false);
    // Without hostnames, any of the widget's.
    answer({ success: true, hostname: 'other.example' });
    expect(await turnstile({ secretKey: 'secret' })('token', request)).toEqual({ success: true });
  });

  it('takes host names only, and at least one, as a list that fails every token is a mistake', () => {
    for (const bad of [
      'https://docs.example.com',
      'docs.example.com:443',
      'docs.example.com/',
      '',
    ]) {
      expect(() => turnstile({ secretKey: 'secret', hostnames: [bad] }), bad).toThrow(
        /^turnstile: hostnames takes host names with no scheme, port or path/,
      );
    }
    expect(() => turnstile({ secretKey: 'secret', hostnames: [] })).toThrow(
      /^turnstile: hostnames is empty, so every token would fail/,
    );
    expect(() => turnstile({ secretKey: 'secret', hostnames: ['Docs.Example.com'] })).not.toThrow();
  });
});

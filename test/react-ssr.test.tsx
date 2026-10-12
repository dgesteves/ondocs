import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import AskMySite from '../src/docusaurus/theme/AskMySite';
import { AskDialog } from '../src/react';

describe('AskDialog on the server', () => {
  it('renders its launcher without reaching for the browser', () => {
    const html = renderToString(<AskDialog launcher="Ask the docs" />);
    expect(html).toContain('class="ondocs-launcher"');
    expect(html).toContain('Ask the docs');
    // The platform is only known in the browser, which corrects it after hydration.
    expect(html).toContain('Ctrl <!-- -->I');
  });
});

/* eslint-disable @typescript-eslint/no-deprecated -- the names from before ondocs, on purpose */
describe('@theme/AskMySite, the name before ondocs, as a Docusaurus site builds', () => {
  it('says once, in the build’s output, to import @theme/Ondocs', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      renderToString(
        <>
          <AskMySite />
          <AskMySite />
        </>,
      );
      renderToString(<AskMySite />);
      expect(warn.mock.calls).toEqual([
        [
          '[ondocs] @theme/AskMySite is now @theme/Ondocs. Import it from there; the old name still works for now.',
        ],
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
/* eslint-enable @typescript-eslint/no-deprecated */

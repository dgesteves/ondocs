import { GITHUB_URL, HOME_DESCRIPTION, NPM_URL, SITE_URL, VERSION } from './site';

/** The project as schema.org's SoftwareSourceCode, for the home page's JSON-LD. */
export function softwareSourceCode() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'ondocs',
    description: HOME_DESCRIPTION,
    url: SITE_URL,
    codeRepository: GITHUB_URL,
    sameAs: [NPM_URL],
    programmingLanguage: 'TypeScript',
    runtimePlatform: 'Node.js',
    license: 'https://opensource.org/licenses/MIT',
    version: VERSION,
    author: { '@type': 'Person', name: 'Diogo Esteves', url: 'https://github.com/dgesteves' },
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` escaped, so no string can end the tag. */
export const jsonLd = (data: unknown): string => JSON.stringify(data).replace(/</g, '\\u003c');

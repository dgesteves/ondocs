// Nextra 4.6.1's docs-theme example (examples/docs at the nextra@4.6.1 tag), with a page for each
// rule that moves one. test/next-sites.test.ts checks ondocs gives each page the URL `next build`
// gave it, in src/content (served under /docs) and in src/app.
import nextra from 'nextra';

const withNextra = nextra({
  latex: true,
  search: {
    codeblocks: false,
  },
  contentDirBasePath: '/docs',
});

export default withNextra({
  reactStrictMode: true,
});

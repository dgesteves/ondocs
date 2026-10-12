// A site made with create-fumadocs-app 16.2.18 (+next+fuma-docs-mdx), with a page for each rule
// that moves one. test/next-sites.test.ts checks ondocs gives each page the URL `next build` gave it.
import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
};

export default withMDX(config);

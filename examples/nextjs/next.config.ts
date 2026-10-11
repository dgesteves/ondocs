import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The site's CSS is a few KB; inlined, it no longer holds up the first paint with a request.
  experimental: { inlineCss: true },
  // The same headers as the sibling sites: no MIME sniffing, no framing, and only the origin in
  // the referrer sent to other sites.
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]);
  },
};

export default config;

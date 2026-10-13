// The live demos (examples/docusaurus, starlight and vitepress, each on Vercel) show these docs on
// another origin and send their questions here, with no model key of their own. Their origins,
// and only theirs, get CORS headers; the rate limit and the daily budget are this endpoint's, as
// for the site's own dialog. Any other origin gets no CORS headers, so a browser on it cannot read
// an answer or get past the preflight, which application/json forces.
export const DEMO_ORIGINS: ReadonlySet<string> = new Set([
  'https://ondocs-docusaurus.vercel.app',
  'https://ondocs-starlight.vercel.app',
  'https://ondocs-vitepress.vercel.app',
]);

/** `handler`, with CORS headers on its responses for a request from one of `DEMO_ORIGINS`. */
export function withDemoCors(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const response = await handler(request);
    const headers = new Headers(response.headers);
    // The answer depends on the Origin header, so no cache may serve one origin's to another.
    headers.append('vary', 'origin');
    const origin = request.headers.get('origin');
    if (origin !== null && DEMO_ORIGINS.has(origin)) {
      headers.set('access-control-allow-origin', origin);
      // The dialog reads Retry-After on a 429.
      headers.set('access-control-expose-headers', 'retry-after');
      if (request.method === 'OPTIONS') {
        headers.set('access-control-allow-methods', 'POST, OPTIONS');
        headers.set('access-control-allow-headers', 'content-type');
        headers.set('access-control-max-age', '86400');
      }
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

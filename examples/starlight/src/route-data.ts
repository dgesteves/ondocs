import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

import { sourceUrls } from '../source-urls.mjs';

/** The website's URL of each page here, without a trailing slash. */
const website = new Map(
  Object.entries(sourceUrls.pages).map(([there, here]) => [
    here.replace(/(.)\/+$/, '$1'),
    `${sourceUrls.base}${there}`,
  ]),
);

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  // A banner on every page, which Starlight's search, and so the index, leaves out. Its button
  // opens the dialog through its data-ondocs-open attribute.
  route.entry.data.banner = {
    content:
      'Live demo of ondocs on Starlight. <button type="button" class="demo-try" data-ondocs-open>✦ Try it: ask these docs a question</button> <span class="demo-links"><a href="https://ondocs.vercel.app">ondocs.vercel.app</a> · <a href="https://github.com/dgesteves/ondocs">GitHub</a></span>',
  };
  // The page's canonical link goes to the website, whose docs these pages are generated from.
  // Pages the website does not have keep their own.
  const canonical = website.get(context.url.pathname.replace(/(.)\/+$/, '$1'));
  const link = route.head.find((tag) => tag.tag === 'link' && tag.attrs?.rel === 'canonical');
  if (canonical && link?.attrs) link.attrs.href = canonical;
});

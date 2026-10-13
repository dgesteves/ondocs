import type { MetadataRoute } from 'next';

import { HOME_DESCRIPTION } from '../lib/site';

/** The web app manifest: the name and icons a browser shows when the site is installed or pinned. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ondocs',
    short_name: 'ondocs',
    description: HOME_DESCRIPTION,
    start_url: '/',
    display: 'browser',
    background_color: '#0d0f12',
    theme_color: '#0d0f12',
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/apple-icon', type: 'image/png', sizes: '180x180' },
    ],
  };
}

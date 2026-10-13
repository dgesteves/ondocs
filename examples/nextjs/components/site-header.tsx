import Link from 'next/link';

import { INTEGRATIONS_SECTION, getSections } from '../lib/docs';
import { githubStars, starLabel } from '../lib/github';
import { GITHUB_URL, NPM_URL, VERSION } from '../lib/site';
import { AskButton } from './ask';
import { GitHubIcon, Spark, StarIcon } from './icons';
import { NavLinks, SiteMenu, type NavItem } from './site-nav';
import { ThemeSwitch } from './theme-switch';

/**
 * The header the three sibling sites share: the name and version on the left; on the right the
 * site's pages, Ask, the theme and GitHub. On a phone the pages, the theme and GitHub move into
 * a menu.
 */
export async function SiteHeader() {
  const [sections, stars] = await Promise.all([getSections(), githubStars()]);
  const integrations = (
    sections.find((section) => section.title === INTEGRATIONS_SECTION)?.docs ?? []
  ).map((doc) => `/docs/${doc.slug}`);
  const items: NavItem[] = [
    { href: '/docs', label: 'Docs', except: integrations },
    { href: '/docs#integrations', label: 'Integrations', paths: integrations },
  ];
  const label = starLabel(stars);
  const github = label ? `ondocs on GitHub, ${String(stars)} stars` : 'ondocs on GitHub';
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Spark size={16} />
          </span>
          ondocs
        </Link>
        <span className="version-pill">v{VERSION}</span>
        <nav aria-label="Site" className="header-nav">
          <NavLinks items={items} className="header-link" />
        </nav>
        <div className="header-actions">
          <AskButton className="header-ask" label="Ask the docs">
            Ask
          </AskButton>
          <ThemeSwitch className="header-theme" />
          <a className="header-icon header-github" href={GITHUB_URL} aria-label={github}>
            <GitHubIcon />
            {label ? (
              <span className="header-stars" aria-hidden="true">
                <StarIcon size={12} />
                {label}
              </span>
            ) : null}
          </a>
          <SiteMenu items={items}>
            <div className="site-menu-links site-menu-external">
              <a className="site-menu-link" href={GITHUB_URL}>
                GitHub
                {label ? <span className="site-menu-note">{label} stars</span> : null}
              </a>
              <a className="site-menu-link" href={NPM_URL}>
                npm
              </a>
            </div>
            <div className="site-menu-theme">
              <span>Theme</span>
              <ThemeSwitch />
            </div>
          </SiteMenu>
        </div>
      </div>
    </header>
  );
}

import Link from 'next/link';

import { GITHUB_URL, NPM_URL } from '../lib/site';
import { VERSION } from '../lib/version';
import { Spark } from './icons';

const MORE = [
  {
    name: 'onsystem',
    href: 'https://onsystem.vercel.app',
    description: 'Keeps coding agents on your design system.',
  },
  {
    name: 'signoff-ui',
    href: 'https://signoff-ui.vercel.app',
    description: 'Review what your agent changed and approve what it may do.',
  },
];

/** The footer the three sibling sites share: Project, For agents, and More by Diogo Esteves. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-about">
          <p className="footer-brand">
            <span className="brand-mark">
              <Spark size={14} />
            </span>
            ondocs
          </p>
          <p>
            Docs answerable by people and by agents, from one static index. MIT licensed, built by{' '}
            <a href="https://github.com/dgesteves">Diogo Esteves</a>.
          </p>
        </div>
        <nav aria-label="Project" className="footer-column">
          <h2 className="footer-heading">Project</h2>
          <ul>
            <li>
              <Link href="/docs">Docs</Link>
            </li>
            <li>
              <a href={`${GITHUB_URL}/blob/main/CHANGELOG.md`}>Changelog</a>
            </li>
            <li>
              <a href={`${GITHUB_URL}/issues`}>Issues</a>
            </li>
            <li>
              <a href={NPM_URL}>npm</a>
            </li>
            <li>
              <a href={`${GITHUB_URL}/releases`} className="footer-version">
                v{VERSION}
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="For agents" className="footer-column">
          <h2 className="footer-heading">For agents</h2>
          <ul>
            <li>
              <a href="/llms.txt">llms.txt</a>
            </li>
            <li>
              <a href="/llms-full.txt">llms-full.txt</a>
            </li>
            <li>
              <Link href="/docs/mcp">MCP server</Link>
            </li>
          </ul>
        </nav>
        <nav aria-label="More by Diogo Esteves" className="footer-column footer-more">
          <h2 className="footer-heading">More by Diogo Esteves</h2>
          <ul>
            {MORE.map((project) => (
              <li key={project.name}>
                <a href={project.href}>{project.name}</a>
                <span>{project.description}</span>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

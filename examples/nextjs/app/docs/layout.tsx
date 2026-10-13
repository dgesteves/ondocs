import type { ReactNode } from 'react';

import { DocsEnhancements } from '../../components/docs-enhancements';
import { Sidebar } from '../../components/docs-nav';
import { getNavSections } from '../../lib/docs';

import './docs.css';

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const sections = await getNavSections();
  return (
    <div className="shell">
      <Sidebar sections={sections} />
      <main id="content" className="content">
        {children}
      </main>
      <DocsEnhancements />
    </div>
  );
}

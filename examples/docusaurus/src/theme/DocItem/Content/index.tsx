// The doc's content, with the question box above it on the first page: outside the Markdown
// container, so the index and the page's Markdown copy leave it out, and the generated docs stay
// as scripts/sync-example-docs.mjs writes them. The box's code is a chunk of its own, which only
// the first page loads; the server renders it into the page's HTML, and it works before then, as
// the ondocs plugin listens for its data-ondocs-open attributes.
import { useLocation } from '@docusaurus/router';
import type { WrapperProps } from '@docusaurus/types';
import Content from '@theme-original/DocItem/Content';
import type ContentType from '@theme/DocItem/Content';
import { lazy, Suspense, type ReactNode } from 'react';

const AskBox = lazy(() => import('../../../components/AskBox'));

export default function ContentWithAskBox(props: WrapperProps<typeof ContentType>): ReactNode {
  const first = useLocation().pathname === '/';
  return (
    <>
      {first ? (
        <Suspense fallback={null}>
          <AskBox />
        </Suspense>
      ) : null}
      <Content {...props} />
    </>
  );
}

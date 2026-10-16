import type { AskSource } from 'ondocs/react';
import type { MouseEvent } from 'react';

interface DemoSourcesProps {
  sources: readonly AskSource[];
  /** The ids the answer cites so far. */
  cited: ReadonlySet<number>;
  /** Whether the answer is complete, so a source it doesn't cite never will be. */
  complete: boolean;
  onNavigate: (url: string, event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * The demo's sources: those the answer cites, numbered as it cites them, and the others folded
 * into one line that opens to list them, dimmed once the answer is complete.
 */
export function DemoSources({ sources, cited, complete, onNavigate }: DemoSourcesProps) {
  const shown = sources.filter((source) => cited.has(source.id));
  const others = sources.filter((source) => !cited.has(source.id));
  const more = `${String(others.length)}${shown.length > 0 ? ' more' : ''} ${
    others.length === 1 ? 'source' : 'sources'
  }${complete ? ', not cited' : ''}`;
  const item = (source: AskSource) => (
    <li key={source.id}>
      <a
        href={source.url}
        data-cited={cited.has(source.id) ? true : complete ? false : undefined}
        onClick={(event) => {
          onNavigate(source.url, event);
        }}
      >
        <span className="demo-source-id" aria-hidden="true">
          {source.id}
        </span>
        <span className="demo-source-title">
          {source.title}
          {source.heading ? <span> › {source.heading}</span> : null}
        </span>
        <span className="demo-source-url">{source.url}</span>
      </a>
    </li>
  );
  return (
    <div className="demo-sources">
      <p className="demo-label">Sources</p>
      {shown.length > 0 ? <ol>{shown.map(item)}</ol> : null}
      {others.length > 0 ? (
        <details className="demo-more">
          <summary>{more}</summary>
          <ol>{others.map(item)}</ol>
        </details>
      ) : null}
    </div>
  );
}

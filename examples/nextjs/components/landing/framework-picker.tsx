'use client';

import Link from 'next/link';
import { useId, useRef, useState, type KeyboardEvent } from 'react';

import { ArrowRight } from '../icons';

export interface Framework {
  id: string;
  label: string;
  /** The config line, with its import, as a highlighted code block built on the server. */
  code: string;
  guide: { href: string; label: string };
  /** The framework's live demo: an example site, deployed. */
  demo?: { href: string; label: string };
  /** A line in place of a demo link. */
  note?: string;
}

/**
 * The first screen's framework picker: "Add it to" a tab per framework, each with the line that
 * adds ondocs and a link to its live demo. Tabs per the WAI-ARIA pattern, as the setup tabs: arrow
 * keys, Home and End move between them. Every panel is in the server's HTML, the first one shown.
 */
export function FrameworkPicker({ frameworks }: { frameworks: Framework[] }) {
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const select = (index: number) => {
    const next = (index + frameworks.length) % frameworks.length;
    setSelected(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Partial<Record<string, number>> = {
      ArrowRight: selected + 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: frameworks.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div className="picker">
      <div className="picker-head">
        <p id={`${base}-label`} className="picker-label">
          Add it to
        </p>
        <div
          role="tablist"
          aria-labelledby={`${base}-label`}
          className="picker-tabs"
          onKeyDown={onKeyDown}
        >
          {frameworks.map((framework, i) => (
            <button
              key={framework.id}
              ref={(element) => {
                refs.current[i] = element;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${framework.id}`}
              aria-selected={i === selected}
              aria-controls={`${base}-panel-${framework.id}`}
              tabIndex={i === selected ? 0 : -1}
              className="picker-tab"
              onClick={() => {
                setSelected(i);
              }}
            >
              {framework.label}
            </button>
          ))}
        </div>
      </div>
      {/* The panels share one cell, so the picker is as tall as the tallest at any width, and
          nothing under it moves when the tab changes. */}
      <div className="picker-panels">
        {frameworks.map((framework, i) => (
          <div
            key={framework.id}
            role="tabpanel"
            id={`${base}-panel-${framework.id}`}
            aria-labelledby={`${base}-tab-${framework.id}`}
            hidden={i !== selected}
            className="picker-panel"
          >
            <div dangerouslySetInnerHTML={{ __html: framework.code }} />
            <p className="picker-links">
              {framework.demo ? (
                <a href={framework.demo.href} className="text-link">
                  {framework.demo.label}
                  <ArrowRight />
                </a>
              ) : null}
              {framework.note ? <span className="picker-note">{framework.note}</span> : null}
              <Link href={framework.guide.href} className="text-link">
                {framework.guide.label}
                <ArrowRight />
              </Link>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

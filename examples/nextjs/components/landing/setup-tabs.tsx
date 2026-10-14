'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { ArrowRight } from '../icons';

export interface SetupStep {
  title: string;
  /** Highlighted code block HTML, built on the server. */
  code?: string;
  text?: ReactNode;
  link?: { href: string; label: string };
}

export interface SetupTab {
  id: string;
  label: string;
  summary: string;
  docs: { href: string; label: string };
  /** The framework's live demo: an example site, deployed. */
  demo?: { href: string; label: string };
  steps: SetupStep[];
}

/** Tabs per the WAI-ARIA pattern: arrow keys, Home and End move between them. */
export function SetupTabs({ tabs }: { tabs: SetupTab[] }) {
  const [selected, setSelected] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const base = useId();

  // The row fades at its end only while tabs are hidden past it, as on a phone.
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const update = () => {
      setMore(element.scrollWidth - element.clientWidth - element.scrollLeft > 1);
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    element.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, []);

  const select = (index: number) => {
    const next = (index + tabs.length) % tabs.length;
    setSelected(next);
    refs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Partial<Record<string, number>> = {
      ArrowRight: selected + 1,
      ArrowLeft: selected - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };

  return (
    <div className="setup">
      <div
        ref={list}
        role="tablist"
        aria-label="Setup for your stack"
        className="setup-tabs"
        data-more={more ? '' : undefined}
        onKeyDown={onKeyDown}
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(element) => {
              refs.current[i] = element;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${tab.id}`}
            aria-selected={i === selected}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={i === selected ? 0 : -1}
            className="setup-tab"
            onClick={() => {
              setSelected(i);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={i !== selected}
          className="setup-panel"
        >
          <p className="setup-summary">{tab.summary}</p>
          <ol className="setup-steps">
            {tab.steps.map((step, n) => (
              <li key={step.title} className="setup-step">
                <span className="setup-number" aria-hidden="true">
                  {n + 1}
                </span>
                <div className="setup-step-body">
                  <p className="setup-step-title">{step.title}</p>
                  {step.text ? (
                    <p className="setup-step-text">
                      {step.text}
                      {step.link ? (
                        <>
                          {' '}
                          <Link href={step.link.href}>{step.link.label}</Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                  {step.code ? <div dangerouslySetInnerHTML={{ __html: step.code }} /> : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="setup-links">
            <Link href={tab.docs.href} className="text-link">
              {tab.docs.label}
              <ArrowRight />
            </Link>
            {tab.demo ? (
              <a href={tab.demo.href} className="text-link">
                {tab.demo.label}
                <ArrowRight />
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

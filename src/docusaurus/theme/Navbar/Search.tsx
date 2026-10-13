/// <reference types="@docusaurus/module-type-aliases" />

import { useAllPluginInstancesData } from '@docusaurus/useGlobalData';
import NavbarSearch from '@theme-init/Navbar/Search';
import type { ReactNode } from 'react';

import type { OndocsGlobalData } from '../../index';

export interface Props {
  readonly children?: ReactNode;
  readonly className?: string;
}

/**
 * The navbar's search box, with the "Ask AI" button after it when the plugin's `dialog.navbar` is
 * set. Docusaurus renders this container in the navbar once, with or without a search plugin and
 * wherever a `search` navbar item puts it, and keeps it in the navbar on phones.
 */
export default function NavbarSearchWithAsk({ children, className }: Props): ReactNode {
  const instances = useAllPluginInstancesData('ondocs') as
    Record<string, OndocsGlobalData | undefined> | undefined;
  const data = Object.values(instances ?? {})[0];
  if (!data?.navbar) return <NavbarSearch className={className}>{children}</NavbarSearch>;
  const { shortcut = 'i', labels } = data.dialog;
  const key = shortcut ? shortcut.toUpperCase() : '';
  return (
    <NavbarSearch className={className ? `${className} ondocs-navbar` : 'ondocs-navbar'}>
      {children}
      <button
        type="button"
        className="ondocs-button"
        data-ondocs-open=""
        aria-haspopup="dialog"
        aria-keyshortcuts={key ? `Meta+${key} Control+${key}` : undefined}
      >
        {/* The sparkle is the stylesheet's, and so is ⌘ or Ctrl, by the platform the page
            marks on <html>. */}
        <span className="ondocs-button-label">{data.navbar}</span>
        {key ? (
          <kbd aria-hidden="true" data-control={labels?.controlKey ?? 'Ctrl'}>
            {key}
          </kbd>
        ) : null}
      </button>
    </NavbarSearch>
  );
}

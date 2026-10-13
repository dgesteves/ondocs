/// <reference types="@docusaurus/module-type-aliases" />

import BrowserOnly from '@docusaurus/BrowserOnly';
import { useHistory } from '@docusaurus/router';
import { useAllPluginInstancesData } from '@docusaurus/useGlobalData';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import { listenForOpen } from '../../embed/open';
import type { OndocsGlobalData } from '../index';
import { loadAskDialog } from '../../react/ask-dialog';
import { AskWithLauncher, useColorScheme } from '../../react/launcher';

export interface Props {
  /** The plugin instance to read, when the site uses more than one. Default: the first. */
  readonly pluginId?: string;
}

/**
 * The ask dialog and its floating launcher, rendered in the browser only. The plugin's `Root`
 * renders it; a site whose `Root` comes from another plugin can swizzle `Root` and render
 * `<Ondocs />` itself. Rendered twice, it shows once. The navbar button, `openAskDialog()` and
 * any element with `data-ondocs-open` open it too.
 */
export default function Ondocs({ pluginId }: Props): ReactNode {
  const instances = useAllPluginInstancesData('ondocs') as
    Record<string, OndocsGlobalData | undefined> | undefined;
  const data = pluginId === undefined ? Object.values(instances ?? {})[0] : instances?.[pluginId];
  if (!data) return null;
  return <BrowserOnly>{() => <Ask {...data} />}</BrowserOnly>;
}

function Ask({ endpoint, dialog, locale }: OndocsGlobalData): ReactNode {
  const history = useHistory();
  // `Root` sits outside Docusaurus's color mode provider, so this follows the `data-theme`
  // attribute Docusaurus sets on `<html>` instead of its hook.
  const theme = useColorScheme('auto');
  const first = useFirstInstance();
  // Open, and with the question it was opened with, from outside the dialog.
  const [opened, setOpened] = useState<{ open: boolean; question?: string }>({ open: false });
  useEffect(() => {
    if (!first) return;
    return listenForOpen(
      (question) => {
        setOpened({ open: true, question });
      },
      () => void loadAskDialog(),
    );
  }, [first]);
  if (!first) return null;

  return (
    <AskWithLauncher
      {...dialog}
      endpoint={endpoint}
      {...(locale ? { locale } : {})}
      theme={theme}
      open={opened.open}
      {...(opened.question ? { question: opened.question } : {})}
      onOpenChange={(open) => {
        setOpened({ open });
      }}
      onNavigate={(url, event) => {
        // Same-site links route without a full page load.
        if (url.startsWith('/') && !url.startsWith('//')) {
          event.preventDefault();
          history.push(url);
        }
      }}
    />
  );
}

/** The mounted instances, in mount order. */
const mounted: object[] = [];
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether this is the first instance mounted, so a site that renders two shows one dialog. */
function useFirstInstance(): boolean {
  const [self] = useState(() => ({}));
  useEffect(() => {
    mounted.push(self);
    notify();
    return () => {
      mounted.splice(mounted.indexOf(self), 1);
      notify();
    };
  }, [self]);
  return useSyncExternalStore(
    subscribe,
    () => mounted[0] === self,
    () => false,
  );
}

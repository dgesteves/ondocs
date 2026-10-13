// The embed's dialog: React, Radix and cmdk, loaded the first time the dialog is wanted, and
// rendered by `mountWithLoader` into its container. The button and the shortcut stay with it.
import { useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { useColorScheme } from '../react/launcher';
import { DialogPanel } from '../react/dialog-panel';
import type { DialogRenderOptions, DialogRenderer } from './mount';

/** Whether the dialog is open, and the question it was opened with. */
interface Opened {
  open: boolean;
  question?: string;
}

interface OpenState {
  subscribe: (listener: () => void) => () => void;
  get: () => Opened;
  set: (next: Opened) => void;
}

function openState(initial: Opened): OpenState {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => state,
    set: (next) => {
      state = next;
      for (const listener of listeners) listener();
    },
  };
}

function Embedded({
  state,
  theme,
  onNavigate,
  onOpenChange,
  ...props
}: Omit<DialogRenderOptions, 'open' | 'question'> & { state: OpenState }): ReactNode {
  const { open, question } = useSyncExternalStore(state.subscribe, state.get, state.get);
  return (
    <DialogPanel
      {...props}
      theme={useColorScheme(theme)}
      open={open}
      {...(question ? { question } : {})}
      onOpenChange={(next) => {
        state.set({ open: next });
        onOpenChange(next);
      }}
      {...(onNavigate
        ? {
            onNavigate: (url, event) => {
              onNavigate(url, event.nativeEvent);
            },
          }
        : {})}
    />
  );
}

export const render: DialogRenderer['render'] = (element, options) => {
  const { open, question, ...rest } = options;
  const state = openState({ open, question });
  const root = createRoot(element);
  root.render(<Embedded {...rest} endpoint={options.endpoint ?? '/api/ask'} state={state} />);
  return {
    setOpen: (next, asking) => {
      const current = state.get();
      if (current.open !== next || current.question !== asking) {
        state.set({ open: next, question: asking });
      }
    },
    unmount: () => {
      root.unmount();
      element.remove();
    },
  };
};

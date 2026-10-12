// Options under their names from before 0.9, which still work for one minor version and say once
// what they are called now. Each call site keeps the old name working; this only warns.

/** The minor version that removes the old names. */
export const REMOVED_IN = '0.10';

const warned = new Set<string>();

/**
 * Says once per process (or page) that `old` is now `current`, such as
 * `dialog.buttonLabel is now dialog.launcher`.
 */
export function warnDeprecated(old: string, current: string): void {
  if (warned.has(old)) return;
  warned.add(old);
  console.warn(`[ondocs] ${old} is now ${current}. The old name still works until ${REMOVED_IN}.`);
}

/** Forgets which warnings were given, so a test can see each one again. */
export function resetDeprecationWarnings(): void {
  warned.clear();
}

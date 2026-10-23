/**
 * Slashes trimmed off the ends of a path, a base or a URL, in linear time. `/\/+$/` is not: on a
 * long run of slashes that does not end the string, each slash in the run starts a match that
 * fails at the run's end, so 100,000 of them take seconds.
 */

/** `value` without the slashes at its end: `/docs//` → `/docs`. */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end -= 1;
  return value.slice(0, end);
}

/** `value` without the slashes at its start and its end: `//docs/intro/` → `docs/intro`. */
export function trimSlashes(value: string): string {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) === 0x2f) start += 1;
  return trimTrailingSlashes(value.slice(start));
}

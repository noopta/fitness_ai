/**
 * Dev-only console logging.
 *
 * Release builds write console output to the device log (Console.app /
 * logcat), where any app or USB-attached machine with log access can read it —
 * so URLs, emails and auth state must never reach it. Everything here is a
 * no-op outside __DEV__. Use this instead of console.* in auth / API / billing
 * code. (Deliberately not a babel plugin: explicit, and greppable.)
 */

/* eslint-disable no-console */
const noop = (..._args: unknown[]) => {};
const dev = typeof __DEV__ !== 'undefined' && __DEV__;

export const log = {
  debug: dev ? (...args: unknown[]) => console.log(...args) : noop,
  info: dev ? (...args: unknown[]) => console.log(...args) : noop,
  warn: dev ? (...args: unknown[]) => console.warn(...args) : noop,
  error: dev ? (...args: unknown[]) => console.error(...args) : noop,
};

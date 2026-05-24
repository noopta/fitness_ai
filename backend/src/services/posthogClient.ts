// PostHog server-side client. Defensive init so test runs (and local dev
// without a key) don't crash at import time — the PostHog SDK throws
// synchronously if the key is undefined. When no key is set we export a
// no-op stub with the same surface the rest of the code calls into.

import { PostHog } from 'posthog-node';

type AnyArgs = any[];
// Mirror the surface of posthog-node we actually call from the app. Keep
// it loose (any-args) so new SDK methods don't require a stub update; we
// only care about the *shape* matching what callers expect.
interface PostHogLike {
  capture: (...args: AnyArgs) => any;
  captureException: (...args: AnyArgs) => any;
  identify: (...args: AnyArgs) => any;
  alias: (...args: AnyArgs) => any;
  groupIdentify: (...args: AnyArgs) => any;
  shutdown: (...args: AnyArgs) => any;
}

function createStub(): PostHogLike {
  const noop = () => {};
  return {
    capture: noop, captureException: noop, identify: noop, alias: noop,
    groupIdentify: noop, shutdown: async () => {},
  };
}

const apiKey = process.env.POSTHOG_API_KEY;
const posthog: PostHogLike = apiKey
  ? new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST,
      enableExceptionAutocapture: true,
    })
  : createStub();

export default posthog;

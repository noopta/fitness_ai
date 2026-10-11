// One error boundary per v2 page, so a render error in one page shows a
// "couldn't load" panel there instead of blanking the whole shell (the shell's
// own boundary in app/(v2)/_layout.tsx stays as the last line). Caught errors
// still go to Sentry and PostHog, tagged with the page's label.

import React from 'react';
import { router } from 'expo-router';
import { ErrorBoundary } from '../components/ErrorBoundary';

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/(v2)' as any);
}

export function PageBoundary({ label, back, children }: { label: string; back?: boolean; children: React.ReactNode }) {
  return (
    <ErrorBoundary label={label} message="This page couldn't load." onBack={back ? goBack : undefined}>
      {children}
    </ErrorBoundary>
  );
}

/** Wraps a pushed route's screen. These open over the track, so the fallback offers a way back. */
export function withPageBoundary<P extends object>(Screen: React.ComponentType<P>, label: string) {
  function Bounded(props: P) {
    return (
      <PageBoundary label={label} back>
        <Screen {...props} />
      </PageBoundary>
    );
  }
  Bounded.displayName = `withPageBoundary(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return Bounded;
}

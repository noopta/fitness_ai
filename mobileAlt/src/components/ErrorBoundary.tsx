import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radius, fontSize, fontWeight } from '../constants/theme';
import { posthog } from '../lib/analytics';

interface Props {
  children: React.ReactNode;
  /** Shown above the retry button. Defaults to a generic message. */
  message?: string;
  /** Optional label for telemetry / debugging. */
  label?: string;
  /** Called when the user taps "Try again" (e.g. to refetch data). */
  onReset?: () => void;
}

interface State {
  hasError: boolean;
}

/**
 * Catches render-time errors in its subtree and shows a recoverable fallback
 * instead of crashing the whole app. Android's native SVG / Reanimated views
 * are far less forgiving of malformed props (NaN coords, etc.) than iOS, so a
 * single bad data point used to take the entire app down. This keeps the blast
 * radius to the affected screen.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    const label = this.props.label ? `:${this.props.label}` : '';
    console.error(`[ErrorBoundary${label}]`, error);
    // Report to PostHog so caught render errors are visible in Activity →
    // Errors. Without this, ErrorBoundary swallows the crash and we get no
    // remote breadcrumb. The global handler in app/_layout.tsx only sees
    // uncaught errors — boundaries catch theirs, so we surface them here.
    try {
      const err = error as Error | null;
      posthog.capture('$exception', {
        $exception_message: err?.message ?? String(error),
        $exception_stack_trace_raw: err?.stack ?? '',
        $exception_type: err?.name ?? 'Error',
        boundary_label: this.props.label ?? null,
        component_stack: info?.componentStack ?? null,
        is_fatal: false,
      });
    } catch { /* never let our reporter mask the real error */ }
  }

  handleReset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.wrap}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            {this.props.message ?? 'We hit a snag loading this screen.'}
          </Text>
          <TouchableOpacity style={styles.button} onPress={this.handleReset} activeOpacity={0.85}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.foreground },
  body: { fontSize: fontSize.sm, color: colors.mutedForeground, textAlign: 'center' },
  button: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  buttonText: { color: colors.primaryForeground, fontWeight: fontWeight.semibold, fontSize: fontSize.sm },
});

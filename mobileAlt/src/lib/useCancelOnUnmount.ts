// Stops in-flight Reanimated animations when a component unmounts.
//
// Charts drive react-native-svg props (dash offsets, ring arcs, the radar
// path) from the UI thread for 500–700 ms after they mount. If a tap navigates
// away mid-animation, the animation keeps writing to an SVG node that Fabric
// has already torn down. On iOS that ends in EXC_BAD_ACCESS inside SVG layout
// (Sentry REACT-NATIVE-D, 10 Oct 2026: a tap on a chart on Home). Cancelling
// on unmount means nothing is left writing once the node is gone.

import { useEffect } from 'react';
import { cancelAnimation, type SharedValue } from 'react-native-reanimated';

export function useCancelOnUnmount(...values: SharedValue<any>[]): void {
  useEffect(
    () => () => {
      for (const v of values) cancelAnimation(v);
    },
    // Shared values are stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

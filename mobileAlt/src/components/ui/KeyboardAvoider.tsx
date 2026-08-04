import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, View, Keyboard, Platform,
  type KeyboardEvent, type ViewStyle, type StyleProp,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Keeps content above the keyboard on both platforms.
 *
 * iOS: plain KeyboardAvoidingView with behavior="padding" — works fine there.
 *
 * Android: KeyboardAvoidingView is NOT used, because it does not reliably work
 * under the edge-to-edge layout Expo SDK 55 forces. Observed on the Chat tab:
 * with behavior="padding" the container received no padding at all, so the
 * flex:1 transcript filled the whole screen and the input bar sat underneath
 * the keyboard, invisible. Its internal frame math assumes a window that
 * resizes (or at least measures) the way it did pre-edge-to-edge.
 *
 * Instead we read the IME height straight from keyboardDidShow and apply it as
 * padding ourselves. This is deterministic — no frame measurement, nothing to
 * get confused by insets. It is also demonstrably correct on this app: the
 * Done pill in KeyboardDoneBar is positioned from the same event and lands in
 * the right place.
 *
 * The bottom safe-area inset is subtracted because under edge-to-edge the
 * reported IME height includes the gesture/navigation bar, which the layout
 * already accounts for. Without that subtraction the content floats a
 * nav-bar's height too high.
 */
export function KeyboardAvoider({
  children,
  style,
  iosOffset = 0,
  /** Extra breathing room between the content and the keyboard. */
  extraOffset = 0,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  iosOffset?: number;
  extraOffset?: number;
}) {
  const insets = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onShow = (e: KeyboardEvent) => setKeyboardHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    const showSub = Keyboard.addListener('keyboardDidShow', onShow);
    const hideSub = Keyboard.addListener('keyboardDidHide', onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  if (Platform.OS === 'ios') {
    return (
      <KeyboardAvoidingView style={style} behavior="padding" keyboardVerticalOffset={iosOffset}>
        {children}
      </KeyboardAvoidingView>
    );
  }

  const pad = keyboardHeight > 0
    ? Math.max(0, keyboardHeight - insets.bottom + extraOffset)
    : 0;

  return <View style={[style, { paddingBottom: pad }]}>{children}</View>;
}

export default KeyboardAvoider;

// Kept so callers can reuse the same measurement without duplicating listeners.
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const onShow = (e: KeyboardEvent) => setH(e.endCoordinates?.height ?? 0);
    const onHide = () => setH(0);
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', onShow,
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', onHide,
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);
  return h;
}

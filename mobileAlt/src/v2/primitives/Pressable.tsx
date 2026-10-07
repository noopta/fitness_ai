// Pressable with touch slop — a drop-in for react-native's.
//
// The v2 track switches tabs with a gesture-handler pan, but rows are RN
// Pressables, and the two don't negotiate. A thumb swipe arcs: when it moves
// vertically before it has moved far enough sideways, the pan gives up, and a
// full-width row never sees the finger leave its bounds — so lifting the thumb
// fired onPress and opened a page mid-swipe (founder, 7 Oct 2026).
//
// Native lists solve this with touch slop: a touch that travels further than a
// few points is a drag, not a tap. Same here: past TOUCH_SLOP from where the
// finger went down, onPress and onLongPress are dropped and the pressed look
// clears. Everything else passes straight through.

import React, { forwardRef, useRef, useState } from 'react';
import { Pressable as RNPressable, type PressableProps, type PressableStateCallbackType, type GestureResponderEvent, type View } from 'react-native';

/** Points the finger may travel and still count as a tap (iOS/Android lists use ~10). */
export const TOUCH_SLOP = 10;

/** Pure: did a touch travel past the slop? Exported for tests. */
export const pastSlop = (from: { x: number; y: number }, to: { x: number; y: number }, slop = TOUCH_SLOP) =>
  Math.hypot(to.x - from.x, to.y - from.y) > slop;

export const Pressable = forwardRef<View, PressableProps>(function Pressable(props, ref) {
  const { onPress, onLongPress, onTouchStart, onTouchMove, style, children, ...rest } = props;
  const start = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const [moved, setMoved] = useState(false);

  const begin = (e: GestureResponderEvent) => {
    start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    movedRef.current = false;
    if (moved) setMoved(false);
    onTouchStart?.(e);
  };
  const track = (e: GestureResponderEvent) => {
    if (start.current && !movedRef.current && pastSlop(start.current, { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY })) {
      movedRef.current = true;
      setMoved(true);
    }
    onTouchMove?.(e);
  };
  const lift = (state: PressableStateCallbackType): PressableStateCallbackType => ({ ...state, pressed: state.pressed && !moved });

  return (
    <RNPressable
      ref={ref}
      {...rest}
      onTouchStart={begin}
      onTouchMove={track}
      onPress={onPress ? (e) => { if (!movedRef.current) onPress(e); } : undefined}
      onLongPress={onLongPress ? (e) => { if (!movedRef.current) onLongPress(e); } : undefined}
      style={typeof style === 'function' ? (s) => style(lift(s)) : style}
    >
      {typeof children === 'function' ? (s: PressableStateCallbackType) => children(lift(s)) : children}
    </RNPressable>
  );
});

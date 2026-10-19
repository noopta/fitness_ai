// A shareable drawn at any width (thumbnail, sheet, full preview). The scene
// is built with the real measure, recorded once into a Picture, and redrawn
// only when the data, ink, photo or width change.

import React, { useMemo } from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Picture, type SkImage } from '@shopify/react-native-skia';
import { sceneFor, SHARE_W, SHARE_H, type ShareableData } from '@axiom/agent-ui-core';
import { makeMeasure, scenePicture, type Faces } from './skiaShare';

export function ScenePreview({ shareable, width, faces, mark, photo = null, ink = 'white', withPhoto = true, style, rounded = true }: {
  shareable: ShareableData;
  width: number;
  faces: Faces;
  mark: SkImage | null;
  photo?: SkImage | null;
  ink?: 'white' | 'dark';
  withPhoto?: boolean;
  style?: StyleProp<ViewStyle>;
  rounded?: boolean;
}) {
  const height = Math.round((width * SHARE_H) / SHARE_W);
  const scene = useMemo(() => sceneFor(shareable, { measure: makeMeasure(faces), ink, preview: true, withPhoto }), [shareable, faces, ink, withPhoto]);
  const picture = useMemo(() => scenePicture(scene, faces, { mark, photo }, width), [scene, faces, mark, photo, width]);
  return (
    <View style={[{ width, height, borderRadius: rounded ? Math.max(6, width * 0.066) : 0, overflow: 'hidden' }, !scene.background && !withPhoto && st.checker, style]}
      accessible accessibilityRole="image" accessibilityLabel={scene.label}>
      <Canvas style={{ width, height }}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

const st = StyleSheet.create({
  // "Save overlay only": show the transparency against a mid grey.
  checker: { backgroundColor: '#8a8a8e' },
});

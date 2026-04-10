import React from 'react';
import { View, Text } from 'react-native';

interface Segment { text: string; bold: boolean }

function parseBold(text: string): Segment[] {
  const parts: Segment[] = [];
  const re = /\*\*(.*?)\*\*/g;
  let last = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), bold: false });
    parts.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts.length > 0 ? parts : [{ text, bold: false }];
}

/**
 * Renders assistant message text with basic markdown support:
 * - **bold** text
 * - Newlines → visual line breaks with appropriate spacing
 */
export function MarkdownText({ text, style }: { text: string; style?: any }) {
  const lines = text.split('\n');
  return (
    <View style={{ gap: 3 }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={i} style={{ height: 4 }} />;
        const segments = parseBold(trimmed);
        return (
          <Text key={i} style={style}>
            {segments.map((seg, j) =>
              seg.bold
                ? <Text key={j} style={{ fontWeight: '700' }}>{seg.text}</Text>
                : <Text key={j}>{seg.text}</Text>
            )}
          </Text>
        );
      })}
    </View>
  );
}

import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';

// ── Inline token parser ────────────────────────────────────────────────────────
// Handles **bold**, *italic*, `code` within a single line

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string };

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Order matters: bold (**) before italic (*) to avoid partial matches
  const re = /\*\*(.*?)\*\*|\*(.*?)\*|`(.*?)`/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: text.slice(last, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'bold', value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ type: 'italic', value: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'code', value: match[3] });
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) });
  return tokens.length > 0 ? tokens : [{ type: 'text', value: text }];
}

function InlineContent({ tokens, baseStyle }: { tokens: InlineToken[]; baseStyle?: any }) {
  return (
    <Text style={baseStyle}>
      {tokens.map((tok, i) => {
        switch (tok.type) {
          case 'bold':
            return <Text key={i} style={{ fontWeight: '700' }}>{tok.value}</Text>;
          case 'italic':
            return <Text key={i} style={{ fontStyle: 'italic' }}>{tok.value}</Text>;
          case 'code':
            return <Text key={i} style={s.inlineCode}>{tok.value}</Text>;
          default:
            return <Text key={i}>{tok.value}</Text>;
        }
      })}
    </Text>
  );
}

// ── Block parser ───────────────────────────────────────────────────────────────

type Block =
  | { type: 'h1'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'bullet'; text: string; depth: number }
  | { type: 'ordered'; text: string; num: number }
  | { type: 'hr' }
  | { type: 'blank' }
  | { type: 'paragraph'; text: string };

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  for (const line of markdown.split('\n')) {
    const trimmed = line.trimEnd();

    if (!trimmed.trim()) {
      blocks.push({ type: 'blank' });
      continue;
    }

    // Headings
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^###\s+(.+)/)))  { blocks.push({ type: 'h3', text: m[1] }); continue; }
    if ((m = trimmed.match(/^##\s+(.+)/)))   { blocks.push({ type: 'h2', text: m[1] }); continue; }
    if ((m = trimmed.match(/^#\s+(.+)/)))    { blocks.push({ type: 'h1', text: m[1] }); continue; }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed.trim())) {
      blocks.push({ type: 'hr' });
      continue;
    }

    // Bullet list (-, *, •)
    if ((m = line.match(/^(\s*)[*\-•]\s+(.*)/))) {
      const depth = Math.floor(m[1].length / 2);
      blocks.push({ type: 'bullet', text: m[2], depth });
      continue;
    }

    // Ordered list (1. 2. etc.)
    if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)/))) {
      blocks.push({ type: 'ordered', text: m[3], num: parseInt(m[2], 10) });
      continue;
    }

    blocks.push({ type: 'paragraph', text: trimmed.trim() });
  }
  return blocks;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function MarkdownText({ text, style }: { text: string; style?: any }) {
  const raw = parseBlocks(text);

  // Collapse consecutive blanks → single blank; strip leading/trailing blanks
  const blocks: Block[] = [];
  for (const b of raw) {
    if (b.type === 'blank' && blocks[blocks.length - 1]?.type === 'blank') continue;
    blocks.push(b);
  }
  while (blocks[0]?.type === 'blank') blocks.shift();
  while (blocks[blocks.length - 1]?.type === 'blank') blocks.pop();

  return (
    <View style={{ gap: 2 }}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'blank':
            return <View key={i} style={{ height: 6 }} />;

          case 'hr':
            return <View key={i} style={s.hr} />;

          case 'h1':
            return <Text key={i} style={[style, s.h1]}>{block.text}</Text>;

          case 'h2':
            return <Text key={i} style={[style, s.h2]}>{block.text}</Text>;

          case 'h3':
            return <Text key={i} style={[style, s.h3]}>{block.text}</Text>;

          case 'bullet': {
            const tokens = parseInline(block.text);
            return (
              <View key={i} style={[s.listRow, { paddingLeft: 4 + block.depth * 14 }]}>
                <Text style={[style, s.bulletDot]}>{'•'}</Text>
                <InlineContent tokens={tokens} baseStyle={[style, s.listText]} />
              </View>
            );
          }

          case 'ordered': {
            const tokens = parseInline(block.text);
            return (
              <View key={i} style={s.listRow}>
                <Text style={[style, s.bulletDot]}>{block.num}.</Text>
                <InlineContent tokens={tokens} baseStyle={[style, s.listText]} />
              </View>
            );
          }

          case 'paragraph': {
            const tokens = parseInline(block.text);
            return <InlineContent key={i} tokens={tokens} baseStyle={[style, { lineHeight: 20 }]} />;
          }

          default:
            return null;
        }
      })}
    </View>
  );
}

const s = StyleSheet.create({
  h1: {
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 24,
    marginTop: 4,
    marginBottom: 2,
  },
  h2: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 22,
    marginTop: 4,
    marginBottom: 2,
  },
  h3: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    marginTop: 2,
    marginBottom: 1,
  },
  hr: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(156,163,175,0.4)',
    marginVertical: 8,
  },
  listRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'flex-start',
  },
  bulletDot: {
    lineHeight: 20,
    flexShrink: 0,
    minWidth: 14,
  },
  listText: {
    flex: 1,
    lineHeight: 20,
  },
  inlineCode: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    backgroundColor: 'rgba(156,163,175,0.2)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
});

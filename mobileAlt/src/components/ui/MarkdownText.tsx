import React from 'react';
import { View, Text, StyleSheet, Platform, Linking } from 'react-native';

// ── Inline token parser ────────────────────────────────────────────────────────
// Handles **bold**, __bold__, *italic*, _italic_, `code`, ~~strike~~,
// and [link](url) within a single line.

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'link'; value: string; href: string };

// One big regex matched in declared order. Bold variants come before italic
// so `**foo**` isn't partially consumed as italic. `__bold__` mirrors `**bold**`
// because GPT-style outputs use both interchangeably.
const INLINE_RE = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|~~([^~]+)~~|\*([^*]+)\*|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g;

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  INLINE_RE.lastIndex = 0;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: text.slice(last, match.index) });
    }
    if (match[1] !== undefined && match[2] !== undefined) {
      tokens.push({ type: 'link', value: match[1], href: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'bold', value: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'bold', value: match[4] });
    } else if (match[5] !== undefined) {
      tokens.push({ type: 'code', value: match[5] });
    } else if (match[6] !== undefined) {
      tokens.push({ type: 'strike', value: match[6] });
    } else if (match[7] !== undefined) {
      tokens.push({ type: 'italic', value: match[7] });
    } else if (match[8] !== undefined) {
      tokens.push({ type: 'italic', value: match[8] });
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
          case 'strike':
            return <Text key={i} style={{ textDecorationLine: 'line-through' }}>{tok.value}</Text>;
          case 'link':
            return (
              <Text
                key={i}
                style={{ color: '#3b82f6', textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL(tok.href).catch(() => {})}
              >
                {tok.value}
              </Text>
            );
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
  | { type: 'ordered'; text: string; num: number; depth: number }
  | { type: 'codeblock'; text: string; lang?: string }
  | { type: 'hr' }
  | { type: 'blank' }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'paragraph'; text: string };

// Split a GFM table row "| a | b |" into trimmed cells, dropping the empty
// edges produced by the leading/trailing pipes.
function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}
function isTableSeparator(line: string): boolean {
  // e.g. |---|:--:|---| — cells of dashes with optional colons.
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line.trim());
}
function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length > 2;
}

function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');

  let inCodeBlock = false;
  let codeBlockLang: string | undefined;
  let codeBlockLines: string[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // ── GFM table: a row line, then a separator line, then body rows. ──
    if (!inCodeBlock && isTableRow(line) && li + 1 < lines.length && isTableSeparator(lines[li + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      let j = li + 2;
      while (j < lines.length && isTableRow(lines[j])) {
        rows.push(splitTableRow(lines[j]));
        j++;
      }
      blocks.push({ type: 'table', header, rows });
      li = j - 1; // continue after the consumed table lines
      continue;
    }

    const fenceMatch = line.match(/^```\s*([A-Za-z0-9_-]*)\s*$/);

    if (fenceMatch) {
      if (inCodeBlock) {
        blocks.push({ type: 'codeblock', text: codeBlockLines.join('\n'), lang: codeBlockLang });
        inCodeBlock = false;
        codeBlockLang = undefined;
        codeBlockLines = [];
      } else {
        inCodeBlock = true;
        codeBlockLang = fenceMatch[1] || undefined;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

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

    // Ordered list (1. 2. etc.) — support indented nested items too
    if ((m = line.match(/^(\s*)(\d+)\.\s+(.*)/))) {
      const depth = Math.floor(m[1].length / 2);
      blocks.push({ type: 'ordered', text: m[3], num: parseInt(m[2], 10), depth });
      continue;
    }

    blocks.push({ type: 'paragraph', text: trimmed.trim() });
  }

  // If file ended mid-codeblock, flush remaining lines as a code block to avoid
  // dropping content entirely.
  if (inCodeBlock && codeBlockLines.length > 0) {
    blocks.push({ type: 'codeblock', text: codeBlockLines.join('\n'), lang: codeBlockLang });
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
              <View key={i} style={[s.listRow, { paddingLeft: 4 + block.depth * 14 }]}>
                <Text style={[style, s.bulletDot]}>{block.num}.</Text>
                <InlineContent tokens={tokens} baseStyle={[style, s.listText]} />
              </View>
            );
          }

          case 'codeblock':
            return (
              <View key={i} style={s.codeBlock}>
                <Text style={s.codeBlockText}>{block.text}</Text>
              </View>
            );

          case 'table': {
            const colCount = Math.max(block.header.length, ...block.rows.map((r) => r.length));
            return (
              <View key={i} style={s.table}>
                <View style={[s.tableRow, s.tableHeaderRow]}>
                  {Array.from({ length: colCount }).map((_, c) => (
                    <View key={c} style={s.tableCell}>
                      <InlineContent tokens={parseInline(block.header[c] ?? '')} baseStyle={[style, s.tableHeaderText]} />
                    </View>
                  ))}
                </View>
                {block.rows.map((row, r) => (
                  <View key={r} style={[s.tableRow, r === block.rows.length - 1 && s.tableRowLast]}>
                    {Array.from({ length: colCount }).map((_, c) => (
                      <View key={c} style={s.tableCell}>
                        <InlineContent tokens={parseInline(row[c] ?? '')} baseStyle={[style, s.tableCellText]} />
                      </View>
                    ))}
                  </View>
                ))}
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
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(156,163,175,0.5)',
    borderRadius: 8,
    marginVertical: 8,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(156,163,175,0.3)',
  },
  tableRowLast: { borderBottomWidth: 0 },
  tableHeaderRow: { backgroundColor: 'rgba(156,163,175,0.12)' },
  tableCell: {
    flex: 1,
    flexBasis: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(156,163,175,0.2)',
  },
  tableHeaderText: { fontSize: 12, fontWeight: '700', lineHeight: 16 },
  tableCellText: { fontSize: 12, lineHeight: 16 },
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
  codeBlock: {
    backgroundColor: 'rgba(156,163,175,0.18)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginVertical: 4,
  },
  codeBlockText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
});

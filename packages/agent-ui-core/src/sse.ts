// Server-Sent Events parser for the agent stream.
//
// The backend writes `data: {json}\n\n` per event and a final `event: end`.
// RN has no EventSource; we read the response body as a stream (expo/fetch)
// and feed chunks here. The parser is incremental and tolerant: partial
// frames are buffered, non-JSON data lines are dropped, and the `end` event
// closes the stream without a payload.

export interface SseFrame {
  event: string | null;
  data: string;
}

export function createSseParser(onFrame: (f: SseFrame) => void) {
  let buffer = '';
  const flush = (block: string) => {
    let event: string | null = null;
    const data: string[] = [];
    for (const raw of block.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;
      const idx = line.indexOf(':');
      const field = idx < 0 ? line : line.slice(0, idx);
      let value = idx < 0 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') data.push(value);
    }
    if (event !== null || data.length) onFrame({ event, data: data.join('\n') });
  };
  return {
    push(chunk: string) {
      buffer += chunk;
      let i: number;
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        flush(block);
      }
    },
    end() {
      if (buffer.trim()) flush(buffer);
      buffer = '';
    },
  };
}

/** Parse a frame's JSON payload, or null when it isn't one. */
export function parseJsonFrame<T = unknown>(f: SseFrame): T | null {
  if (!f.data) return null;
  try { return JSON.parse(f.data) as T; } catch { return null; }
}

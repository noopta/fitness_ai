// Telegram delivery for the daily growth digest.
//
// One-way push via sendMessage — does NOT need polling, so it doesn't
// conflict with the Claude-Telegram bridge that already holds the bot's
// polling slot. (Approval inline-button handling lives in the bridge and
// posts back to /api/growth/recommendation/:id/action — see Phase 2.)

const TG_API = 'https://api.telegram.org';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
// Comma-separated allowlist of chat IDs that receive the digest.
const DIGEST_CHAT_IDS = (process.env.GROWTH_DIGEST_CHAT_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

interface SendOptions {
  parseMode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>;
}

export async function sendTelegramMessage(
  text: string,
  opts: SendOptions = {},
  chatIds: string[] = DIGEST_CHAT_IDS,
): Promise<{ delivered: number; errors: string[] }> {
  if (!BOT_TOKEN) {
    return { delivered: 0, errors: ['TELEGRAM_BOT_TOKEN not set'] };
  }
  if (chatIds.length === 0) {
    return { delivered: 0, errors: ['GROWTH_DIGEST_CHAT_IDS not set'] };
  }

  // Telegram cap: 4096 chars per message. Chunk gracefully on paragraph
  // boundaries when over the limit.
  const chunks = chunkForTelegram(text);
  const errors: string[] = [];
  let delivered = 0;

  for (const chatId of chatIds) {
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const body: any = {
        chat_id: chatId,
        text: chunks[i],
      };
      if (opts.parseMode) body.parse_mode = opts.parseMode;
      // Only attach the keyboard to the FINAL chunk so the buttons don't
      // get duplicated across chunked sends.
      if (isLast && opts.inlineKeyboard) {
        body.reply_markup = { inline_keyboard: opts.inlineKeyboard };
      }

      try {
        const res = await fetch(`${TG_API}/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          errors.push(`chat=${chatId} chunk=${i + 1}/${chunks.length} HTTP ${res.status}`);
        } else {
          delivered += 1;
        }
      } catch (err: any) {
        errors.push(`chat=${chatId} chunk=${i + 1}/${chunks.length} ${err?.message ?? err}`);
      }
    }
  }

  return { delivered, errors };
}

function chunkForTelegram(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  const paragraphs = text.split(/\n\n/);
  let buf = '';
  for (const p of paragraphs) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length > limit) {
      if (buf) out.push(buf);
      // Single paragraph too long — hard-split on lines
      if (p.length > limit) {
        for (const line of p.split('\n')) {
          const lineCandidate = buf ? `${buf}\n${line}` : line;
          if (lineCandidate.length > limit) {
            if (buf) out.push(buf);
            buf = line.length > limit ? line.slice(0, limit) : line;
          } else {
            buf = lineCandidate;
          }
        }
      } else {
        buf = p;
      }
    } else {
      buf = candidate;
    }
  }
  if (buf) out.push(buf);
  return out;
}

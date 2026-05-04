import type { Telegram } from 'telegraf';
import { config } from '../../config';

interface ProgressTarget {
  chatId: number;
  messageId: number;
  lastEditAt: number;
  lastText: string;
  pending?: { text: string; timer: NodeJS.Timeout };
}

const targets = new Map<string, ProgressTarget>();

function key(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function registerProgressTarget(chatId: number, messageId: number): void {
  targets.set(key(chatId, messageId), {
    chatId,
    messageId,
    lastEditAt: 0,
    lastText: ''
  });
}

export function clearProgressTarget(chatId: number, messageId: number): void {
  const k = key(chatId, messageId);
  const target = targets.get(k);
  if (target?.pending?.timer) clearTimeout(target.pending.timer);
  targets.delete(k);
}

export async function progressUpdate(
  telegram: Telegram,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  const k = key(chatId, messageId);
  const target = targets.get(k);
  if (!target) {
    targets.set(k, {
      chatId,
      messageId,
      lastEditAt: Date.now(),
      lastText: text
    });
    await safeEdit(telegram, chatId, messageId, text);
    return;
  }
  if (text === target.lastText) return;

  const now = Date.now();
  const elapsed = now - target.lastEditAt;
  if (elapsed >= config.progressDebounceMs) {
    if (target.pending?.timer) {
      clearTimeout(target.pending.timer);
      target.pending = undefined;
    }
    target.lastEditAt = now;
    target.lastText = text;
    await safeEdit(telegram, chatId, messageId, text);
    return;
  }
  if (target.pending) {
    target.pending.text = text;
    return;
  }
  const remaining = config.progressDebounceMs - elapsed;
  const timer = setTimeout(async () => {
    const cur = targets.get(k);
    if (!cur || !cur.pending) return;
    const pendingText = cur.pending.text;
    cur.pending = undefined;
    cur.lastEditAt = Date.now();
    cur.lastText = pendingText;
    await safeEdit(telegram, chatId, messageId, pendingText);
  }, remaining);
  target.pending = { text, timer };
}

async function safeEdit(
  telegram: Telegram,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  try {
    await telegram.editMessageText(chatId, messageId, undefined, text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('message is not modified')) return;
    if (message.includes('message to edit not found')) return;
  }
}

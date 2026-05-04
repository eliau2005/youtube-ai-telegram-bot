import fs from 'fs/promises';
import path from 'path';
import { Telegraf } from 'telegraf';
import type { BotContext } from '../bot/context';

export async function downloadDocument(
  ctx: BotContext,
  fileId: string,
  destDir: string,
  filename: string
): Promise<string> {
  await fs.mkdir(destDir, { recursive: true });
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.href);
  if (!res.ok) throw new Error(`Failed to download file: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const dest = path.join(destDir, filename);
  await fs.writeFile(dest, buf);
  return dest;
}

export type TelegramBot = Telegraf<BotContext>;

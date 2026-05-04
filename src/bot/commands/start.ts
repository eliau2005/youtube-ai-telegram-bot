import { Telegraf, Markup } from 'telegraf';
import type { BotContext } from '../context';

export function registerStart(bot: Telegraf<BotContext>): void {
  bot.start(async (ctx) => {
    await ctx.reply(
      '👋 ברוך הבא ל-YouTube AI Telegram Bot.\nבחר פעולה:',
      Markup.keyboard([
        ['/new', '/import'],
        ['/export', '/history'],
        ['/help']
      ])
        .resize()
        .oneTime(false)
    );
  });
}

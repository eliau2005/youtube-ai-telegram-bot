import { Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import { JobManager } from '../../core/jobManager';

export function registerCancel(bot: Telegraf<BotContext>): void {
  bot.command('cancel', async (ctx) => {
    const userId = ctx.from!.id;
    const aborted = JobManager.abort(userId);
    if (aborted) {
      await ctx.reply('⛔ סימן עצירה — העבודה תיעצר בקרוב.');
    } else {
      await ctx.reply('אין עבודה רצה לבטל.');
    }
    if (ctx.scene?.current) {
      await ctx.scene.leave();
    }
  });
}

import type { Middleware } from 'telegraf';
import type { BotContext } from '../context';
import { logger } from '../../logger';

export const errorHandler: Middleware<BotContext> = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { err, userId: ctx.from?.id, updateType: ctx.updateType },
      'unhandled error in handler'
    );
    if (ctx.chat) {
      try {
        await ctx.reply(`❌ שגיאה: ${message.slice(0, 300)}`);
      } catch {
        /* ignore */
      }
    }
  }
};

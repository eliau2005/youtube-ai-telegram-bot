import type { Middleware } from 'telegraf';
import { config } from '../../config';
import { logger } from '../../logger';
import type { BotContext } from '../context';

export const authMiddleware: Middleware<BotContext> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !config.allowedUserIds.has(userId)) {
    logger.warn(
      { userId, username: ctx.from?.username, type: ctx.updateType },
      'access-denied'
    );
    if (ctx.chat) {
      try {
        await ctx.reply('⛔ אין לך הרשאה להשתמש בבוט. פנה למנהל.');
      } catch {
        /* ignore */
      }
    }
    return;
  }
  return next();
};

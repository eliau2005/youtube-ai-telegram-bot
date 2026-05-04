import type { Middleware } from 'telegraf';
import type { BotContext } from '../context';
import { loadSession, saveSession, clearSession } from '../../storage/session';

export const fileSession: Middleware<BotContext> = async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();
  const stored = await loadSession(userId);
  ctx.session = stored ? ((stored.state as BotContext['session']) ?? {}) : {};
  await next();
  try {
    if (Object.keys(ctx.session ?? {}).length === 0) {
      await clearSession(userId);
    } else {
      await saveSession(userId, { state: ctx.session as Record<string, unknown> });
    }
  } catch {
    /* swallow persistence errors */
  }
};

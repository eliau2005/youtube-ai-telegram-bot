import { buildBot } from './bot/bot';
import { config } from './config';
import { logger } from './logger';
import { ensureDataRoot } from './storage/paths';

async function main(): Promise<void> {
  await ensureDataRoot();
  const bot = buildBot();

  bot.catch((err, ctx) => {
    logger.error({ err, updateType: ctx.updateType }, 'top-level bot error');
  });

  // Make sure no leftover webhook is blocking polling.
  await bot.telegram.deleteWebhook({ drop_pending_updates: true }).catch((err) => {
    logger.warn({ err }, 'deleteWebhook failed (probably none set)');
  });

  const me = await bot.telegram.getMe();
  logger.info(
    {
      allowed: Array.from(config.allowedUserIds),
      dataDir: config.dataDir,
      model: config.geminiModel,
      botUsername: me.username
    },
    `bot @${me.username} ready — send it a message`
  );

  process.once('SIGINT', () => {
    logger.info('SIGINT received, stopping bot');
    bot.stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    logger.info('SIGTERM received, stopping bot');
    bot.stop('SIGTERM');
  });

  // Do NOT await — bot.launch resolves only when the bot stops, which would
  // block the entire program flow. Polling starts in the background.
  bot.launch({ dropPendingUpdates: true }).catch((err) => {
    logger.error({ err }, 'bot.launch threw');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error');
  process.exit(1);
});

import { Telegraf, Scenes, session } from 'telegraf';
import type { BotContext } from './context';
import { config } from '../config';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { newPlaylistWizard } from './scenes/newPlaylist.wizard';
import { jsonImportScene } from './scenes/jsonImport.scene';
import { jsonExportScene } from './scenes/jsonExport.scene';
import { registerInteractiveCallbacks } from './handlers/interactiveCallback';
import { registerCorrectionCallbacks } from './handlers/correctionCallback';
import { registerStart } from './commands/start';
import { registerHelp } from './commands/help';
import { registerNewPlaylist } from './commands/newPlaylist';
import { registerImportJson } from './commands/importJson';
import { registerExportJson } from './commands/exportJson';
import { registerHistory } from './commands/history';
import { registerCancel } from './commands/cancel';

export function buildBot(): Telegraf<BotContext> {
  // handlerTimeout: Infinity — playlist processing can take minutes (Gemini calls
  // for 100+ videos). Default is 90s which kills long callback handlers.
  const bot = new Telegraf<BotContext>(config.telegramBotToken, {
    handlerTimeout: Number.POSITIVE_INFINITY
  });

  bot.use(errorHandler);
  bot.use(authMiddleware);
  bot.use(session());

  const stage = new Scenes.Stage<BotContext>([
    newPlaylistWizard,
    jsonImportScene,
    jsonExportScene
  ]);
  bot.use(stage.middleware());

  // Cancel works at any time, including inside a scene.
  registerCancel(bot);

  // Callback handlers should be registered before scene-specific handlers.
  registerInteractiveCallbacks(bot);
  registerCorrectionCallbacks(bot);

  registerStart(bot);
  registerHelp(bot);
  registerNewPlaylist(bot);
  registerImportJson(bot);
  registerExportJson(bot);
  registerHistory(bot);

  return bot;
}

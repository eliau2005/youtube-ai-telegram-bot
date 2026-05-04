import { Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import { JSON_IMPORT_SCENE_ID } from '../scenes/jsonImport.scene';

export function registerImportJson(bot: Telegraf<BotContext>): void {
  bot.command('import', async (ctx) => {
    await ctx.scene.enter(JSON_IMPORT_SCENE_ID);
  });
}

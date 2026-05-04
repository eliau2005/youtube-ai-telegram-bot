import { Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import { JSON_EXPORT_SCENE_ID } from '../scenes/jsonExport.scene';

export function registerExportJson(bot: Telegraf<BotContext>): void {
  bot.command('export', async (ctx) => {
    await ctx.scene.enter(JSON_EXPORT_SCENE_ID);
  });
}

import { Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import { NEW_PLAYLIST_WIZARD_ID } from '../scenes/newPlaylist.wizard';

export function registerNewPlaylist(bot: Telegraf<BotContext>): void {
  bot.command('new', async (ctx) => {
    await ctx.scene.enter(NEW_PLAYLIST_WIZARD_ID);
  });
}

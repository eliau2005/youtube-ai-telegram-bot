import { Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import { listHistory } from '../../storage/history';
import { buildHistoryLine } from '../ui/format';

export function registerHistory(bot: Telegraf<BotContext>): void {
  bot.command('history', async (ctx) => {
    const userId = ctx.from!.id;
    const { entries, total, page, totalPages } = await listHistory(userId, 1, 10);
    if (total === 0) {
      await ctx.reply('עוד לא עיבדת פלייליסטים.');
      return;
    }
    const lines = [
      `📜 *היסטוריה* (עמ׳ ${page}/${totalPages}, סך הכל ${total})`,
      ...entries.map(buildHistoryLine)
    ];
    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
  });
}

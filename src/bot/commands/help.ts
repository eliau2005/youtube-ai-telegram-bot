import { Telegraf } from 'telegraf';
import type { BotContext } from '../context';

export function registerHelp(bot: Telegraf<BotContext>): void {
  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '📚 *פקודות זמינות:*',
        '/new — עיבוד פלייליסט יוטיוב חדש',
        '/import — ייבוא JSON ל-Strapi',
        '/export — ייצוא שיעורים מ-Strapi לקובץ JSON',
        '/history — רשימת פלייליסטים שעובדו',
        '/cancel — ביטול עבודה רצה',
        '/help — תפריט זה'
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });
}

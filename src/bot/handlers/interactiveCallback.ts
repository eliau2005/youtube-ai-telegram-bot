import { Telegraf } from 'telegraf';
import type { BotContext, NewPlaylistWizardState } from '../context';
import { JobManager } from '../../core/jobManager';
import { getDialog, clearDialog } from '../keyboards/interactiveDialog';

const PATTERN = /^aiq:([\w]+):(\d+):(oos|nsc|skp|new|edt)(?::(\d+))?$/;

export function registerInteractiveCallbacks(bot: Telegraf<BotContext>): void {
  bot.action(PATTERN, async (ctx) => {
    const match = ctx.match as RegExpMatchArray;
    const shortJobId = match[1];
    const itemIdx = parseInt(match[2], 10);
    const action = match[3];
    const optIdx = match[4] !== undefined ? parseInt(match[4], 10) : undefined;

    const userId = ctx.from?.id;
    if (!userId) return ctx.answerCbQuery('Unauthorized');
    const job = JobManager.get(userId);
    if (!job || job.shortId !== shortJobId) {
      return ctx.answerCbQuery('פג תוקף');
    }
    const dialog = getDialog(shortJobId, itemIdx);
    if (!dialog) {
      return ctx.answerCbQuery('דיאלוג לא נמצא');
    }

    if (action === 'skp') {
      JobManager.resolveDialog(userId, String(itemIdx), { action: 'skip' });
      clearDialog(shortJobId, itemIdx);
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      return ctx.answerCbQuery('דולג');
    }

    if (action === 'oos' && optIdx !== undefined) {
      const opt = dialog.options[optIdx];
      if (!opt) return ctx.answerCbQuery('אופציה לא תקפה');
      JobManager.resolveDialog(userId, String(itemIdx), {
        action: 'assign',
        subCategory: opt.subCategory,
        lessonGroup: opt.lessonGroup,
        rabbi: opt.rabbi
      });
      clearDialog(shortJobId, itemIdx);
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      return ctx.answerCbQuery(`נקבע: ${opt.subCategory}`);
    }

    if (action === 'nsc' && optIdx === 0) {
      const sug = dialog.suggested;
      if (!sug) return ctx.answerCbQuery('אין הצעה');
      const job2 = JobManager.get(userId)!;
      JobManager.resolveDialog(userId, String(itemIdx), {
        action: 'assign',
        subCategory: sug.subCategory,
        lessonGroup: sug.lessonGroup,
        rabbi: ''
      });
      void job2;
      clearDialog(shortJobId, itemIdx);
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      return ctx.answerCbQuery('הצעה אומצה');
    }

    if (action === 'new' || action === 'edt') {
      // Enter manual collection: ask for sub-category text
      const state = ctx.scene?.state as NewPlaylistWizardState | undefined;
      if (state) {
        state.pendingDialogResolution = {
          type: dialog.type,
          dialogKey: String(itemIdx),
          field: 'subCategory',
          collected: {}
        };
      }
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      await ctx.reply('שם תת-קטגוריה (חדשה או קיימת):');
      return ctx.answerCbQuery('הקלד שם');
    }

    return ctx.answerCbQuery('פעולה לא ידועה');
  });
}

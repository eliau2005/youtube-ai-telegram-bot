import { Telegraf, Input } from 'telegraf';
import path from 'path';
import type { BotContext, NewPlaylistWizardState } from '../context';
import { runImporter } from '../../core/importer';
import { logger } from '../../logger';
import { saveJob } from '../../storage/jobStore';
import { jobPath } from '../../storage/paths';
import { runProcessor } from '../../core/processor';
import { JobManager } from '../../core/jobManager';
import {
  registerProgressTarget,
  clearProgressTarget,
  progressUpdate
} from '../ui/progress';
import {
  registerDialog,
  buildOutOfScopeKeyboard,
  buildNewSubCategoryKeyboard
} from '../keyboards/interactiveDialog';
import { replyCorrectionMenu } from '../scenes/newPlaylist.wizard';
import type { ProcessingContext, UserConstraints } from '../../core/types';
import { jobsDir } from '../../storage/paths';

const COR_PATTERN = /^cor:([\w]+):(imp|gen|edt|dl|cnl|undo)(?::(pub|drf))?$/;
const FIELD_PATTERN = /^fld:([\w]+):(\d+):(lessonTitle|category|subCategory|lessonGroup|rabbi|order)$/;

function getState(ctx: BotContext): NewPlaylistWizardState | undefined {
  return ctx.scene?.state as NewPlaylistWizardState | undefined;
}

export function registerCorrectionCallbacks(bot: Telegraf<BotContext>): void {
  bot.action(COR_PATTERN, async (ctx) => {
    const match = ctx.match as RegExpMatchArray;
    const shortJobId = match[1];
    const action = match[2];
    const mode = match[3];

    const state = getState(ctx);
    if (!state || state.shortJobId !== shortJobId) {
      return ctx.answerCbQuery('פג תוקף');
    }

    if (action === 'imp') {
      const publishMode = mode === 'drf' ? 'draft' : 'publish';
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      await runImportToStrapi(ctx, state, publishMode);
      return;
    }

    if (action === 'gen') {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      await ctx.reply(
        'תאר בשפה חופשית מה לתקן (יתווסף ל-Custom Instructions ויריץ AI מחדש על אותם סרטונים, בלי לשלוף שוב מיוטיוב):'
      );
      state.pendingItemEdit = undefined;
      // Mark via session that the next text input is a general correction.
      (ctx.session as Record<string, unknown>).awaitingGeneralCorrection = true;
      return;
    }

    if (action === 'edt') {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      await ctx.reply(`איזה פריט לערוך? (1-${state.approvedVideos?.length ?? 0})`);
      state.pendingItemEdit = {};
      return;
    }

    if (action === 'dl') {
      await ctx.answerCbQuery();
      const filepath = jobPath(ctx.from!.id, state.jobId!);
      try {
        await ctx.replyWithDocument(
          Input.fromLocalFile(filepath, `playlist_${state.playlistId}_processed.json`)
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await ctx.reply(`❌ ${message}`);
      }
      return;
    }

    if (action === 'cnl') {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
      await ctx.reply('בוטל. /new להתחלה.');
      await ctx.scene.leave();
      return;
    }

    if (action === 'undo') {
      await ctx.answerCbQuery();
      if (state.history && state.history.length > 0) {
        state.approvedVideos = state.history.pop();
        await saveJob(ctx.from!.id, state.jobId!, state.approvedVideos!);
        await ctx.reply('↶ שוחזר');
        await replyCorrectionMenu(ctx, state);
      } else {
        await ctx.reply('אין מה לשחזר.');
      }
      return;
    }
  });

  bot.action(FIELD_PATTERN, async (ctx) => {
    const match = ctx.match as RegExpMatchArray;
    const shortJobId = match[1];
    const itemIdx = parseInt(match[2], 10);
    const field = match[3] as 'lessonTitle' | 'category' | 'subCategory' | 'lessonGroup' | 'rabbi' | 'order';
    const state = getState(ctx);
    if (!state || state.shortJobId !== shortJobId) return ctx.answerCbQuery('פג תוקף');
    state.pendingItemEdit = { index: itemIdx, field };
    await ctx.answerCbQuery();
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
    await ctx.reply(`ערך חדש ל-${field}:`);
  });

  bot.on('text', async (ctx, next) => {
    const state = getState(ctx);
    if (!state) return next();
    if ((ctx.session as Record<string, unknown>).awaitingGeneralCorrection) {
      delete (ctx.session as Record<string, unknown>).awaitingGeneralCorrection;
      const correction = ctx.message.text.trim();
      const ci = state.customInstructions ?? {
        summary: '',
        hasSimanim: true,
        sortBy: null,
        customSubCategoryRules: null,
        freeText: ''
      };
      ci.freeText = ci.freeText ? `${ci.freeText}\n\n${correction}` : correction;
      state.customInstructions = ci;
      // Snapshot current approvedVideos for undo
      if (state.approvedVideos) {
        state.history = state.history ?? [];
        if (state.history.length >= 3) state.history.shift();
        state.history.push(state.approvedVideos);
      }
      await ctx.reply('🧠 מריץ AI מחדש עם התיקון על הסרטונים הקיימים...');
      await rerunAiOnly(ctx, state);
      return;
    }
    return next();
  });
}

async function runImportToStrapi(
  ctx: BotContext,
  state: NewPlaylistWizardState,
  publishMode: 'publish' | 'draft'
): Promise<void> {
  if (!state.approvedVideos || state.approvedVideos.length === 0) {
    await ctx.reply('אין שיעורים לייבוא.');
    return;
  }
  const progressMsg = await ctx.reply('🚀 מתחיל ייבוא ל-Strapi...');
  registerProgressTarget(progressMsg.chat.id, progressMsg.message_id);
  try {
    const result = await runImporter(state.approvedVideos, {
      publishMode,
      log: (text: string) => logger.info({ jobId: state.jobId }, text),
      progress: async (text: string) => {
        await progressUpdate(ctx.telegram, progressMsg.chat.id, progressMsg.message_id, text);
      }
    });
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    await ctx.reply(
      `✅ הייבוא הסתיים. נוצרו: ${result.created} · שגיאות: ${result.errors} · סך הכל: ${result.total}`
    );
    await ctx.scene.leave();
  } catch (err) {
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ייבוא נכשל: ${message.slice(0, 300)}`);
  }
}

async function rerunAiOnly(ctx: BotContext, state: NewPlaylistWizardState): Promise<void> {
  if (!state.fetchedVideos || !state.playlistId || !state.jobId || !state.shortJobId) {
    await ctx.reply('❌ חסרים נתונים לריצה מחדש.');
    return;
  }
  const userId = ctx.from!.id;
  let job;
  try {
    job = JobManager.start(userId, 'rerun', state.jobId, state.shortJobId);
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${m}`);
    return;
  }
  void job;
  const progressMsg = await ctx.reply('🤔 ניתוח AI מחדש...');
  registerProgressTarget(progressMsg.chat.id, progressMsg.message_id);

  const constraints: UserConstraints = {
    category: state.category ?? '',
    subCategories: state.subCategories ?? '',
    lessonGroups: state.lessonGroups ?? '',
    rabbis: state.rabbis ?? ''
  };

  const procCtx: ProcessingContext = {
    jobId: state.jobId,
    userId,
    outputDir: jobsDir(userId),
    log: (text: string) => logger.info({ jobId: state.jobId }, text),
    progress: async (text: string) => {
      await progressUpdate(ctx.telegram, progressMsg.chat.id, progressMsg.message_id, text);
    },
    askInteractive: async (prompt) => {
      const j = JobManager.get(userId);
      if (!j) throw new Error('No active job');
      const itemIdx = j.pendingDialogs.size;
      if (prompt.type === 'OUT_OF_SCOPE') {
        const subs = prompt.subCategories.split(',').map((s) => s.trim()).filter(Boolean);
        const groups = prompt.lessonGroups.split(',').map((s) => s.trim()).filter(Boolean);
        const rabbis = prompt.rabbis.split(',').map((s) => s.trim()).filter(Boolean);
        const options = subs.map((sub, idx) => ({
          label: sub,
          optIdx: idx,
          subCategory: sub,
          lessonGroup: groups[0] ?? null,
          rabbi: rabbis[0] ?? ''
        }));
        registerDialog({
          shortJobId: j.shortId,
          itemIdx,
          type: 'OUT_OF_SCOPE',
          options: options.map((o) => ({
            subCategory: o.subCategory,
            lessonGroup: o.lessonGroup,
            rabbi: o.rabbi
          })),
          videoTitle: prompt.videoTitle
        });
        await ctx.reply(
          `⚠️ ${prompt.videoTitle}`,
          buildOutOfScopeKeyboard(j.shortId, itemIdx, options)
        );
      } else {
        registerDialog({
          shortJobId: j.shortId,
          itemIdx,
          type: 'NEW_SUBCATEGORY_NEEDED',
          options: [
            {
              subCategory: prompt.suggestedSubCategory,
              lessonGroup: prompt.suggestedLessonGroup ?? null,
              rabbi: ''
            }
          ],
          suggested: {
            subCategory: prompt.suggestedSubCategory,
            lessonGroup: prompt.suggestedLessonGroup
          },
          videoTitle: prompt.videoTitle
        });
        await ctx.reply(
          `🆕 ${prompt.videoTitle} → ${prompt.suggestedSubCategory}`,
          buildNewSubCategoryKeyboard(j.shortId, itemIdx)
        );
      }
      return JobManager.awaitDialog(userId, String(itemIdx));
    },
    isAborted: () => JobManager.isAborted(userId)
  };

  try {
    const result = await runProcessor({
      constraints,
      customInstructions: state.customInstructions ?? null,
      playlistId: state.playlistId,
      cachedVideos: state.fetchedVideos,
      ctx: procCtx
    });
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    JobManager.finish(userId);
    if (!result) {
      await ctx.reply('אין שיעורים מאושרים אחרי הריצה.');
      return;
    }
    state.approvedVideos = result.data;
    await saveJob(userId, state.jobId, result.data);
    await replyCorrectionMenu(ctx, state);
  } catch (err) {
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    JobManager.finish(userId);
    const m = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${m.slice(0, 300)}`);
  }
}

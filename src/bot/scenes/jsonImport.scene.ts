import { Scenes, Markup } from 'telegraf';
import path from 'path';
import type { BotContext, JsonImportSceneState } from '../context';
import { downloadDocument } from '../../util/telegram';
import { uploadsDir } from '../../storage/paths';
import { shortJobId } from '../../util/shortId';
import { createStrapiClient } from '../../core/strapi';
import { analyzeImport, executeImport, ENTITY_ORDER } from '../../core/comparator';
import type { AnalyzeReport, DecisionsMap } from '../../core/comparator';
import { logger } from '../../logger';
import {
  registerProgressTarget,
  clearProgressTarget,
  progressUpdate
} from '../ui/progress';

export const JSON_IMPORT_SCENE_ID = 'json-import-scene';

const reportStore = new Map<string, AnalyzeReport>();
const decisionsStore = new Map<string, DecisionsMap>();

function getState(ctx: BotContext): JsonImportSceneState {
  return ctx.scene.state as JsonImportSceneState;
}

export const jsonImportScene = new Scenes.BaseScene<BotContext>(JSON_IMPORT_SCENE_ID);

jsonImportScene.enter(async (ctx) => {
  const state = getState(ctx);
  state.jobShortId = shortJobId();
  state.publishMode = 'publish';
  state.allowUpdates = false;
  await ctx.reply(
    '📤 *ייבוא JSON ל-Strapi*\nשלח לי קובץ JSON עם רשימת שיעורים.\n/cancel לביטול.',
    { parse_mode: 'Markdown' }
  );
});

jsonImportScene.on('document', async (ctx) => {
  const state = getState(ctx);
  const doc = ctx.message.document;
  if (!doc.file_name?.endsWith('.json')) {
    await ctx.reply('❌ יש לשלוח קובץ JSON.');
    return;
  }
  const userId = ctx.from!.id;
  const dest = await downloadDocument(
    ctx,
    doc.file_id,
    uploadsDir(userId),
    `${state.jobShortId}-${doc.file_name}`
  );
  state.uploadedFilePath = dest;

  await ctx.reply('🔄 מנתח את הקובץ מול Strapi...');
  try {
    const client = createStrapiClient({ onLog: (text) => logger.info(text) });
    const report = await analyzeImport(dest, client, (text) => logger.info(text));
    reportStore.set(state.jobShortId!, report);
    decisionsStore.set(state.jobShortId!, {});
    state.reportSummary = {
      ...report.totals,
      total: report.videoCount
    };

    let summary = `📊 *סיכום השוואה*\nקובץ: ${path.basename(dest)}\nשיעורים: ${report.videoCount}\n`;
    for (const key of ENTITY_ORDER) {
      const e = report.entities[key];
      const counts = { new: 0, existing: 0, conflict: 0 };
      for (const r of e.rows) counts[r.status]++;
      summary += `\n*${key}*: 🆕 ${counts.new} · ✅ ${counts.existing} · ⚠️ ${counts.conflict}`;
    }
    summary += '\n\nאיך להמשיך?';
    await ctx.reply(summary, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback(
            `מצב פרסום: ${state.publishMode === 'publish' ? '🌐 פרסום' : '📝 טיוטה'}`,
            `imp:${state.jobShortId}:tog:pub`
          )
        ],
        [
          Markup.button.callback(
            `אפשר עדכון פריטים קיימים: ${state.allowUpdates ? '✅' : '⬜'}`,
            `imp:${state.jobShortId}:tog:upd`
          )
        ],
        [Markup.button.callback('🚀 בצע ייבוא', `imp:${state.jobShortId}:run`)],
        [Markup.button.callback('❌ בטל', `imp:${state.jobShortId}:cnl`)]
      ])
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ נכשל ניתוח: ${message.slice(0, 300)}`);
  }
});

jsonImportScene.action(/^imp:([\w]+):tog:(pub|upd)$/, async (ctx) => {
  const state = getState(ctx);
  const which = (ctx.match as RegExpMatchArray)[2];
  if (which === 'pub') state.publishMode = state.publishMode === 'publish' ? 'draft' : 'publish';
  if (which === 'upd') state.allowUpdates = !state.allowUpdates;
  await ctx.answerCbQuery(
    which === 'pub'
      ? `מצב: ${state.publishMode}`
      : `עדכון: ${state.allowUpdates ? 'מאופשר' : 'כבוי'}`
  );
  // Re-render the inline keyboard
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [
        {
          text: `מצב פרסום: ${state.publishMode === 'publish' ? '🌐 פרסום' : '📝 טיוטה'}`,
          callback_data: `imp:${state.jobShortId}:tog:pub`
        }
      ],
      [
        {
          text: `אפשר עדכון פריטים קיימים: ${state.allowUpdates ? '✅' : '⬜'}`,
          callback_data: `imp:${state.jobShortId}:tog:upd`
        }
      ],
      [{ text: '🚀 בצע ייבוא', callback_data: `imp:${state.jobShortId}:run` }],
      [{ text: '❌ בטל', callback_data: `imp:${state.jobShortId}:cnl` }]
    ]
  }).catch(() => undefined);
});

jsonImportScene.action(/^imp:([\w]+):cnl$/, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  await ctx.reply('בוטל.');
  await ctx.scene.leave();
});

jsonImportScene.action(/^imp:([\w]+):run$/, async (ctx) => {
  const state = getState(ctx);
  const report = reportStore.get(state.jobShortId!);
  const decisions = decisionsStore.get(state.jobShortId!) ?? {};
  if (!report) {
    await ctx.answerCbQuery('דוח אבד');
    return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  const progressMsg = await ctx.reply('🚀 מתחיל ייבוא...');
  registerProgressTarget(progressMsg.chat.id, progressMsg.message_id);
  try {
    const client = createStrapiClient({ onLog: (text) => logger.info(text) });
    const summary = await executeImport(report, decisions, client, {
      publishMode: state.publishMode ?? 'publish',
      allowUpdates: state.allowUpdates ?? false,
      log: (text: string) => logger.info(text),
      progress: async (text: string) => {
        await progressUpdate(ctx.telegram, progressMsg.chat.id, progressMsg.message_id, text);
      }
    });
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    await ctx.reply(
      `✅ סיום\n• נוצרו: ${summary.created}\n• עודכנו: ${summary.updated}\n• מופו: ${summary.mapped}\n• דולגו: ${summary.skipped}\n• שגיאות: ${summary.errors}`
    );
    reportStore.delete(state.jobShortId!);
    decisionsStore.delete(state.jobShortId!);
    await ctx.scene.leave();
  } catch (err) {
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${message.slice(0, 300)}`);
  }
});

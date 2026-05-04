import path from 'path';
import { Scenes, Markup } from 'telegraf';
import type { BotContext, NewPlaylistWizardState } from '../context';
import { extractPlaylistId } from '../../core/youtube';
import { longJobId, shortJobId } from '../../util/shortId';
import { JobManager } from '../../core/jobManager';
import { logger } from '../../logger';
import { ensureUserDirs, jobsDir } from '../../storage/paths';
import {
  buildPreChatStartKeyboard,
  buildPreChatFinishKeyboard,
  buildConfirmRunKeyboard,
  buildCorrectionsKeyboard
} from '../keyboards/corrections';
import { runProcessor } from '../../core/processor';
import { consultChat, extractCustomInstructions } from '../../core/gemini';
import { saveJob } from '../../storage/jobStore';
import { appendHistoryEntry } from '../../storage/history';
import { buildSummaryReport } from '../ui/format';
import { splitForTelegram } from '../ui/chunker';
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
import type {
  ProcessingContext,
  ProcessedVideo,
  Video,
  CustomInstructions,
  UserConstraints
} from '../../core/types';

export const NEW_PLAYLIST_WIZARD_ID = 'new-playlist-wizard';

function getState(ctx: BotContext): NewPlaylistWizardState {
  return ctx.scene.state as NewPlaylistWizardState;
}

export const newPlaylistWizard = new Scenes.WizardScene<BotContext>(
  NEW_PLAYLIST_WIZARD_ID,

  // Step 0 — receive playlist URL/ID
  async (ctx) => {
    if (!('text' in (ctx.message ?? {}))) return;
    const text = (ctx.message as { text: string }).text;
    const playlistId = extractPlaylistId(text);
    if (!playlistId) {
      await ctx.reply('❌ לא הצלחתי לחלץ מזהה פלייליסט. נסה שוב.');
      return;
    }
    getState(ctx).playlistId = playlistId;
    await ctx.reply('מהי הקטגוריה הראשית? (לדוגמה: הלכות חגים)');
    return ctx.wizard.next();
  },

  // Step 1 — receive main category
  async (ctx) => {
    if (!('text' in (ctx.message ?? {}))) return;
    getState(ctx).category = (ctx.message as { text: string }).text.trim();
    await ctx.reply('תתי-קטגוריות מותרות, מופרדות בפסיקים. (לדוגמה: סוכה, פסח, חנוכה)');
    return ctx.wizard.next();
  },

  // Step 2 — receive sub-categories
  async (ctx) => {
    if (!('text' in (ctx.message ?? {}))) return;
    getState(ctx).subCategories = (ctx.message as { text: string }).text.trim();
    await ctx.reply(
      'קבוצות שיעור (אופציונלי) — מופרדות בפסיקים. אם אין, שלח /skip.'
    );
    return ctx.wizard.next();
  },

  // Step 3 — receive lesson groups (or /skip)
  async (ctx) => {
    if (!('text' in (ctx.message ?? {}))) return;
    const text = (ctx.message as { text: string }).text.trim();
    getState(ctx).lessonGroups = text === '/skip' ? '' : text;
    await ctx.reply('רבנים בפלייליסט — מופרדים בפסיקים. (לדוגמה: ר׳ דוד כהן, ר׳ משה טוב)');
    return ctx.wizard.next();
  },

  // Step 4 — receive rabbis, then offer pre-chat
  async (ctx) => {
    if (!('text' in (ctx.message ?? {}))) return;
    getState(ctx).rabbis = (ctx.message as { text: string }).text.trim();
    await ctx.reply(
      'האם תרצה לשתף עם ה-AI הנחיות מיוחדות לסדרה הזו? (לדוגמה: פלייליסט פרשת שבוע ללא סימנים, סדר לפי חומשים)',
      buildPreChatStartKeyboard()
    );
    return ctx.wizard.next();
  },

  // Step 5 — placeholder; handled by action handlers (pre:*, run:*) and the
  // scene-level .on('text') handler below for pre-chat / dialogs / per-item edit.
  // CRITICAL: must call next() so that global handlers registered on the bot
  // (cor:*, fld:*, aiq:*) can fire while the user is still in the scene.
  async (_ctx, next) => {
    return next();
  }
);

// Initial prompt sent when the user enters the wizard.
// In telegraf 4.x WizardScene does NOT auto-run step 0 on enter, so we send
// the first prompt here.
newPlaylistWizard.enter(async (ctx) => {
  const state = getState(ctx);
  state.jobId = longJobId();
  state.shortJobId = shortJobId();
  await ctx.reply(
    '🎬 פלייליסט חדש\n\n' +
      'שלח לי קישור או מזהה פלייליסט יוטיוב.\n' +
      'דוגמה: https://www.youtube.com/playlist?list=PLxxxxxx\n\n' +
      'אפשר לבטל בכל שלב עם /cancel.'
  );
});

newPlaylistWizard.action('pre:start', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.callbackQuery?.message)
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  const state = getState(ctx);
  state.preChat = { messages: [] };
  const constraints = constraintsFromState(state);
  try {
    const opener = await consultChat([], 'התחל בשיחה', constraints);
    state.preChat.messages.push({ role: 'assistant', text: opener });
    await ctx.reply(opener);
    await ctx.reply('כתוב תשובה. כשתסיים, לחץ על הכפתור.', buildPreChatFinishKeyboard());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'pre-chat opener failed');
    await ctx.reply(
      `❌ Gemini החזיר שגיאה:\n\`${message.slice(0, 400)}\`\n\n` +
        'בדיקות שאפשר לעשות:\n' +
        '• ודא ש-`GEMINI_MODEL` ב-`.env` הוא שם תקף (לדוגמה `gemini-2.5-flash-lite-preview` או `gemini-flash-latest`).\n' +
        '• ודא ש-`GEMINI_API_KEY` תקף וב-aistudio.google.com פעיל.\n' +
        '• בדוק את הלוג בטרמינל ל-stack מלא.\n\n' +
        'אפשר לדלג עם הכפתור "⏭ דלג והפעל" שהיה בשלב הקודם, או לסגור עם /cancel.',
      { parse_mode: 'Markdown' }
    );
  }
});

newPlaylistWizard.action('pre:skip', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.callbackQuery?.message)
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  const state = getState(ctx);
  state.customInstructions = null;
  await sendConfirmation(ctx);
});

newPlaylistWizard.action('pre:done', async (ctx) => {
  await ctx.answerCbQuery();
  if (ctx.callbackQuery?.message)
    await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  const state = getState(ctx);
  if (!state.preChat || state.preChat.messages.length === 0) {
    state.customInstructions = null;
    await sendConfirmation(ctx);
    return;
  }
  await ctx.reply('🤔 מנתח את השיחה ובונה הוראות AI...');
  try {
    const ci = await extractCustomInstructions(state.preChat.messages);
    state.customInstructions = ci;
    await ctx.reply(
      `הבנתי:\n• ${ci.summary}\n• סימנים: ${ci.hasSimanim ? 'כן' : 'לא'}\n• מיון: ${ci.sortBy ?? 'ברירת מחדל'}` +
        (ci.customSubCategoryRules ? `\n• כללי תת-קטגוריה: ${ci.customSubCategoryRules}` : '')
    );
  } catch (err) {
    logger.error({ err }, 'extract instructions failed');
    state.customInstructions = null;
    await ctx.reply('⚠️ לא הצלחתי לחלץ הוראות מובנות, אמשיך בלי הנחיות מותאמות.');
  }
  await sendConfirmation(ctx);
});

// Out-of-band text handler: handles pre-chat replies, OOS/NSC text input,
// and per-item edit input. CRITICAL: must call next() when none of the
// branches match, otherwise the wizard step handler never runs and the
// wizard freezes silently.
newPlaylistWizard.on('text', async (ctx, next) => {
  const state = getState(ctx);

  // Inside pre-chat?
  if (state.preChat) {
    const userText = ctx.message.text;
    state.preChat.messages.push({ role: 'user', text: userText });
    try {
      const reply = await consultChat(
        state.preChat.messages.slice(0, -1),
        userText,
        constraintsFromState(state)
      );
      state.preChat.messages.push({ role: 'assistant', text: reply });
      await ctx.reply(reply);
      if (reply.includes('אני מוכן')) {
        await ctx.reply('סיימת? לחץ לסיום.', buildPreChatFinishKeyboard());
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'pre-chat reply failed');
      await ctx.reply(
        `❌ Gemini שגיאה: \`${message.slice(0, 300)}\`\nאפשר ללחוץ "סיים והמשך" או /cancel.`,
        { parse_mode: 'Markdown' }
      );
    }
    return;
  }

  // Pending interactive dialog text input?
  const pdr = state.pendingDialogResolution;
  if (pdr) {
    await handleDialogTextInput(ctx, ctx.message.text);
    return;
  }

  // Pending per-item edit?
  const pie = state.pendingItemEdit;
  if (pie && pie.index === undefined) {
    const idx = parseInt(ctx.message.text, 10) - 1;
    if (Number.isNaN(idx) || !state.approvedVideos || idx < 0 || idx >= state.approvedVideos.length) {
      await ctx.reply('❌ מספר לא תקין. נסה שוב.');
      return;
    }
    pie.index = idx;
    const { buildItemFieldKeyboard } = await import('../keyboards/corrections');
    await ctx.reply(
      `עריכת פריט #${idx + 1}: ${state.approvedVideos[idx].lessonTitle}\nאיזה שדה לערוך?`,
      buildItemFieldKeyboard(state.shortJobId!, idx)
    );
    return;
  }
  if (pie && pie.field) {
    if (state.approvedVideos && pie.index !== undefined) {
      const newVal = ctx.message.text.trim();
      const item = state.approvedVideos[pie.index] as unknown as Record<string, unknown>;
      if (pie.field === 'order') {
        const num = parseInt(newVal, 10);
        if (Number.isNaN(num)) {
          await ctx.reply('❌ ערך לא תקין למספר.');
          return;
        }
        item[pie.field] = num;
      } else {
        item[pie.field] = newVal;
      }
      state.pendingItemEdit = undefined;
      await ctx.reply(`✏️ עודכן.`);
      await replyCorrectionMenu(ctx, state);
    }
    return;
  }

  // No out-of-band state matched — let the wizard step handler run.
  return next();
});

newPlaylistWizard.action('run:abort', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  await ctx.reply('בוטל. /new להתחלה חדשה.');
  await ctx.scene.leave();
});

newPlaylistWizard.action('run:go', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  await runJob(ctx);
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function constraintsFromState(state: NewPlaylistWizardState): UserConstraints {
  return {
    category: state.category ?? '',
    subCategories: state.subCategories ?? '',
    lessonGroups: state.lessonGroups ?? '',
    rabbis: state.rabbis ?? ''
  };
}

async function sendConfirmation(ctx: BotContext): Promise<void> {
  const state = getState(ctx);
  const ci = state.customInstructions;
  const lines = [
    '📋 *סיכום הגדרות*',
    `• פלייליסט: \`${state.playlistId}\``,
    `• קטגוריה ראשית: ${state.category}`,
    `• תת-קטגוריות: ${state.subCategories}`,
    `• קבוצות: ${state.lessonGroups || '(אין)'}`,
    `• רבנים: ${state.rabbis}`
  ];
  if (ci) {
    lines.push(`• הנחיות: ${ci.summary || '(אין סיכום)'}`);
    lines.push(`  סימנים: ${ci.hasSimanim ? 'כן' : 'לא'}`);
    if (ci.sortBy) lines.push(`  מיון: ${ci.sortBy}`);
  }
  await ctx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    ...buildConfirmRunKeyboard()
  });
}

async function runJob(ctx: BotContext): Promise<void> {
  const state = getState(ctx);
  const userId = ctx.from!.id;
  if (!state.jobId || !state.shortJobId || !state.playlistId) {
    await ctx.reply('❌ חסרים פרטים — הפעל /new מחדש.');
    return;
  }

  let job;
  try {
    job = JobManager.start(userId, NEW_PLAYLIST_WIZARD_ID, state.jobId, state.shortJobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${message}`);
    return;
  }

  await ensureUserDirs(userId);
  const progressMsg = await ctx.reply('🚀 מתחיל לעבד...');
  registerProgressTarget(progressMsg.chat.id, progressMsg.message_id);
  JobManager.setProgressMessage(userId, progressMsg.chat.id, progressMsg.message_id);

  const procCtx: ProcessingContext = {
    jobId: state.jobId,
    userId,
    outputDir: jobsDir(userId),
    log: (text: string) => logger.info({ jobId: state.jobId }, text),
    progress: async (text: string) => {
      await progressUpdate(ctx.telegram, progressMsg.chat.id, progressMsg.message_id, text);
    },
    askInteractive: (prompt) => askInteractiveOnTelegram(ctx, state, prompt),
    isAborted: () => JobManager.isAborted(userId)
  };

  try {
    const result = await runProcessor({
      constraints: constraintsFromState(state),
      customInstructions: state.customInstructions ?? null,
      playlistId: state.playlistId,
      cachedVideos: state.fetchedVideos,
      ctx: procCtx
    });

    if (!result) {
      clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
      JobManager.finish(userId);
      await ctx.reply(JobManager.isAborted(userId) ? '⛔ העיבוד בוטל.' : 'אין שיעורים לאישור.');
      await ctx.scene.leave();
      return;
    }

    state.fetchedVideos = result.videos;
    state.approvedVideos = result.data;

    await saveJob(userId, state.jobId, result.data);
    await appendHistoryEntry(userId, {
      jobId: state.jobId,
      playlistId: state.playlistId,
      category: state.category ?? '',
      totalVideos: result.data.length,
      status: result.aborted ? 'aborted' : 'completed',
      completedAt: Date.now(),
      jobFile: path.basename(result.outputPath)
    });

    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    JobManager.finish(userId);

    await replyCorrectionMenu(ctx, state);
  } catch (err) {
    clearProgressTarget(progressMsg.chat.id, progressMsg.message_id);
    JobManager.finish(userId);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId: state.jobId }, 'job failed');
    if (message === 'aborted') {
      await ctx.reply('⛔ העיבוד בוטל לפי בקשה.');
    } else {
      await ctx.reply(`❌ שגיאה: ${message.slice(0, 300)}`);
    }
    await ctx.scene.leave();
  }
}

async function askInteractiveOnTelegram(
  ctx: BotContext,
  state: NewPlaylistWizardState,
  prompt: import('../../core/types').InteractiveDialogPayload
): Promise<import('../../core/types').DialogResponse> {
  const userId = ctx.from!.id;
  const job = JobManager.get(userId);
  if (!job) throw new Error('No active job');
  const itemIdx = job.pendingDialogs.size; // monotonic counter for unique key
  const dialogKey = String(itemIdx);

  if (prompt.type === 'OUT_OF_SCOPE') {
    const subs = prompt.subCategories
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const rabbis = prompt.rabbis
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const groups = prompt.lessonGroups
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const options = subs.map((sub, idx) => ({
      label: sub,
      optIdx: idx,
      subCategory: sub,
      lessonGroup: groups[0] ?? null,
      rabbi: rabbis[0] ?? ''
    }));
    registerDialog({
      shortJobId: job.shortId,
      itemIdx,
      type: 'OUT_OF_SCOPE',
      options: options.map((o) => ({
        subCategory: o.subCategory,
        lessonGroup: o.lessonGroup,
        rabbi: o.rabbi
      })),
      videoTitle: prompt.videoTitle
    });
    const text =
      `⚠️ סרטון מחוץ לתחום\n"${prompt.videoTitle}"\n\nאיך לטפל?\n` +
      `קטגוריה: ${prompt.category}`;
    await ctx.reply(text, buildOutOfScopeKeyboard(job.shortId, itemIdx, options));
  } else {
    registerDialog({
      shortJobId: job.shortId,
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
    const text =
      `🆕 דרושה תת-קטגוריה חדשה\n"${prompt.videoTitle}"\n\n` +
      `הצעה: ${prompt.suggestedSubCategory}` +
      (prompt.suggestedLessonGroup ? `\nקבוצה: ${prompt.suggestedLessonGroup}` : '');
    await ctx.reply(text, buildNewSubCategoryKeyboard(job.shortId, itemIdx));
  }

  return JobManager.awaitDialog(userId, dialogKey);
}

export async function replyCorrectionMenu(
  ctx: BotContext,
  state: NewPlaylistWizardState
): Promise<void> {
  if (!state.approvedVideos || !state.shortJobId) return;
  const summary = buildSummaryReport(state.approvedVideos);
  const parts = splitForTelegram(summary);
  for (const part of parts) await ctx.reply(part);
  await ctx.reply(
    'מה תרצה לעשות?',
    buildCorrectionsKeyboard(state.shortJobId, (state.history?.length ?? 0) > 0)
  );
}

async function handleDialogTextInput(ctx: BotContext, text: string): Promise<void> {
  const state = getState(ctx);
  const pdr = state.pendingDialogResolution;
  if (!pdr) return;
  pdr.collected = pdr.collected ?? {};
  if (pdr.field === 'subCategory') {
    pdr.collected.subCategory = text.trim();
    pdr.field = 'lessonGroup';
    await ctx.reply('שם קבוצת שיעור (או "—" לדלג):');
    return;
  }
  if (pdr.field === 'lessonGroup') {
    const trimmed = text.trim();
    pdr.collected.lessonGroup = trimmed === '—' || trimmed === '-' ? null : trimmed;
    pdr.field = 'rabbi';
    await ctx.reply('שם הרב:');
    return;
  }
  if (pdr.field === 'rabbi') {
    pdr.collected.rabbi = text.trim();
    const userId = ctx.from!.id;
    JobManager.resolveDialog(userId, pdr.dialogKey, {
      action: 'assign',
      subCategory: pdr.collected.subCategory!,
      lessonGroup: pdr.collected.lessonGroup ?? null,
      rabbi: pdr.collected.rabbi
    });
    state.pendingDialogResolution = undefined;
    await ctx.reply('✅ נקלט. ממשיך בעיבוד...');
  }
}

// Type guard helper consumed by other files
export type _ProcessedVideoRef = ProcessedVideo;
export type _VideoRef = Video;
export type _CIRef = CustomInstructions;

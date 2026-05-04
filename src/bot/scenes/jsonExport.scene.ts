import fs from 'fs/promises';
import path from 'path';
import { Scenes, Markup, Input } from 'telegraf';
import type { BotContext, JsonExportSceneState } from '../context';
import { createStrapiClient } from '../../core/strapi';
import { fetchFilteredLessons, buildDefaultFilename } from '../../core/exporter';
import { uploadsDir, ensureUserDirs } from '../../storage/paths';
import { logger } from '../../logger';

export const JSON_EXPORT_SCENE_ID = 'json-export-scene';

function getState(ctx: BotContext): JsonExportSceneState {
  return ctx.scene.state as JsonExportSceneState;
}

export const jsonExportScene = new Scenes.BaseScene<BotContext>(JSON_EXPORT_SCENE_ID);

jsonExportScene.enter(async (ctx) => {
  getState(ctx).filters = {};
  await renderMenu(ctx);
});

async function renderMenu(ctx: BotContext): Promise<void> {
  const state = getState(ctx);
  const f = state.filters ?? {};
  await ctx.reply(
    '🔍 *ייצוא מ-Strapi*\nבחר פילטרים (כל אחד אופציונלי):',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(`קטגוריה: ${f.category ?? '—'}`, 'exp:set:category')],
        [Markup.button.callback(`תת-קטגוריה: ${f.subCategory ?? '—'}`, 'exp:set:subCategory')],
        [Markup.button.callback(`קבוצה: ${f.lessonGroup ?? '—'}`, 'exp:set:lessonGroup')],
        [Markup.button.callback(`רב: ${f.rabbi ?? '—'}`, 'exp:set:rabbi')],
        [
          Markup.button.callback('🧹 נקה פילטרים', 'exp:clr'),
          Markup.button.callback('💾 שלוף וייצא', 'exp:run')
        ],
        [Markup.button.callback('❌ בטל', 'exp:cnl')]
      ])
    }
  );
}

jsonExportScene.action(/^exp:set:(category|subCategory|lessonGroup|rabbi)$/, async (ctx) => {
  const which = (ctx.match as RegExpMatchArray)[1] as
    | 'category'
    | 'subCategory'
    | 'lessonGroup'
    | 'rabbi';
  getState(ctx).promptingField = which;
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  await ctx.reply(`הזן ערך עבור ${which} (או "—" לאיפוס):`);
});

jsonExportScene.on('text', async (ctx) => {
  const state = getState(ctx);
  if (!state.promptingField) return;
  const value = ctx.message.text.trim();
  state.filters = state.filters ?? {};
  if (value === '—' || value === '-') {
    delete state.filters[state.promptingField];
  } else {
    state.filters[state.promptingField] = value;
  }
  state.promptingField = undefined;
  await renderMenu(ctx);
});

jsonExportScene.action('exp:clr', async (ctx) => {
  getState(ctx).filters = {};
  await ctx.answerCbQuery('נוקה');
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  await renderMenu(ctx);
});

jsonExportScene.action('exp:cnl', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  await ctx.reply('בוטל.');
  await ctx.scene.leave();
});

jsonExportScene.action('exp:run', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);
  const state = getState(ctx);
  const filters = state.filters ?? {};
  await ctx.reply('🔍 שולף מ-Strapi...');
  try {
    const client = createStrapiClient({ onLog: (text) => logger.info(text) });
    const { lessons, warnings } = await fetchFilteredLessons(
      client,
      filters,
      (text) => logger.info(text)
    );
    if (lessons.length === 0) {
      await ctx.reply('לא נמצאו שיעורים לפי הפילטרים.');
      await ctx.scene.leave();
      return;
    }
    const userId = ctx.from!.id;
    await ensureUserDirs(userId);
    const filename = buildDefaultFilename(filters);
    const filepath = path.join(uploadsDir(userId), filename);
    await fs.writeFile(filepath, JSON.stringify(lessons, null, 2), 'utf-8');
    await ctx.replyWithDocument(Input.fromLocalFile(filepath, filename));
    if (warnings.length > 0) {
      await ctx.reply(`⚠️ ${warnings.length} אזהרות במהלך המיפוי (פרטים בלוג).`);
    }
    await ctx.reply(`✅ נמשכו ${lessons.length} שיעורים.`);
    await ctx.scene.leave();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(`❌ ${message.slice(0, 300)}`);
  }
});

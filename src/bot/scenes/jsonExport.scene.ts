import fs from 'fs/promises';
import path from 'path';
import { Scenes, Markup, Input } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import type { BotContext, JsonExportSceneState } from '../context';
import { createStrapiClient } from '../../core/strapi';
import { fetchFilteredLessons, buildDefaultFilename } from '../../core/exporter';
import {
  listCategories,
  listSubCategoriesByCategory,
  listLessonGroupsBySubCategory,
  listRabbis
} from '../../core/strapi-options';
import { uploadsDir, ensureUserDirs } from '../../storage/paths';
import { logger } from '../../logger';

export const JSON_EXPORT_SCENE_ID = 'json-export-scene';

type FilterField = 'category' | 'subCategory' | 'lessonGroup' | 'rabbi';
type ShortField = 'cat' | 'sub' | 'grp' | 'rab';

const FIELD_TO_SHORT: Record<FilterField, ShortField> = {
  category: 'cat',
  subCategory: 'sub',
  lessonGroup: 'grp',
  rabbi: 'rab'
};
const SHORT_TO_FIELD: Record<ShortField, FilterField> = {
  cat: 'category',
  sub: 'subCategory',
  grp: 'lessonGroup',
  rab: 'rabbi'
};
const FIELD_LABEL: Record<FilterField, string> = {
  category: 'קטגוריה',
  subCategory: 'תת-קטגוריה',
  lessonGroup: 'קבוצה',
  rabbi: 'רב'
};

// Per-user store of the most recently fetched options for a field, so we can
// resolve callback_data indices to the actual string values without sending
// long Hebrew text through callback_data (64-byte limit).
const optionsStore = new Map<string, string[]>();

function optionsKey(userId: number, field: ShortField): string {
  return `${userId}:${field}`;
}

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
  await ctx.reply('🔍 *ייצוא מ-Strapi*\nבחר פילטרים (כל אחד אופציונלי):', {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard([
      [Markup.button.callback(`${FIELD_LABEL.category}: ${f.category ?? '—'}`, 'exp:set:category')],
      [
        Markup.button.callback(
          `${FIELD_LABEL.subCategory}: ${f.subCategory ?? '—'}`,
          'exp:set:subCategory'
        )
      ],
      [
        Markup.button.callback(
          `${FIELD_LABEL.lessonGroup}: ${f.lessonGroup ?? '—'}`,
          'exp:set:lessonGroup'
        )
      ],
      [Markup.button.callback(`${FIELD_LABEL.rabbi}: ${f.rabbi ?? '—'}`, 'exp:set:rabbi')],
      [
        Markup.button.callback('🧹 נקה פילטרים', 'exp:clr'),
        Markup.button.callback('💾 שלוף וייצא', 'exp:run')
      ],
      [Markup.button.callback('❌ בטל', 'exp:cnl')]
    ])
  });
}

function truncate(s: string, max = 30): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function buildOptionsKeyboard(
  field: ShortField,
  options: string[]
): { reply_markup: InlineKeyboardMarkup } {
  const rows = options.map((opt, idx) => [
    Markup.button.callback(truncate(opt), `exp:pick:${field}:${idx}`)
  ]);
  rows.push([
    Markup.button.callback('— נקה פילטר זה', `exp:pick:${field}:any`),
    Markup.button.callback('🔍 הקלד חופשי', `exp:pick:${field}:txt`)
  ]);
  rows.push([Markup.button.callback('↩ חזור', `exp:pick:${field}:back`)]);
  return Markup.inlineKeyboard(rows);
}

jsonExportScene.action(/^exp:set:(category|subCategory|lessonGroup|rabbi)$/, async (ctx) => {
  const field = (ctx.match as RegExpMatchArray)[1] as FilterField;
  const short = FIELD_TO_SHORT[field];
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);

  await ctx.reply('🔄 טוען אפשרויות מ-Strapi...');
  let options: string[];
  try {
    const state = getState(ctx);
    const filters = state.filters ?? {};
    const client = createStrapiClient({ onLog: (text) => logger.info(text) });
    if (field === 'category') options = await listCategories(client);
    else if (field === 'subCategory')
      options = await listSubCategoriesByCategory(client, filters.category);
    else if (field === 'lessonGroup')
      options = await listLessonGroupsBySubCategory(client, filters.subCategory);
    else options = await listRabbis(client);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.reply(
      `❌ נכשל לטעון אפשרויות: ${message.slice(0, 200)}\nאפשר להזין ערך חופשי בטקסט.`
    );
    getState(ctx).promptingField = field;
    return;
  }

  const userId = ctx.from!.id;
  optionsStore.set(optionsKey(userId, short), options);

  if (options.length === 0) {
    const parentNote =
      field === 'subCategory'
        ? ' (לפי הקטגוריה הנוכחית)'
        : field === 'lessonGroup'
          ? ' (לפי תת-הקטגוריה הנוכחית)'
          : '';
    await ctx.reply(
      `אין אפשרויות זמינות${parentNote}. אפשר להזין ערך חופשי בטקסט (או "—" לאיפוס):`
    );
    getState(ctx).promptingField = field;
    return;
  }

  const headerLines: string[] = [`*${FIELD_LABEL[field]}* — בחר אופציה (${options.length}):`];
  if (field === 'subCategory' && getState(ctx).filters?.category) {
    headerLines.push(`_מסונן לפי קטגוריה: ${getState(ctx).filters!.category}_`);
  }
  if (field === 'lessonGroup' && getState(ctx).filters?.subCategory) {
    headerLines.push(`_מסונן לפי תת-קטגוריה: ${getState(ctx).filters!.subCategory}_`);
  }
  await ctx.reply(headerLines.join('\n'), {
    parse_mode: 'Markdown',
    ...buildOptionsKeyboard(short, options)
  });
});

jsonExportScene.action(/^exp:pick:(cat|sub|grp|rab):(.+)$/, async (ctx) => {
  const match = ctx.match as RegExpMatchArray;
  const short = match[1] as ShortField;
  const arg = match[2];
  const field = SHORT_TO_FIELD[short];
  const state = getState(ctx);
  state.filters = state.filters ?? {};

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => undefined);

  if (arg === 'back') {
    await renderMenu(ctx);
    return;
  }
  if (arg === 'any') {
    delete state.filters[field];
    resetDependentFilters(state, field);
    optionsStore.delete(optionsKey(ctx.from!.id, short));
    await ctx.reply(`✓ ${FIELD_LABEL[field]} נוקתה.`);
    await renderMenu(ctx);
    return;
  }
  if (arg === 'txt') {
    state.promptingField = field;
    await ctx.reply(`הזן ערך חופשי עבור ${FIELD_LABEL[field]} (או "—" לאיפוס):`);
    return;
  }
  const idx = Number(arg);
  if (!Number.isFinite(idx)) {
    await ctx.reply('בחירה לא תקפה.');
    await renderMenu(ctx);
    return;
  }
  const options = optionsStore.get(optionsKey(ctx.from!.id, short));
  if (!options || idx < 0 || idx >= options.length) {
    await ctx.reply('הרשימה פגה תוקף, נסה שוב.');
    await renderMenu(ctx);
    return;
  }
  state.filters[field] = options[idx];
  resetDependentFilters(state, field);
  await ctx.reply(`✓ ${FIELD_LABEL[field]}: ${options[idx]}`);
  await renderMenu(ctx);
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
  resetDependentFilters(state, state.promptingField);
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

function resetDependentFilters(state: JsonExportSceneState, changed: FilterField): void {
  if (!state.filters) return;
  if (changed === 'category') {
    delete state.filters.subCategory;
    delete state.filters.lessonGroup;
  } else if (changed === 'subCategory') {
    delete state.filters.lessonGroup;
  }
}

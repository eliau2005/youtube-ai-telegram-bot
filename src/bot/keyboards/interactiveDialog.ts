import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';

const MAX_OPTIONS_PER_ROW = 1;

interface DialogStoreEntry {
  shortJobId: string;
  itemIdx: number;
  type: 'OUT_OF_SCOPE' | 'NEW_SUBCATEGORY_NEEDED';
  options: { subCategory: string; lessonGroup: string | null; rabbi: string }[];
  suggested?: { subCategory: string; lessonGroup: string | null };
  videoTitle: string;
}

const dialogStore = new Map<string, DialogStoreEntry>();

function dialogKey(shortJobId: string, itemIdx: number): string {
  return `${shortJobId}:${itemIdx}`;
}

export function registerDialog(entry: DialogStoreEntry): void {
  dialogStore.set(dialogKey(entry.shortJobId, entry.itemIdx), entry);
}

export function getDialog(
  shortJobId: string,
  itemIdx: number
): DialogStoreEntry | undefined {
  return dialogStore.get(dialogKey(shortJobId, itemIdx));
}

export function clearDialog(shortJobId: string, itemIdx: number): void {
  dialogStore.delete(dialogKey(shortJobId, itemIdx));
}

export function buildOutOfScopeKeyboard(
  shortJobId: string,
  itemIdx: number,
  options: { label: string; optIdx: number }[]
): { reply_markup: InlineKeyboardMarkup } {
  const buttons = [];
  for (let i = 0; i < options.length; i += MAX_OPTIONS_PER_ROW) {
    const row = options.slice(i, i + MAX_OPTIONS_PER_ROW).map((o) =>
      Markup.button.callback(`📂 ${o.label}`, `aiq:${shortJobId}:${itemIdx}:oos:${o.optIdx}`)
    );
    buttons.push(row);
  }
  buttons.push([
    Markup.button.callback('➕ תת-קטגוריה חדשה', `aiq:${shortJobId}:${itemIdx}:new`),
    Markup.button.callback('⏭ דלג', `aiq:${shortJobId}:${itemIdx}:skp`)
  ]);
  return Markup.inlineKeyboard(buttons);
}

export function buildNewSubCategoryKeyboard(
  shortJobId: string,
  itemIdx: number
): { reply_markup: InlineKeyboardMarkup } {
  return Markup.inlineKeyboard([
    [Markup.button.callback('✅ אמץ הצעה', `aiq:${shortJobId}:${itemIdx}:nsc:0`)],
    [Markup.button.callback('✏️ ערוך', `aiq:${shortJobId}:${itemIdx}:edt`)],
    [Markup.button.callback('⏭ דלג', `aiq:${shortJobId}:${itemIdx}:skp`)]
  ]);
}

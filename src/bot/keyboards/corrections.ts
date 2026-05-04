import { Markup } from 'telegraf';
import type { InlineKeyboardMarkup } from 'telegraf/types';

export function buildCorrectionsKeyboard(
  shortJobId: string,
  hasHistory: boolean
): { reply_markup: InlineKeyboardMarkup } {
  const rows = [
    [
      Markup.button.callback('✅ אשר ופרסם', `cor:${shortJobId}:imp:pub`),
      Markup.button.callback('📝 אשר כטיוטה', `cor:${shortJobId}:imp:drf`)
    ],
    [
      Markup.button.callback('🧠 תיקון כללי', `cor:${shortJobId}:gen`),
      Markup.button.callback('✏️ ערוך פריט', `cor:${shortJobId}:edt`)
    ],
    [
      Markup.button.callback('💾 הורד JSON', `cor:${shortJobId}:dl`),
      Markup.button.callback('❌ בטל', `cor:${shortJobId}:cnl`)
    ]
  ];
  if (hasHistory) {
    rows.push([Markup.button.callback('↶ ביטול תיקון אחרון', `cor:${shortJobId}:undo`)]);
  }
  return Markup.inlineKeyboard(rows);
}

export function buildItemFieldKeyboard(
  shortJobId: string,
  itemIdx: number
): { reply_markup: InlineKeyboardMarkup } {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('כותרת השיעור', `fld:${shortJobId}:${itemIdx}:lessonTitle`),
      Markup.button.callback('קטגוריה', `fld:${shortJobId}:${itemIdx}:category`)
    ],
    [
      Markup.button.callback('תת-קטגוריה', `fld:${shortJobId}:${itemIdx}:subCategory`),
      Markup.button.callback('קבוצת שיעור', `fld:${shortJobId}:${itemIdx}:lessonGroup`)
    ],
    [
      Markup.button.callback('רב', `fld:${shortJobId}:${itemIdx}:rabbi`),
      Markup.button.callback('סדר', `fld:${shortJobId}:${itemIdx}:order`)
    ]
  ]);
}

export function buildPreChatStartKeyboard(): { reply_markup: InlineKeyboardMarkup } {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💬 כן, בוא נדבר', 'pre:start')],
    [Markup.button.callback('⏭ דלג והפעל', 'pre:skip')]
  ]);
}

export function buildPreChatFinishKeyboard(): { reply_markup: InlineKeyboardMarkup } {
  return Markup.inlineKeyboard([[Markup.button.callback('✅ סיים והמשך', 'pre:done')]]);
}

export function buildConfirmRunKeyboard(): { reply_markup: InlineKeyboardMarkup } {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🚀 הפעל', 'run:go')],
    [Markup.button.callback('❌ בטל', 'run:abort')]
  ]);
}

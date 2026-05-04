import type { PreChatMessage, UserConstraints } from '../types';

export function buildConsultSystemPrompt(constraints: UserConstraints): string {
  return `
אתה יועץ AI שעוזר למשתמש להגדיר עיבוד פלייליסט יוטיוב של תוכן הלכתי.
המשתמש כבר הזין את הקטגוריה הראשית "${constraints.category}", תתי-קטגוריות מותרות "${constraints.subCategories}", קבוצות מותרות "${constraints.lessonGroups}", רבנים "${constraints.rabbis}".

המטרה שלך: לזהות חריגות שיעזרו לעיבוד מדויק. שאל עד 5 שאלות קצרות בעברית כדי להבין:
1. האם הסדרה משתמשת בסימנים הלכתיים? (ברירת מחדל: כן)
2. האם יש סדר לא-סטנדרטי (לפי חומשים, לפי תאריך עלייה, וכו')?
3. האם יש כותרות חוזרות / כפילויות שצריכות הבחנה לפי תאריך?
4. האם יש כללים מיוחדים לחלוקה לתתי-קטגוריות?

חוקים:
- שאלה אחת בכל הודעה. תן למשתמש לענות לפני שתעבור הלאה.
- אם הוא מסר בהודעה הראשונה את כל המידע — אל תשאל סתם, רק אשר ועבור לסיום.
- כשאתה מסיים — תן סיכום קצר בעברית של מה הבנת, וסיים בדיוק במשפט: "אני מוכן".

בהודעה הראשונה התחל ב: "ספר לי על הסדרה הזו במשפט אחד".
`.trim();
}

export function buildExtractInstructionsPrompt(transcript: PreChatMessage[]): string {
  const dialog = transcript
    .map((m) => `${m.role === 'user' ? 'USER' : 'ASSISTANT'}: ${m.text}`)
    .join('\n');

  return `
התקבלה השיחה הבאה בין משתמש ליועץ AI על מאפייני סדרת שיעורים.
חזר JSON חוקי בלבד (ללא קוד-מרקאון, ללא הסברים) עם המבנה הבא:
{
  "summary": string,
  "hasSimanim": boolean,
  "sortBy": "siman" | "chumash-order" | "upload-date" | "custom" | null,
  "customSubCategoryRules": string | null,
  "freeText": string
}

- summary: משפט אחד תיאור כללי של הסדרה.
- hasSimanim: true אם הסדרה מבוססת על סימני שולחן ערוך, false אם לא.
- sortBy: הקריטריון העיקרי למיון השיעורים. ברירת מחדל "siman" אם hasSimanim=true.
- customSubCategoryRules: כללים חופשיים לחלוקה לתתי-קטגוריות (לדוגמה: "תת-קטגוריה לכל אחד מחמשת חומשי התורה"), או null אם אין.
- freeText: כל הוראה נוספת שלא נכנסה לעיל. אם אין — מחרוזת ריקה.

שיחה:
${dialog}
`.trim();
}

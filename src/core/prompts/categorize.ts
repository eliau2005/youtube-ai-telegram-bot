import type { CustomInstructions, Video } from '../types';
import type { ExistingTaxonomy } from '../strapi-options';

const TITLE_RULES = `
TITLE RULES (lessonTitle) — STRICT TEMPLATE:
- If a Lesson Group is assigned, start the title with the EXACT name of the Lesson Group.
- If NO Lesson Group is assigned (null), start the title with the EXACT name of the Sub-Category.
- Follow it with a hyphen, and then the Siman number AND its sections if present.
- Template (with sections):    "[Group OR Sub-Category] - סימן [Siman] סעיפים [Sections]"
- Template (without sections): "[Group OR Sub-Category] - סימן [Siman]"
- CRITICAL: If the original title contains sections (סעיפים) after the Siman (e.g., "ג-ח", "א-ב", "יב"), you MUST include them in the lesson title, preceded by the word "סעיפים".
- Example 1 (With Group "סוכה", Siman with sections): "סוכה - סימן תרלא סעיפים ג-ח"
- Example 2 (With Group "סוכה", Siman without sections): "סוכה - סימן תרלא"
- Example 3 (No Group, Sub-Category "פורים", with sections): "פורים - סימן תרצ סעיפים א-ה"
- Example 4 (No Group, Sub-Category "פורים", no sections): "פורים - סימן תרצ"
- DO NOT prepend the Main Category.
- REMOVE the Rabbi's name entirely.
- REMOVE episode words like "שיעור 1" or "חלק א".

HEBREW LETTERS RULE — ABSOLUTE:
- Siman numbers and section numbers MUST always be written as Hebrew letters, exactly as they appear in the original title.
- NEVER convert them to Arabic numerals. "תרלא" stays "תרלא", "ג-ח" stays "ג-ח", "קיב" stays "קיב".
- Writing "112" instead of "קיב", or "3-8" instead of "ג-ח", is a critical error.

SLUG RULES (baseSlug):
- Clean English transliteration of the Lesson Group (if exists) OR the Sub-Category (if no group).
- NO NUMBERS! Do not translate section numbers like "תרנא" into digits. kebab-case only.

SIMAN VALUE (simanValue):
- Identify if the title mentions a "סימן" (Siman / Halachic section number).
- Convert the Hebrew letters of the Siman into its Integer numerical value (e.g., "תרלט" = 639, "תרמ" = 640).
- If there is a range of Simanim (e.g., "תרנ-תרנא"), extract the value of the FIRST Siman.
- If no Siman is found, return null.

SIMAN SECTION VALUE (simanSectionValue):
- After the Siman number, the title may list specific sections (סעיפים) using smaller Hebrew letters (e.g., "ג-ח", "א-ב", "יב").
- These are SMALL Hebrew letters (א=1 through יב=12 etc.), NOT large Siman numbers like "תרלא".
- If such sections exist, extract the integer value of the FIRST section letter.
- If no sections are specified after the Siman, return null.
`.trim();

function formatCustomInstructions(ci: CustomInstructions): string {
  const lines: string[] = ['USER INSTRUCTIONS (override defaults — these are authoritative):'];
  if (ci.summary) lines.push(`- Series summary: ${ci.summary}`);
  if (ci.freeText) lines.push(`- Free-text directives: ${ci.freeText}`);
  if (ci.hasSimanim === false) {
    lines.push(
      '- This series does NOT use Simanim. Set simanValue and simanSectionValue to null. Do NOT extract Hebrew letters as Siman numbers. lessonTitle MUST NOT contain "סימן".'
    );
  }
  if (ci.sortBy) {
    lines.push(`- Series ordering hint: ${ci.sortBy} (used by post-processing).`);
  }
  if (ci.customSubCategoryRules) {
    lines.push(`- Custom sub-category rules:\n  ${ci.customSubCategoryRules.replace(/\n/g, '\n  ')}`);
  }
  return lines.join('\n');
}

/**
 * Single-call autonomous prompt: AI receives ALL videos at once, plus the
 * existing CMS taxonomy as context, and decides sub-categories / lesson-groups
 * itself based on the user's pre-chat instructions. The AI prefers reusing
 * existing taxonomy over inventing duplicates.
 */
export function buildFullPlaylistPrompt(
  mainCategory: string,
  customInstructions: CustomInstructions | null,
  existing: ExistingTaxonomy,
  videos: Pick<Video, 'videoId' | 'title' | 'originalOrder'>[]
): string {
  const subCatsUnderMain = existing.subCategoriesUnderCategory[mainCategory] ?? [];

  const customBlock = customInstructions
    ? `\n${formatCustomInstructions(customInstructions)}\n`
    : '\n(no user-provided custom instructions)\n';

  return `
You are a precise Jewish Halacha content categorizer. Your job is to organize a YouTube playlist of ${videos.length} videos into a structured taxonomy in a SINGLE pass.

USER-PROVIDED MAIN CATEGORY: "${mainCategory}"
All videos in this playlist belong to this main category.
${customBlock}
EXISTING TAXONOMY in the CMS (PREFER reusing these — only invent NEW entries when no existing item fits):

EXISTING SUB-CATEGORIES under "${mainCategory}":
${subCatsUnderMain.length ? subCatsUnderMain.map((s) => `  • ${s}`).join('\n') : '  (none yet — you may need to create new ones)'}

EXISTING LESSON GROUPS:
${existing.lessonGroups.length ? existing.lessonGroups.map((g) => `  • ${g}`).join('\n') : '  (none)'}

EXISTING RABBIS:
${existing.rabbis.length ? existing.rabbis.map((r) => `  • ${r}`).join('\n') : '  (none — extract rabbi name from titles)'}

YOUR TASK:
For EACH of the ${videos.length} videos in the input array, output a single object. Be CONSISTENT across the whole playlist (same speaker → same rabbi name; same series → same lessonGroup).

Decision rules:
1. subCategory: pick from the existing sub-categories under the main category if any fits. If user instructions describe a different scheme (e.g. "split by chumash"), follow the user instructions and create new sub-categories accordingly.
2. lessonGroup: optional. Use null when not applicable. Reuse an existing lesson group when it matches; create a new one when needed.
3. rabbi: extract from the video title or pick from the existing rabbis list. If unclear, use the most likely existing rabbi. Be consistent.
4. baseSlug: English kebab-case transliteration of (lessonGroup if exists, else subCategory).
5. simanValue / simanSectionValue: extract per the rules below.
6. isNewSubCategory / isNewLessonGroup / isNewRabbi: boolean flags — true if the value you chose is NOT in the existing list above.

${TITLE_RULES}

Return ONLY a JSON array of ${videos.length} objects with EXACTLY these keys:
"videoId", "lessonTitle", "subCategory", "lessonGroup", "rabbi", "baseSlug", "simanValue", "simanSectionValue", "isNewSubCategory", "isNewLessonGroup", "isNewRabbi"

INPUT VIDEOS (in original playlist order):
${JSON.stringify(
  videos.map((v) => ({ videoId: v.videoId, title: v.title, order: v.originalOrder })),
  null,
  2
)}
  `.trim();
}

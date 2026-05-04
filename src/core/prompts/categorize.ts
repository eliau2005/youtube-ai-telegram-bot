import type { CustomInstructions, UserConstraints, Video } from '../types';

export function buildCategorizePrompt(
  constraints: UserConstraints,
  customInstructions: CustomInstructions | null,
  videosChunk: Pick<Video, 'videoId' | 'title'>[]
): string {
  const customBlock = customInstructions
    ? buildCustomBlock(customInstructions)
    : '';

  return `
  You are a highly precise Jewish content categorizer.
  I am providing a JSON array of YouTube videos.

  You MUST categorize each video based on these constraints:
  - MAIN CATEGORY: "${constraints.category}"
  - ALLOWED SUB-CATEGORIES: [${constraints.subCategories}]
  - ALLOWED LESSON GROUPS: [${constraints.lessonGroups}]
  - ALLOWED RABBIS: [${constraints.rabbis}]
${customBlock}
  For EACH video, analyze its title and evaluate its fit. Set the "status" field strictly as follows:
  1. If it clearly does NOT belong to the main category ("${constraints.category}"), set status to "OUT_OF_SCOPE".
  2. If it belongs to the main category, but NONE of the allowed sub-categories fit, set status to "NEW_SUBCATEGORY_NEEDED".
  3. If it perfectly fits the main category and one of the allowed sub-categories, set status to "MATCH".

  TITLE RULES (lessonTitle) - STRICT TEMPLATE:
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
  - DO NOT prepend the Main Category (Do not write "הלכות חגים - ").
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
  - If there is a range of Simanim (e.g., "תרנ-תרנא"), extract the value of the FIRST Siman (e.g., 650).
  - If no Siman is found, return null.

  SIMAN SECTION VALUE (simanSectionValue):
  - After the Siman number, the title may list specific sections (סעיפים) using smaller Hebrew letters (e.g., "ג-ח", "א-ב", "יב").
  - These are SMALL Hebrew letters (א=1 through יב=12 etc.), NOT large Siman numbers like "תרלא".
  - If such sections exist, extract the integer value of the FIRST section letter (e.g., "ג-ח" → 3, "א-ב" → 1, "יב" → 12).
  - If no sections are specified after the Siman, return null.

  Return ONLY a JSON array of objects with the exact keys:
  "videoId", "status", "lessonTitle", "category", "subCategory", "lessonGroup", "rabbi", "baseSlug", "suggestedSubCategory", "suggestedLessonGroup", "simanValue", "simanSectionValue"

  Input Videos:
  ${JSON.stringify(videosChunk.map((v) => ({ videoId: v.videoId, title: v.title })), null, 2)}
  `;
}

function buildCustomBlock(ci: CustomInstructions): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('  ADDITIONAL USER-SPECIFIED INSTRUCTIONS (override defaults when in conflict):');
  if (ci.summary) lines.push(`  - Series summary: ${ci.summary}`);
  if (ci.freeText) lines.push(`  - Free-text directives: ${ci.freeText}`);
  if (ci.hasSimanim === false) {
    lines.push(
      '  - This series does NOT use Simanim. Set simanValue and simanSectionValue to null. Do NOT extract Hebrew letters as Siman numbers. The lessonTitle MUST NOT contain "סימן".'
    );
  }
  if (ci.sortBy) {
    lines.push(`  - Series ordering hint: ${ci.sortBy} (used by post-processing; you do not need to enforce it).`);
  }
  if (ci.customSubCategoryRules) {
    lines.push(`  - Custom sub-category rules:\n      ${ci.customSubCategoryRules.replace(/\n/g, '\n      ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function buildSlugPrompt(text: string): string {
  return `
  Convert the following Hebrew text into a clean English URL slug.
  If it's a person's name (like a Rabbi), provide an English transliteration.
  If it's a concept or category, translate it to English.
  Rules: kebab-case, lowercase, English letters and numbers only, no punctuation or special characters.
  Return ONLY the slug text, nothing else. Do not use quotes or markdown code blocks.

  Text: "${text}"
  `;
}

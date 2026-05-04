const TELEGRAM_LIMIT = 4096;

export function splitForTelegram(text: string, limit = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let buffer = '';
  for (const paragraph of text.split('\n')) {
    const candidate = buffer ? `${buffer}\n${paragraph}` : paragraph;
    if (candidate.length > limit) {
      if (buffer) parts.push(buffer);
      if (paragraph.length > limit) {
        for (let i = 0; i < paragraph.length; i += limit) {
          parts.push(paragraph.slice(i, i + limit));
        }
        buffer = '';
      } else {
        buffer = paragraph;
      }
    } else {
      buffer = candidate;
    }
  }
  if (buffer) parts.push(buffer);
  return parts;
}

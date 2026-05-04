import type { ProcessedVideo } from '../../core/types';

export function buildSummaryReport(videos: ProcessedVideo[]): string {
  if (videos.length === 0) return 'אין שיעורים מאושרים.';

  const byGroup = new Map<string, ProcessedVideo[]>();
  for (const v of videos) {
    const key = v.lessonGroup ?? `(ללא קבוצה) ${v.subCategory}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(v);
  }

  const lines: string[] = [];
  lines.push(`✅ עיבוד הסתיים — ${videos.length} שיעורים`);
  lines.push('');
  lines.push('לפי קבוצה:');
  const groups = Array.from(byGroup.entries()).slice(0, 12);
  for (const [name, items] of groups) {
    lines.push(`• ${name}: ${items.length}`);
  }
  if (byGroup.size > 12) lines.push(`• ... ועוד ${byGroup.size - 12} קבוצות`);

  lines.push('');
  lines.push('שלוש דוגמאות:');
  for (const v of videos.slice(0, 3)) {
    lines.push(`  ${v.order}. ${v.lessonTitle}`);
  }
  return lines.join('\n');
}

export function buildHistoryLine(entry: import('../../core/types').HistoryEntry): string {
  const date = new Date(entry.completedAt).toISOString().slice(0, 10);
  const status =
    entry.status === 'completed'
      ? '✅'
      : entry.status === 'aborted'
        ? '⛔'
        : entry.status === 'interrupted-by-restart'
          ? '🔄'
          : '❌';
  return `${status} ${date} · ${entry.category} · ${entry.totalVideos} שיעורים · ${entry.playlistId}`;
}

import type { ProcessedVideo } from '../../core/types';

export function buildSummaryReport(videos: ProcessedVideo[]): string {
  if (videos.length === 0) return 'אין שיעורים מאושרים.';

  const byGroup = new Map<string, ProcessedVideo[]>();
  for (const v of videos) {
    const key = v.lessonGroup ?? `(ללא קבוצה) ${v.subCategory}`;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key)!.push(v);
  }

  // Sort groups alphabetically (Hebrew locale-aware) and lessons within each
  // group by their final `order` so the listing matches the slug numbering.
  const sortedGroups = Array.from(byGroup.entries()).sort((a, b) =>
    a[0].localeCompare(b[0], 'he')
  );

  const lines: string[] = [];
  lines.push(`✅ עיבוד הסתיים — ${videos.length} שיעורים · ${byGroup.size} קבוצות`);
  lines.push('');

  for (const [name, items] of sortedGroups) {
    items.sort((a, b) => a.order - b.order);
    lines.push(`📂 ${name} — ${items.length} שיעורים`);
    for (const v of items) {
      lines.push(`  ${v.order}. ${v.lessonTitle}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
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

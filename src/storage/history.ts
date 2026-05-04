import { config } from '../config';
import type { HistoryEntry } from '../core/types';
import { historyPath, ensureUserDirs } from './paths';
import { readJson, writeJsonAtomic } from './json';

export async function appendHistoryEntry(userId: number, entry: HistoryEntry): Promise<void> {
  await ensureUserDirs(userId);
  const list = (await readJson<HistoryEntry[]>(historyPath(userId))) ?? [];
  list.unshift(entry);
  if (list.length > config.maxHistoryEntries) list.length = config.maxHistoryEntries;
  await writeJsonAtomic(historyPath(userId), list);
}

export async function listHistory(userId: number, page = 1, pageSize = 10): Promise<{
  entries: HistoryEntry[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const list = (await readJson<HistoryEntry[]>(historyPath(userId))) ?? [];
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { entries: list.slice(start, start + pageSize), total, page: safePage, totalPages };
}

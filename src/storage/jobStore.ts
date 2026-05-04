import fs from 'fs/promises';
import path from 'path';
import type { ProcessedVideo } from '../core/types';
import { jobPath, ensureUserDirs, jobsDir } from './paths';
import { readJson, writeJsonAtomic } from './json';

export async function saveJob(userId: number, jobId: string, data: ProcessedVideo[]): Promise<string> {
  await ensureUserDirs(userId);
  const filepath = jobPath(userId, jobId);
  await writeJsonAtomic(filepath, data);
  return filepath;
}

export async function loadJob(userId: number, jobId: string): Promise<ProcessedVideo[] | null> {
  return readJson<ProcessedVideo[]>(jobPath(userId, jobId));
}

export async function listUserJobIds(userId: number): Promise<string[]> {
  try {
    const dir = jobsDir(userId);
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.json')).map((f) => path.basename(f, '.json'));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

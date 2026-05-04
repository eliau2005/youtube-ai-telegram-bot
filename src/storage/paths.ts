import path from 'path';
import fs from 'fs/promises';
import { config } from '../config';

export function userDir(userId: number): string {
  return path.join(config.dataDir, 'users', String(userId));
}

export function activePath(userId: number): string {
  return path.join(userDir(userId), 'active.json');
}

export function historyPath(userId: number): string {
  return path.join(userDir(userId), 'history.json');
}

export function jobsDir(userId: number): string {
  return path.join(userDir(userId), 'jobs');
}

export function jobPath(userId: number, jobId: string): string {
  return path.join(jobsDir(userId), `${jobId}.json`);
}

export function uploadsDir(userId: number): string {
  return path.join(userDir(userId), 'uploads');
}

export function lockPath(): string {
  return path.join(config.dataDir, 'lock');
}

export async function ensureUserDirs(userId: number): Promise<void> {
  await fs.mkdir(jobsDir(userId), { recursive: true });
  await fs.mkdir(uploadsDir(userId), { recursive: true });
}

export async function ensureDataRoot(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.mkdir(path.join(config.dataDir, 'users'), { recursive: true });
}

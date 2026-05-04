import fs from 'fs/promises';
import path from 'path';
import lockfile from 'proper-lockfile';
import { lockPath } from './paths';

async function ensureLockFile(): Promise<string> {
  const target = lockPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, '');
  }
  return target;
}

export async function readJson<T>(filepath: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(filepath, 'utf-8');
    return JSON.parse(txt) as T;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function writeJsonAtomic<T>(filepath: string, data: T): Promise<void> {
  const target = await ensureLockFile();
  const release = await lockfile.lock(target, {
    retries: { retries: 5, minTimeout: 50 }
  });
  try {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const tmp = `${filepath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
    await fs.rename(tmp, filepath);
  } finally {
    await release();
  }
}

export async function deleteIfExists(filepath: string): Promise<void> {
  try {
    await fs.unlink(filepath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

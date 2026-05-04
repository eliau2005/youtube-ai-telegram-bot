import fs from 'fs/promises';
import { activePath } from './paths';
import { readJson, writeJsonAtomic, deleteIfExists } from './json';

export interface PersistedSession {
  scene?: string;
  state?: Record<string, unknown>;
  jobActive?: boolean;
  savedAt: number;
}

export async function loadSession(userId: number): Promise<PersistedSession | null> {
  return readJson<PersistedSession>(activePath(userId));
}

export async function saveSession(userId: number, data: Omit<PersistedSession, 'savedAt'>): Promise<void> {
  await writeJsonAtomic(activePath(userId), { ...data, savedAt: Date.now() });
}

export async function clearSession(userId: number): Promise<void> {
  await deleteIfExists(activePath(userId));
}

export async function listAllUsers(usersRoot: string): Promise<number[]> {
  try {
    const entries = await fs.readdir(usersRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => Number(e.name))
      .filter((n) => Number.isFinite(n));
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

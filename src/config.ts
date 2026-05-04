import 'dotenv/config';
import { z } from 'zod';
import path from 'path';

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_USER_IDS: z.string().min(1),
  YOUTUBE_API_KEY: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default('gemini-3.1-flash-lite-preview'),
  STRAPI_URL: z.string().url(),
  STRAPI_TOKEN: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATA_DIR: z.string().default('./data'),
  MAX_HISTORY_ENTRIES: z.coerce.number().int().positive().default(100),
  PROGRESS_DEBOUNCE_MS: z.coerce.number().int().positive().default(2000)
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  for (const err of parsed.error.errors) {
    // eslint-disable-next-line no-console
    console.error(`  - ${err.path.join('.')}: ${err.message}`);
  }
  process.exit(1);
}

const env = parsed.data;
const dataDir = path.resolve(env.DATA_DIR);

const allowedUserIds = new Set(
  env.ALLOWED_USER_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n))
);

export const config = {
  telegramBotToken: env.TELEGRAM_BOT_TOKEN,
  allowedUserIds,
  youtubeApiKey: env.YOUTUBE_API_KEY,
  geminiApiKey: env.GEMINI_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  strapiUrl: env.STRAPI_URL.replace(/\/+$/, ''),
  strapiToken: env.STRAPI_TOKEN,
  logLevel: env.LOG_LEVEL,
  dataDir,
  maxHistoryEntries: env.MAX_HISTORY_ENTRIES,
  progressDebounceMs: env.PROGRESS_DEBOUNCE_MS
} as const;

export type Config = typeof config;

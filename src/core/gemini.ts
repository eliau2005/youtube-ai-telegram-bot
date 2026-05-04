import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import { config } from '../config';
import { buildFullPlaylistPrompt } from './prompts/categorize';
import { buildSlugPrompt } from './prompts/slug';
import { buildConsultSystemPrompt, buildExtractInstructionsPrompt } from './prompts/consult';
import type {
  AiResultItem,
  CustomInstructions,
  PreChatMessage,
  UserConstraints,
  Video
} from './types';
import type { ExistingTaxonomy } from './strapi-options';
import { delay, waitWithAbortChecks } from '../util/delay';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

let jsonModel: GenerativeModel | null = null;
let plainModel: GenerativeModel | null = null;

function getJsonModel(): GenerativeModel {
  if (jsonModel) return jsonModel;
  jsonModel = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: {
      responseMimeType: 'application/json',
      // Bumped from default 8K because we now ask for the full playlist in
      // one call. 132 lessons × ~80 tokens output ≈ 10K — give plenty of room.
      maxOutputTokens: 65536
    }
  });
  return jsonModel;
}

function getPlainModel(): GenerativeModel {
  if (plainModel) return plainModel;
  plainModel = genAI.getGenerativeModel({ model: config.geminiModel });
  return plainModel;
}

/**
 * Single-call autonomous categorization: send ALL videos to Gemini in one
 * request together with the existing CMS taxonomy as context. The AI decides
 * sub-categories / lesson-groups itself (preferring reuse of existing ones)
 * and returns the full structured result.
 */
export async function categorizeFullPlaylist(
  videos: Video[],
  mainCategory: string,
  customInstructions: CustomInstructions | null,
  existing: ExistingTaxonomy,
  log: (text: string) => void,
  isAborted: () => boolean
): Promise<AiResultItem[] | null> {
  const prompt = buildFullPlaylistPrompt(mainCategory, customInstructions, existing, videos);
  const model = getJsonModel();
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (isAborted()) return null;
    try {
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text) as AiResultItem[];
      if (!Array.isArray(parsed)) {
        throw new Error('AI response is not a JSON array');
      }
      return parsed;
    } catch (err) {
      attempt++;
      const waitSeconds = Math.min(5 * Math.pow(2, attempt - 1), 60);
      const message = err instanceof Error ? err.message : String(err);
      log(`Gemini error (attempt ${attempt}): ${message}`);
      if (attempt >= 5) {
        log('Giving up after 5 attempts.');
        throw err;
      }
      log(`Retrying in ${waitSeconds}s...`);
      const aborted = await waitWithAbortChecks(waitSeconds * 1000, isAborted);
      if (aborted) return null;
    }
  }
}

export async function generateEnglishSlug(
  text: string,
  cache: Map<string, string>,
  log: (text: string) => void
): Promise<string> {
  if (!text) return '';
  const cached = cache.get(text);
  if (cached) return cached;

  const prompt = buildSlugPrompt(text);
  const model = getPlainModel();
  try {
    const result = await model.generateContent(prompt);
    let slug = result.response.text().trim().toLowerCase();
    slug = slug.replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!slug) slug = `item-${Date.now()}`;
    cache.set(text, slug);
    await delay(1500);
    return slug;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`Gemini API error generating slug for "${text}": ${message}`);
    return `error-slug-${Date.now()}`;
  }
}

export async function consultChat(
  history: PreChatMessage[],
  userMessage: string,
  constraints: UserConstraints
): Promise<string> {
  const model = getPlainModel();

  // Use a single-turn prompt (same shape as categorizeChunk) instead of
  // multi-turn `contents`, because some preview models don't support the
  // multi-turn structure cleanly and fail with vague 400 errors.
  const transcript = history
    .map((m) => `${m.role === 'assistant' ? 'יועץ' : 'משתמש'}: ${m.text}`)
    .join('\n');

  const prompt = [
    buildConsultSystemPrompt(constraints),
    '',
    transcript ? `שיחה עד כה:\n${transcript}` : '',
    `משתמש: ${userMessage}`,
    'יועץ:'
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

export async function extractCustomInstructions(
  transcript: PreChatMessage[]
): Promise<CustomInstructions> {
  const model = genAI.getGenerativeModel({
    model: config.geminiModel,
    generationConfig: { responseMimeType: 'application/json' }
  });
  const prompt = buildExtractInstructionsPrompt(transcript);
  const result = await model.generateContent(prompt);
  const parsed = JSON.parse(result.response.text()) as Partial<CustomInstructions>;
  return {
    summary: parsed.summary ?? '',
    hasSimanim: parsed.hasSimanim ?? true,
    sortBy: parsed.sortBy ?? null,
    customSubCategoryRules: parsed.customSubCategoryRules ?? null,
    freeText: parsed.freeText ?? ''
  };
}

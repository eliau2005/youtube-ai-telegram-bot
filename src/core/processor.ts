import path from 'path';
import fs from 'fs/promises';
import type {
  AiResultItem,
  ApprovedVideo,
  CustomInstructions,
  DialogResponse,
  ProcessedVideo,
  ProcessingContext,
  UserConstraints,
  Video
} from './types';
import { fetchAllPlaylistItems } from './youtube';
import { categorizeChunk } from './gemini';
import { finalizeApprovedVideos } from './postProcess';
import { delay } from '../util/delay';

const CHUNK_SIZE = 10;

export interface ProcessorRunResult {
  outputPath: string;
  data: ProcessedVideo[];
  approved: ApprovedVideo[];
  videos: Video[];
  aborted: boolean;
}

export interface ProcessorRunInput {
  constraints: UserConstraints;
  customInstructions: CustomInstructions | null;
  playlistId: string;
  /** Optional: when provided, skip the YouTube fetch (used for general corrections). */
  cachedVideos?: Video[];
  ctx: ProcessingContext;
}

export async function runProcessor(input: ProcessorRunInput): Promise<ProcessorRunResult | null> {
  const { ctx } = input;
  const userConstraints: UserConstraints = {
    category: input.constraints.category.trim(),
    subCategories: input.constraints.subCategories.trim(),
    lessonGroups: input.constraints.lessonGroups.trim(),
    rabbis: input.constraints.rabbis.trim()
  };

  const videos =
    input.cachedVideos ?? (await fetchAllPlaylistItems(input.playlistId, (m) => ctx.log(m)));
  if (videos.length === 0) return null;

  const approvedVideos: ApprovedVideo[] = [];
  const totalChunks = Math.ceil(videos.length / CHUNK_SIZE);
  let aborted = false;
  let processedCount = 0;

  await ctx.progress(`התחלת ניתוח AI · 0/${videos.length}`);

  for (let i = 0; i < videos.length; i += CHUNK_SIZE) {
    if (ctx.isAborted()) {
      aborted = true;
      break;
    }
    let pendingChunk = videos.slice(i, i + CHUNK_SIZE);
    const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
    ctx.log(`Processing chunk ${chunkNum}/${totalChunks}`);

    while (pendingChunk.length > 0) {
      const aiResult = await categorizeChunk(
        pendingChunk,
        userConstraints,
        input.customInstructions,
        (m) => ctx.log(m),
        ctx.isAborted
      );
      if (aiResult === null) {
        aborted = true;
        break;
      }
      if (aiResult.length === 0) break;

      let constraintsChanged = false;
      for (let j = 0; j < aiResult.length; j++) {
        if (ctx.isAborted()) {
          aborted = true;
          break;
        }
        const aiItem = aiResult[j];
        const originalVid = pendingChunk.find((v) => v.videoId === aiItem.videoId);
        if (!originalVid) continue;

        const oldSubs = userConstraints.subCategories;
        const oldGroups = userConstraints.lessonGroups;
        const finalizedItem = await handleInteractiveLogic(aiItem, originalVid, userConstraints, ctx);

        if (finalizedItem) {
          approvedVideos.push({
            videoId: originalVid.videoId,
            youtubeUrl: originalVid.youtubeUrl,
            originalTitle: originalVid.title,
            lessonTitle: finalizedItem.lessonTitle,
            description: '',
            rabbi: finalizedItem.rabbi,
            category: finalizedItem.category,
            subCategory: finalizedItem.subCategory,
            lessonGroup: finalizedItem.lessonGroup,
            baseSlug: finalizedItem.baseSlug,
            simanValue: finalizedItem.simanValue,
            simanSectionValue: finalizedItem.simanSectionValue ?? null,
            originalOrder: originalVid.originalOrder
          });
        }
        processedCount++;
        await ctx.progress(`מעבד · ${processedCount}/${videos.length}`);

        if (
          oldSubs !== userConstraints.subCategories ||
          oldGroups !== userConstraints.lessonGroups
        ) {
          ctx.log('Constraints updated; re-evaluating remaining items in chunk');
          constraintsChanged = true;
          pendingChunk = pendingChunk.slice(j + 1);
          await delay(2000);
          break;
        }
      }
      if (aborted) break;
      if (!constraintsChanged) break;
    }
    if (aborted) break;
    if (chunkNum < totalChunks) await delay(3000);
  }

  if (approvedVideos.length === 0) return null;

  const finalProcessedVideos = finalizeApprovedVideos(approvedVideos);

  const outputFilename = `playlist_${input.playlistId}_processed.json`;
  await fs.mkdir(ctx.outputDir, { recursive: true });
  const outputPath = path.join(ctx.outputDir, outputFilename);
  await fs.writeFile(outputPath, JSON.stringify(finalProcessedVideos, null, 2), 'utf-8');

  return { outputPath, data: finalProcessedVideos, approved: approvedVideos, videos, aborted };
}

async function handleInteractiveLogic(
  aiItem: AiResultItem,
  originalVid: Video,
  constraints: UserConstraints,
  ctx: ProcessingContext
): Promise<AiResultItem | null> {
  if (aiItem.status === 'MATCH') return aiItem;

  if (aiItem.status === 'OUT_OF_SCOPE') {
    const response = await askWithGuard(ctx, {
      type: 'OUT_OF_SCOPE',
      videoTitle: originalVid.title,
      category: constraints.category,
      subCategories: constraints.subCategories,
      lessonGroups: constraints.lessonGroups,
      rabbis: constraints.rabbis
    });
    return applyResponse(aiItem, response, constraints, ctx);
  }

  if (aiItem.status === 'NEW_SUBCATEGORY_NEEDED') {
    const response = await askWithGuard(ctx, {
      type: 'NEW_SUBCATEGORY_NEEDED',
      videoTitle: originalVid.title,
      suggestedSubCategory: aiItem.suggestedSubCategory ?? aiItem.subCategory ?? '',
      suggestedLessonGroup: aiItem.suggestedLessonGroup ?? aiItem.lessonGroup ?? null
    });
    return applyResponse(aiItem, response, constraints, ctx);
  }

  return aiItem;
}

async function askWithGuard(
  ctx: ProcessingContext,
  prompt: Parameters<ProcessingContext['askInteractive']>[0]
): Promise<DialogResponse> {
  const result = await ctx.askInteractive(prompt);
  return result;
}

function applyResponse(
  aiItem: AiResultItem,
  response: DialogResponse,
  constraints: UserConstraints,
  ctx: ProcessingContext
): AiResultItem | null {
  if (response.action === 'skip') {
    ctx.log('Video skipped by user.');
    return null;
  }
  aiItem.subCategory = response.subCategory;
  aiItem.lessonGroup = response.lessonGroup ?? null;
  aiItem.rabbi = response.rabbi;
  aiItem.category = constraints.category;
  if (!constraints.subCategories.includes(response.subCategory)) {
    constraints.subCategories += `, ${response.subCategory}`;
  }
  if (response.lessonGroup && !constraints.lessonGroups.includes(response.lessonGroup)) {
    constraints.lessonGroups += `, ${response.lessonGroup}`;
  }
  return aiItem;
}

import path from 'path';
import fs from 'fs/promises';
import type {
  ApprovedVideo,
  CustomInstructions,
  ProcessedVideo,
  ProcessingContext,
  UserConstraints,
  Video
} from './types';
import { fetchAllPlaylistItems } from './youtube';
import { categorizeFullPlaylist } from './gemini';
import { finalizeApprovedVideos } from './postProcess';
import { createStrapiClient } from './strapi';
import { loadExistingTaxonomy } from './strapi-options';

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
  const mainCategory = input.constraints.category.trim();

  // Step 1: fetch playlist (or use cached videos for re-run scenarios)
  const videos =
    input.cachedVideos ?? (await fetchAllPlaylistItems(input.playlistId, (m) => ctx.log(m)));
  if (videos.length === 0) return null;
  if (ctx.isAborted()) return null;

  // Step 2: load existing CMS taxonomy so the AI can reuse instead of duplicating
  await ctx.progress(`טוען טקסונומיה קיימת מ-Strapi · ${videos.length} סרטונים`);
  const client = createStrapiClient({ onLog: (m) => ctx.log(m) });
  const existing = await loadExistingTaxonomy(client);
  ctx.log(
    `Loaded existing taxonomy: ${existing.rabbis.length} rabbis, ${existing.allSubCategories.length} sub-categories, ${existing.lessonGroups.length} lesson groups.`
  );
  if (ctx.isAborted()) return null;

  // Step 3: single Gemini call with all videos + taxonomy context
  await ctx.progress(`שולח ${videos.length} סרטונים ל-Gemini בקריאה אחת...`);
  const aiResults = await categorizeFullPlaylist(
    videos,
    mainCategory,
    input.customInstructions,
    existing,
    (m) => ctx.log(m),
    ctx.isAborted
  );
  if (aiResults === null) return null; // aborted
  if (aiResults.length === 0) {
    ctx.log('AI returned an empty array.');
    return null;
  }

  // Step 4: assemble approved videos preserving original order metadata
  const approvedVideos: ApprovedVideo[] = [];
  for (const result of aiResults) {
    const orig = videos.find((v) => v.videoId === result.videoId);
    if (!orig) {
      ctx.log(`AI returned unknown videoId: ${result.videoId}`);
      continue;
    }
    approvedVideos.push({
      videoId: orig.videoId,
      youtubeUrl: orig.youtubeUrl,
      originalTitle: orig.title,
      lessonTitle: result.lessonTitle,
      description: '',
      rabbi: result.rabbi,
      category: mainCategory,
      subCategory: result.subCategory,
      lessonGroup: result.lessonGroup ?? null,
      baseSlug: result.baseSlug,
      simanValue: result.simanValue,
      simanSectionValue: result.simanSectionValue ?? null,
      originalOrder: orig.originalOrder
    });
  }

  if (approvedVideos.length === 0) {
    ctx.log('No approved videos after AI processing.');
    return null;
  }

  await ctx.progress(`עיבוד הושלם · מסיים מיון וסידור · ${approvedVideos.length} שיעורים`);

  // Step 5: post-process (group/sort/slug) — same logic as before
  const finalProcessedVideos = finalizeApprovedVideos(approvedVideos);

  // Step 6: write output JSON file for download
  const outputFilename = `playlist_${input.playlistId}_processed.json`;
  await fs.mkdir(ctx.outputDir, { recursive: true });
  const outputPath = path.join(ctx.outputDir, outputFilename);
  await fs.writeFile(outputPath, JSON.stringify(finalProcessedVideos, null, 2), 'utf-8');

  return {
    outputPath,
    data: finalProcessedVideos,
    approved: approvedVideos,
    videos,
    aborted: false
  };
}

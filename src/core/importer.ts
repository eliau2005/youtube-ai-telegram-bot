import type { ProcessedVideo, PublishMode } from './types';
import { createStrapiClient } from './strapi';
import { generateEnglishSlug } from './gemini';

export interface ImporterOptions {
  publishMode: PublishMode;
  log: (text: string) => void;
  progress?: (text: string) => Promise<void>;
  isAborted?: () => boolean;
}

export interface ImporterResult {
  created: number;
  errors: number;
  total: number;
  aborted: boolean;
}

export async function runImporter(
  videos: ProcessedVideo[],
  options: ImporterOptions
): Promise<ImporterResult> {
  const { publishMode, log, progress, isAborted = () => false } = options;
  const client = createStrapiClient({ onLog: log });

  log(`Starting Strapi import — mode: ${publishMode}, total: ${videos.length}`);
  log('Loading existing taxonomy from Strapi...');
  const [rabbisLookup, categoriesLookup, subcatsLookup, groupsLookup] = await Promise.all([
    client.buildLookupMap('rabbis', 'name'),
    client.buildLookupMap('categories', 'title'),
    client.buildLookupMap('sub-categories', 'title'),
    client.buildLookupMap('lesson-groups', 'title')
  ]);
  const rabbisCache = rabbisLookup.byName;
  const categoriesCache = categoriesLookup.byName;
  const subcatsCache = subcatsLookup.byName;
  const groupsCache = groupsLookup.byName;
  log(
    `Loaded: ${rabbisCache.size} rabbis, ${categoriesCache.size} categories, ` +
      `${subcatsCache.size} sub-categories, ${groupsCache.size} groups`
  );

  const slugCache = new Map<string, string>();
  let created = 0;
  let errors = 0;
  let aborted = false;

  for (let i = 0; i < videos.length; i++) {
    if (isAborted()) {
      aborted = true;
      break;
    }
    const video = videos[i];
    log(`(${i + 1}/${videos.length}) ${video.lessonTitle}`);
    if (progress && (i % 5 === 0 || i === videos.length - 1)) {
      await progress(`מייבא ל-Strapi · ${i + 1}/${videos.length}`);
    }

    try {
      const rabbiId = await client.findOrCreate('rabbis', video.rabbi, rabbisCache, async () => ({
        name: video.rabbi,
        slug: await generateEnglishSlug(video.rabbi, slugCache, log)
      }));

      const categoryId = await client.findOrCreate(
        'categories',
        video.category,
        categoriesCache,
        async () => ({
          title: video.category,
          slug: await generateEnglishSlug(video.category, slugCache, log)
        })
      );

      const subCategoryId = await client.findOrCreate(
        'sub-categories',
        video.subCategory,
        subcatsCache,
        async () => ({
          title: video.subCategory,
          slug: await generateEnglishSlug(video.subCategory, slugCache, log),
          category: categoryId
        })
      );

      const lessonGroupId = await client.findOrCreate(
        'lesson-groups',
        video.lessonGroup,
        groupsCache,
        async () => ({
          title: video.lessonGroup,
          sub_category: subCategoryId
        })
      );

      const lessonPayload: Record<string, unknown> = {
        title: video.lessonTitle,
        slug: video.slug,
        youtubeUrl: video.youtubeUrl,
        description: video.description,
        order: video.order,
        rabbi: rabbiId ? { connect: [rabbiId] } : undefined,
        subCategories: subCategoryId ? { connect: [subCategoryId] } : undefined,
        lesson_group: lessonGroupId ? { connect: [lessonGroupId] } : undefined,
        publishedAt: publishMode === 'publish' ? new Date().toISOString() : null
      };

      await client.fetchStrapi('lessons', {
        method: 'POST',
        body: JSON.stringify({ data: lessonPayload })
      });
      created++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      log(`Error saving "${video.lessonTitle}": ${message}`);
    }
  }

  log(`Import done. Created: ${created} · Errors: ${errors}`);
  return { created, errors, total: videos.length, aborted };
}

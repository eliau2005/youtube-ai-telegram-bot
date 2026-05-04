import type { ProcessedVideo } from './types';
import type { StrapiClient } from './strapi';

const LESSONS_POPULATE_QUERY =
  'populate[rabbi]=true' +
  '&populate[subCategories][populate][category]=true' +
  '&populate[lesson_group]=true';

const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

export interface LessonFilters {
  category?: string;
  subCategory?: string;
  lessonGroup?: string;
  rabbi?: string;
}

interface RawLesson {
  title?: string;
  slug?: string;
  description?: string;
  youtubeUrl?: string;
  order?: number;
  rabbi?: { name?: string };
  subCategories?: { title?: string; category?: { title?: string } }[];
  lesson_group?: { title?: string };
}

export function extractVideoId(url: string): string {
  if (!url) return '';
  const m = String(url).match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]+)/
  );
  return m ? m[1] : '';
}

export function mapLessonToJsonShape(lesson: RawLesson, warnings: string[]): ProcessedVideo {
  const subCats = Array.isArray(lesson.subCategories) ? lesson.subCategories : [];
  const firstSub = subCats[0] || null;
  const category = firstSub?.category || null;
  const youtubeUrl = lesson.youtubeUrl || '';
  const videoId = extractVideoId(youtubeUrl);

  if (subCats.length > 1) {
    const titles = subCats.map((s) => s?.title).filter(Boolean).join(', ');
    warnings.push(
      `שיעור '${lesson.title}' שייך ל-${subCats.length} תתי-קטגוריות (${titles}); נבחרה: '${firstSub?.title || ''}'.`
    );
  }
  if (subCats.length === 0) {
    warnings.push(`שיעור '${lesson.title}' ללא תת-קטגוריה — שדות category/subCategory יישארו ריקים.`);
  }
  if (!youtubeUrl) {
    warnings.push(`שיעור '${lesson.title}' ללא youtubeUrl — videoId יישאר ריק.`);
  } else if (!videoId) {
    warnings.push(`שיעור '${lesson.title}': לא הצלחתי לחלץ videoId מ-'${youtubeUrl}'.`);
  }

  return {
    videoId,
    youtubeUrl,
    originalTitle: lesson.title || '',
    lessonTitle: lesson.title || '',
    description: lesson.description || '',
    rabbi: lesson.rabbi?.name || '',
    category: category?.title || '',
    subCategory: firstSub?.title || '',
    lessonGroup: lesson.lesson_group?.title || null,
    order: lesson.order ?? 0,
    slug: lesson.slug || ''
  };
}

function buildLessonsQuery(filters: LessonFilters, page: number): string {
  const parts = [
    LESSONS_POPULATE_QUERY,
    `pagination[page]=${page}`,
    'pagination[pageSize]=100',
    'sort=order:asc'
  ];
  if (filters.category)
    parts.push(`filters[subCategories][category][title][$eq]=${encodeURIComponent(filters.category)}`);
  if (filters.subCategory)
    parts.push(`filters[subCategories][title][$eq]=${encodeURIComponent(filters.subCategory)}`);
  if (filters.lessonGroup)
    parts.push(`filters[lesson_group][title][$eq]=${encodeURIComponent(filters.lessonGroup)}`);
  if (filters.rabbi) parts.push(`filters[rabbi][name][$eq]=${encodeURIComponent(filters.rabbi)}`);
  return `lessons?${parts.join('&')}`;
}

export async function fetchFilteredLessons(
  client: StrapiClient,
  filters: LessonFilters,
  log: (text: string) => void
): Promise<{ lessons: ProcessedVideo[]; warnings: string[] }> {
  const warnings: string[] = [];
  const lessons: ProcessedVideo[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const path = buildLessonsQuery(filters, page);
    interface RawListResponse {
      data: ({ attributes?: RawLesson } & RawLesson)[];
      meta?: { pagination?: { page: number; pageCount: number } };
    }
    const json = await client.fetchStrapi<RawListResponse>(path);
    const items = json.data ?? [];
    for (const item of items) {
      const attrs = (item.attributes ?? item) as RawLesson;
      lessons.push(mapLessonToJsonShape(attrs, warnings));
    }
    const p = json.meta?.pagination;
    if (!p || p.page >= p.pageCount || items.length === 0) break;
    page++;
  }
  log(`Pulled ${lessons.length} lessons from Strapi.`);
  if (warnings.length) log(`${warnings.length} warnings during mapping.`);
  return { lessons, warnings };
}

function sanitizeFilenamePart(text: string): string {
  return String(text || '')
    .replace(FORBIDDEN_FILENAME_CHARS, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildDefaultFilename(filters: LessonFilters = {}): string {
  const raw = [
    filters.category && sanitizeFilenamePart(filters.category),
    filters.subCategory && sanitizeFilenamePart(filters.subCategory),
    filters.lessonGroup && sanitizeFilenamePart(filters.lessonGroup),
    filters.rabbi && sanitizeFilenamePart(filters.rabbi)
  ].filter(Boolean) as string[];
  const tag = raw.length ? raw.join('-') : 'all';
  const date = new Date().toISOString().slice(0, 10);
  const base = `strapi-export-${tag}-${date}`;
  return `${base.slice(0, 100)}.json`;
}

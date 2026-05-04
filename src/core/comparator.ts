import fs from 'fs/promises';
import type { ProcessedVideo, PublishMode } from './types';
import type { StrapiClient, StrapiLookup } from './strapi';

export const ENTITY_ORDER = [
  'rabbis',
  'categories',
  'sub-categories',
  'lesson-groups',
  'lessons'
] as const;

export type EntityKey = (typeof ENTITY_ORDER)[number];

interface EntityDef {
  nameField: string;
  extra: string[];
}

const ENTITY_DEFS: Record<EntityKey, EntityDef> = {
  rabbis: { nameField: 'name', extra: ['slug'] },
  categories: { nameField: 'title', extra: ['slug'] },
  'sub-categories': { nameField: 'title', extra: ['slug'] },
  'lesson-groups': { nameField: 'title', extra: [] },
  lessons: { nameField: 'title', extra: ['slug'] }
};

export type RowDecision = 'create' | 'skip' | 'update' | 'map';

export interface ImportRow {
  rowId: string;
  status: 'new' | 'existing' | 'conflict';
  jsonValue: string;
  parentValue?: string | null;
  jsonPayload: Record<string, unknown>;
  matchedDocumentId: string | null;
  matchedBy: string | null;
  conflictReason?: string | null;
  decision: RowDecision;
  mapTargetDocumentId: string | null;
  videoIndex?: number;
}

export interface EntityReport {
  endpoint: string;
  nameField: string;
  strapiAll: { documentId: string; name: string; slug?: string }[];
  rows: ImportRow[];
}

export interface AnalyzeReport {
  jsonPath: string;
  videoCount: number;
  totals: { new: number; existing: number; conflict: number };
  entities: Record<EntityKey, EntityReport>;
}

export interface DecisionsMap {
  [rowId: string]: { decision?: RowDecision; mapTargetDocumentId?: string | null } | undefined;
}

export interface ExecuteOptions {
  publishMode: PublishMode;
  allowUpdates: boolean;
  log: (text: string) => void;
  progress?: (text: string) => Promise<void>;
}

export interface ExecuteSummary {
  created: number;
  updated: number;
  skipped: number;
  mapped: number;
  errors: number;
}

export async function analyzeImport(
  filePath: string,
  client: StrapiClient,
  log: (text: string) => void
): Promise<AnalyzeReport> {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const videos = JSON.parse(fileContent) as ProcessedVideo[];
  if (!Array.isArray(videos)) throw new Error('JSON root must be an array of video objects.');

  log('Loading existing data from Strapi...');
  const [rabbisLookup, categoriesLookup, subcatsLookup, groupsLookup, lessonsLookup] =
    await Promise.all([
      client.buildLookupMap('rabbis', 'name', ['slug']),
      client.buildLookupMap('categories', 'title', ['slug']),
      client.buildLookupMap('sub-categories', 'title', ['slug']),
      client.buildLookupMap('lesson-groups', 'title', []),
      client.buildLookupMap('lessons', 'title', ['slug'])
    ]);

  const lookups: Record<EntityKey, StrapiLookup> = {
    rabbis: rabbisLookup,
    categories: categoriesLookup,
    'sub-categories': subcatsLookup,
    'lesson-groups': groupsLookup,
    lessons: lessonsLookup
  };

  const taxonomyValues: Record<Exclude<EntityKey, 'lessons'>, Map<string, { parent: string | null }>> = {
    rabbis: new Map(),
    categories: new Map(),
    'sub-categories': new Map(),
    'lesson-groups': new Map()
  };

  for (const v of videos) {
    if (v.rabbi && !taxonomyValues.rabbis.has(v.rabbi))
      taxonomyValues.rabbis.set(v.rabbi, { parent: null });
    if (v.category && !taxonomyValues.categories.has(v.category))
      taxonomyValues.categories.set(v.category, { parent: null });
    if (v.subCategory && !taxonomyValues['sub-categories'].has(v.subCategory))
      taxonomyValues['sub-categories'].set(v.subCategory, { parent: v.category || null });
    if (v.lessonGroup && !taxonomyValues['lesson-groups'].has(v.lessonGroup))
      taxonomyValues['lesson-groups'].set(v.lessonGroup, { parent: v.subCategory || null });
  }

  function buildTaxonomyReport(endpoint: Exclude<EntityKey, 'lessons'>): EntityReport {
    const def = ENTITY_DEFS[endpoint];
    const lookup = lookups[endpoint];
    const rows: ImportRow[] = [];
    let idx = 0;
    for (const [value, meta] of taxonomyValues[endpoint]) {
      const matchedDocumentId = lookup.byName.get(value) ?? null;
      const status: ImportRow['status'] = matchedDocumentId ? 'existing' : 'new';
      rows.push({
        rowId: `${endpoint}#${idx++}`,
        status,
        jsonValue: value,
        parentValue: meta.parent,
        jsonPayload: { value, parent: meta.parent },
        matchedDocumentId,
        matchedBy: matchedDocumentId ? 'name' : null,
        decision: status === 'existing' ? 'skip' : 'create',
        mapTargetDocumentId: null
      });
    }
    return {
      endpoint,
      nameField: def.nameField,
      strapiAll: lookup.all.map((r) => ({ documentId: r.documentId, name: r.name })),
      rows
    };
  }

  function buildLessonsReport(): EntityReport {
    const lookup = lookups.lessons;
    const bySlug = lookup.byExtra.slug ?? new Map<string, string>();
    const byTitle = lookup.byName;
    const seenSlugs = new Set<string>();
    const seenTitles = new Set<string>();

    const rows: ImportRow[] = videos.map((v, idx) => {
      const slug = String(v.slug || '').trim();
      const title = String(v.lessonTitle || '').trim();
      const slugMatchId = slug ? bySlug.get(slug) ?? null : null;
      const titleMatchId = title ? byTitle.get(title) ?? null : null;

      let status: ImportRow['status'] = 'new';
      let matchedDocumentId: string | null = null;
      let matchedBy: string | null = null;
      let conflictReason: string | null = null;

      const dupInJson = (slug && seenSlugs.has(slug)) || (title && seenTitles.has(title));
      if (dupInJson) {
        status = 'conflict';
        conflictReason = 'duplicate-in-json';
      } else if (slugMatchId && titleMatchId && slugMatchId === titleMatchId) {
        status = 'existing';
        matchedDocumentId = slugMatchId;
        matchedBy = 'slug+title';
      } else if (slugMatchId && titleMatchId && slugMatchId !== titleMatchId) {
        status = 'conflict';
        matchedDocumentId = slugMatchId;
        matchedBy = 'slug';
        conflictReason = 'slug-vs-title-mismatch';
      } else if (slugMatchId) {
        status = 'conflict';
        matchedDocumentId = slugMatchId;
        matchedBy = 'slug';
        conflictReason = 'slug-vs-title-mismatch';
      } else if (titleMatchId) {
        status = 'conflict';
        matchedDocumentId = titleMatchId;
        matchedBy = 'title';
        conflictReason = 'slug-vs-title-mismatch';
      }

      if (slug) seenSlugs.add(slug);
      if (title) seenTitles.add(title);

      return {
        rowId: `lessons#${idx}`,
        videoIndex: idx,
        status,
        jsonValue: title || slug || `(item ${idx + 1})`,
        jsonPayload: { ...v },
        matchedDocumentId,
        matchedBy,
        conflictReason,
        decision: status === 'new' ? 'create' : 'skip',
        mapTargetDocumentId: null
      };
    });

    return {
      endpoint: 'lessons',
      nameField: 'title',
      strapiAll: lookup.all.map((r) => ({
        documentId: r.documentId,
        name: r.name,
        slug: r.slug || ''
      })),
      rows
    };
  }

  const entities: Record<EntityKey, EntityReport> = {
    rabbis: buildTaxonomyReport('rabbis'),
    categories: buildTaxonomyReport('categories'),
    'sub-categories': buildTaxonomyReport('sub-categories'),
    'lesson-groups': buildTaxonomyReport('lesson-groups'),
    lessons: buildLessonsReport()
  };

  let totalNew = 0;
  let totalExisting = 0;
  let totalConflict = 0;
  for (const key of ENTITY_ORDER) {
    for (const r of entities[key].rows) {
      if (r.status === 'new') totalNew++;
      else if (r.status === 'existing') totalExisting++;
      else totalConflict++;
    }
  }

  return {
    jsonPath: filePath,
    videoCount: videos.length,
    totals: { new: totalNew, existing: totalExisting, conflict: totalConflict },
    entities
  };
}

export async function executeImport(
  report: AnalyzeReport,
  decisions: DecisionsMap,
  client: StrapiClient,
  options: ExecuteOptions
): Promise<ExecuteSummary> {
  const { publishMode, allowUpdates, log, progress } = options;
  const summary: ExecuteSummary = {
    created: 0,
    updated: 0,
    skipped: 0,
    mapped: 0,
    errors: 0
  };

  const preflightErrors: string[] = [];
  for (const key of ENTITY_ORDER) {
    for (const row of report.entities[key].rows) {
      const dec = mergeDecision(row, decisions[row.rowId]);
      if (dec.decision === 'update' && !allowUpdates) {
        preflightErrors.push(`'${row.jsonValue}' מבקש עדכון אך 'אפשר עדכון פריטים קיימים' אינו מסומן.`);
      }
      if (dec.decision === 'map' && !dec.mapTargetDocumentId) {
        preflightErrors.push(`'${row.jsonValue}' (${key}) — בחרת מיפוי אך לא נבחר יעד.`);
      }
    }
  }
  if (preflightErrors.length) {
    for (const msg of preflightErrors) log(msg);
    throw new Error(`Pre-flight failed (${preflightErrors.length} errors).`);
  }

  const resolvedIds: Record<Exclude<EntityKey, 'lessons'>, Map<string, string>> = {
    rabbis: new Map(),
    categories: new Map(),
    'sub-categories': new Map(),
    'lesson-groups': new Map()
  };

  for (const endpoint of ['rabbis', 'categories', 'sub-categories', 'lesson-groups'] as const) {
    const entity = report.entities[endpoint];
    log(`-- ${endpoint} --`);
    for (const row of entity.rows) {
      const dec = mergeDecision(row, decisions[row.rowId]);
      try {
        if (dec.decision === 'skip') {
          if (row.matchedDocumentId) resolvedIds[endpoint].set(row.jsonValue, row.matchedDocumentId);
          summary.skipped++;
          continue;
        }
        if (dec.decision === 'map') {
          if (dec.mapTargetDocumentId)
            resolvedIds[endpoint].set(row.jsonValue, dec.mapTargetDocumentId);
          summary.mapped++;
          continue;
        }
        if (dec.decision === 'update') {
          const payload = await buildTaxonomyPayload(endpoint, row, resolvedIds);
          if (!row.matchedDocumentId) throw new Error(`No matched documentId to update`);
          await client.updateRecord(endpoint, row.matchedDocumentId, payload);
          resolvedIds[endpoint].set(row.jsonValue, row.matchedDocumentId);
          summary.updated++;
          continue;
        }
        const payload = await buildTaxonomyPayload(endpoint, row, resolvedIds);
        const documentId = await client.createRecord(endpoint, {
          ...payload,
          publishedAt: new Date().toISOString()
        });
        resolvedIds[endpoint].set(row.jsonValue, documentId);
        summary.created++;
      } catch (err) {
        summary.errors++;
        const message = err instanceof Error ? err.message : String(err);
        log(`Error on '${row.jsonValue}': ${message}`);
      }
    }
  }

  log('-- lessons --');
  const lessonsEntity = report.entities.lessons;
  let processed = 0;
  for (const row of lessonsEntity.rows) {
    const dec = mergeDecision(row, decisions[row.rowId]);
    const v = (row.jsonPayload || {}) as unknown as ProcessedVideo;
    try {
      if (dec.decision === 'skip') {
        summary.skipped++;
        continue;
      }
      const rabbiId = resolvedIds.rabbis.get(v.rabbi) ?? null;
      const subCategoryId = resolvedIds['sub-categories'].get(v.subCategory) ?? null;
      const lessonGroupId = v.lessonGroup
        ? resolvedIds['lesson-groups'].get(v.lessonGroup) ?? null
        : null;
      if (v.rabbi && !rabbiId) throw new Error(`רב '${v.rabbi}' לא נפתר (דולג?)`);
      if (v.subCategory && !subCategoryId) throw new Error(`תת-קטגוריה '${v.subCategory}' לא נפתרה`);
      if (v.lessonGroup && !lessonGroupId)
        throw new Error(`קבוצת שיעור '${v.lessonGroup}' לא נפתרה`);

      if (dec.decision === 'map') {
        summary.mapped++;
        continue;
      }

      const basePayload = {
        title: v.lessonTitle,
        slug: v.slug,
        youtubeUrl: v.youtubeUrl,
        description: v.description,
        order: v.order
      };

      if (dec.decision === 'update') {
        const updatePayload: Record<string, unknown> = {
          ...basePayload,
          rabbi: rabbiId ? { set: [rabbiId] } : undefined,
          subCategories: subCategoryId ? { set: [subCategoryId] } : undefined,
          lesson_group: lessonGroupId ? { set: [lessonGroupId] } : undefined
        };
        if (!row.matchedDocumentId) throw new Error('No matched documentId to update');
        await client.updateRecord('lessons', row.matchedDocumentId, updatePayload);
        summary.updated++;
        continue;
      }

      const createPayload: Record<string, unknown> = {
        ...basePayload,
        rabbi: rabbiId ? { connect: [rabbiId] } : undefined,
        subCategories: subCategoryId ? { connect: [subCategoryId] } : undefined,
        lesson_group: lessonGroupId ? { connect: [lessonGroupId] } : undefined,
        publishedAt: publishMode === 'publish' ? new Date().toISOString() : null
      };
      await client.createRecord('lessons', createPayload);
      summary.created++;
    } catch (err) {
      summary.errors++;
      const message = err instanceof Error ? err.message : String(err);
      log(`Error on lesson '${row.jsonValue}': ${message}`);
    }
    processed++;
    if (progress && processed % 5 === 0) {
      await progress(`מייבא שיעורים · ${processed}/${lessonsEntity.rows.length}`);
    }
  }

  return summary;
}

function mergeDecision(
  row: ImportRow,
  userDecision?: { decision?: RowDecision; mapTargetDocumentId?: string | null }
): { decision: RowDecision; mapTargetDocumentId: string | null } {
  if (!userDecision)
    return { decision: row.decision, mapTargetDocumentId: row.mapTargetDocumentId };
  return {
    decision: userDecision.decision ?? row.decision,
    mapTargetDocumentId: userDecision.mapTargetDocumentId ?? row.mapTargetDocumentId
  };
}

async function buildTaxonomyPayload(
  endpoint: Exclude<EntityKey, 'lessons'>,
  row: ImportRow,
  resolvedIds: Record<Exclude<EntityKey, 'lessons'>, Map<string, string>>
): Promise<Record<string, unknown>> {
  const value = row.jsonValue;
  switch (endpoint) {
    case 'rabbis':
      return { name: value, slug: ensureSlug(value) };
    case 'categories':
      return { title: value, slug: ensureSlug(value) };
    case 'sub-categories': {
      const parentId = row.parentValue ? resolvedIds.categories.get(row.parentValue) ?? null : null;
      return { title: value, slug: ensureSlug(value), category: parentId };
    }
    case 'lesson-groups': {
      const parentId = row.parentValue
        ? resolvedIds['sub-categories'].get(row.parentValue) ?? null
        : null;
      return { title: value, sub_category: parentId };
    }
  }
}

function ensureSlug(value: string): string {
  const base = String(value || '').trim();
  const ascii = base.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return ascii || `item-${Date.now()}`;
}

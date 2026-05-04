import type { StrapiClient } from './strapi';

interface RawListResponse<T> {
  data: T[];
  meta?: { pagination?: { page: number; pageCount: number } };
}

type RawWithMaybeAttrs = {
  attributes?: Record<string, unknown>;
} & Record<string, unknown>;

async function fetchAllPaginated(
  client: StrapiClient,
  endpoint: string,
  extraQuery: string
): Promise<RawWithMaybeAttrs[]> {
  const all: RawWithMaybeAttrs[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const sep = extraQuery ? `&${extraQuery}` : '';
    const json = await client.fetchStrapi<RawListResponse<RawWithMaybeAttrs>>(
      `${endpoint}?pagination[page]=${page}&pagination[pageSize]=100${sep}`
    );
    all.push(...(json.data ?? []));
    const p = json.meta?.pagination;
    if (!p || p.page >= p.pageCount) break;
    page++;
  }
  return all;
}

function readField(item: RawWithMaybeAttrs, field: string): string {
  const fromAttrs = (item.attributes as Record<string, unknown> | undefined)?.[field];
  const value = fromAttrs ?? item[field];
  return value == null ? '' : String(value).trim();
}

function dedupeAndSort(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he'));
}

export async function listCategories(client: StrapiClient): Promise<string[]> {
  const items = await fetchAllPaginated(client, 'categories', 'sort=title:asc');
  return dedupeAndSort(items.map((i) => readField(i, 'title')));
}

export async function listSubCategoriesByCategory(
  client: StrapiClient,
  categoryTitle?: string
): Promise<string[]> {
  const filter = categoryTitle
    ? `filters[category][title][$eq]=${encodeURIComponent(categoryTitle)}`
    : '';
  const items = await fetchAllPaginated(
    client,
    'sub-categories',
    [filter, 'sort=title:asc'].filter(Boolean).join('&')
  );
  return dedupeAndSort(items.map((i) => readField(i, 'title')));
}

export async function listLessonGroupsBySubCategory(
  client: StrapiClient,
  subCategoryTitle?: string
): Promise<string[]> {
  const filter = subCategoryTitle
    ? `filters[sub_category][title][$eq]=${encodeURIComponent(subCategoryTitle)}`
    : '';
  const items = await fetchAllPaginated(
    client,
    'lesson-groups',
    [filter, 'sort=title:asc'].filter(Boolean).join('&')
  );
  return dedupeAndSort(items.map((i) => readField(i, 'title')));
}

export async function listRabbis(client: StrapiClient): Promise<string[]> {
  const items = await fetchAllPaginated(client, 'rabbis', 'sort=name:asc');
  return dedupeAndSort(items.map((i) => readField(i, 'name')));
}

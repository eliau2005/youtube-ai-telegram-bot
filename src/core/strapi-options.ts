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

export interface ExistingTaxonomy {
  rabbis: string[];
  categories: string[];
  /** sub-categories grouped by their parent category title (only when populated) */
  subCategoriesUnderCategory: Record<string, string[]>;
  allSubCategories: string[];
  lessonGroups: string[];
}

export async function loadExistingTaxonomy(client: StrapiClient): Promise<ExistingTaxonomy> {
  // Fetch sub-categories with their parent category populated so the AI can be
  // told which sub-cats already belong to the user's main category.
  const allSubCats: { title: string; categoryTitle: string | null }[] = [];
  let page = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    interface RawSub {
      attributes?: Record<string, unknown>;
      title?: string;
      category?: { title?: string; data?: { attributes?: { title?: string } } };
    }
    interface RawSubResp {
      data: RawSub[];
      meta?: { pagination?: { page: number; pageCount: number } };
    }
    const json = await client.fetchStrapi<RawSubResp>(
      `sub-categories?populate[category]=true&pagination[page]=${page}&pagination[pageSize]=100`
    );
    for (const item of json.data ?? []) {
      const attrs = (item.attributes ?? item) as Record<string, unknown>;
      const title = String(attrs.title ?? '').trim();
      const cat = (attrs.category ?? item.category) as
        | { title?: string; data?: { attributes?: { title?: string } } }
        | undefined;
      const categoryTitle = (cat?.title ?? cat?.data?.attributes?.title ?? null) as string | null;
      if (title) allSubCats.push({ title, categoryTitle });
    }
    const p = json.meta?.pagination;
    if (!p || p.page >= p.pageCount) break;
    page++;
  }

  const subCategoriesUnderCategory: Record<string, string[]> = {};
  for (const sc of allSubCats) {
    if (sc.categoryTitle) {
      if (!subCategoriesUnderCategory[sc.categoryTitle]) {
        subCategoriesUnderCategory[sc.categoryTitle] = [];
      }
      subCategoriesUnderCategory[sc.categoryTitle].push(sc.title);
    }
  }

  const [rabbis, categories, lessonGroups] = await Promise.all([
    listRabbis(client),
    listCategories(client),
    listLessonGroupsBySubCategory(client)
  ]);

  return {
    rabbis,
    categories,
    subCategoriesUnderCategory,
    allSubCategories: dedupeAndSort(allSubCats.map((s) => s.title)),
    lessonGroups
  };
}

import { config } from '../config';

export interface StrapiLookupRecord {
  name: string;
  documentId: string;
  [extraField: string]: string;
}

export interface StrapiLookup {
  byName: Map<string, string>;
  byExtra: Record<string, Map<string, string>>;
  all: StrapiLookupRecord[];
}

export interface StrapiClient {
  url: string;
  fetchStrapi: <T = unknown>(urlPath: string, options?: RequestInit) => Promise<T>;
  buildLookupMap: (
    endpoint: string,
    nameField: string,
    extraFields?: string[]
  ) => Promise<StrapiLookup>;
  findOrCreate: (
    endpoint: string,
    filterValue: string | null | undefined,
    cache: Map<string, string>,
    payloadFactory: () => Promise<Record<string, unknown>>
  ) => Promise<string | null>;
  createRecord: (endpoint: string, payload: Record<string, unknown>) => Promise<string>;
  updateRecord: (
    endpoint: string,
    documentId: string,
    payload: Record<string, unknown>
  ) => Promise<string>;
}

interface StrapiListResponse<T> {
  data: T[];
  meta?: {
    pagination?: { page: number; pageCount: number; pageSize: number; total: number };
  };
}

interface StrapiItemResponse {
  data: { documentId?: string; id?: number; attributes?: Record<string, unknown> };
}

type RawItem = {
  documentId?: string;
  id?: number;
  attributes?: Record<string, unknown>;
} & Record<string, unknown>;

export function createStrapiClient(opts: { onLog?: (text: string) => void } = {}): StrapiClient {
  const onLog = opts.onLog ?? (() => {});
  const url = config.strapiUrl;
  const token = config.strapiToken;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };

  async function fetchStrapi<T = unknown>(urlPath: string, options: RequestInit = {}): Promise<T> {
    const fullUrl = `${url}/api/${urlPath}`;
    const response = await fetch(fullUrl, { ...options, headers });
    if (!response.ok) {
      const errorBody = await response.text();
      onLog(`Strapi request failed: ${fullUrl}`);
      onLog(`Status: ${response.status} ${errorBody}`);
      throw new Error(`Strapi API Error: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async function buildLookupMap(
    endpoint: string,
    nameField: string,
    extraFields: string[] = []
  ): Promise<StrapiLookup> {
    const byName = new Map<string, string>();
    const byExtra: Record<string, Map<string, string>> = {};
    const all: StrapiLookupRecord[] = [];
    for (const f of extraFields) byExtra[f] = new Map<string, string>();

    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const json = await fetchStrapi<StrapiListResponse<RawItem>>(
        `${endpoint}?pagination[page]=${page}&pagination[pageSize]=100`
      );
      for (const item of json.data ?? []) {
        const attrs = (item.attributes ?? item) as Record<string, unknown>;
        const name = String(attrs[nameField] ?? '').trim();
        const documentId = item.documentId ?? (item.id != null ? String(item.id) : '');
        if (!documentId) continue;
        const record: StrapiLookupRecord = { name, documentId };
        for (const f of extraFields) {
          const v = String(attrs[f] ?? '').trim();
          record[f] = v;
          if (v) byExtra[f].set(v, documentId);
        }
        if (name) byName.set(name, documentId);
        all.push(record);
      }
      const p = json.meta?.pagination;
      if (!p || p.page >= p.pageCount) break;
      page++;
    }

    return { byName, byExtra, all };
  }

  async function findOrCreate(
    endpoint: string,
    filterValue: string | null | undefined,
    cache: Map<string, string>,
    payloadFactory: () => Promise<Record<string, unknown>>
  ): Promise<string | null> {
    if (!filterValue) return null;
    const cached = cache.get(filterValue);
    if (cached) return cached;

    const payload = await payloadFactory();
    const result = await fetchStrapi<StrapiItemResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify({
        data: { ...payload, publishedAt: new Date().toISOString() }
      })
    });
    const newDocId = result.data.documentId ?? (result.data.id != null ? String(result.data.id) : '');
    if (!newDocId) throw new Error(`Strapi did not return a documentId for ${endpoint}`);
    cache.set(filterValue, newDocId);
    onLog(`Created '${endpoint}' record: ${filterValue}`);
    return newDocId;
  }

  async function createRecord(endpoint: string, payload: Record<string, unknown>): Promise<string> {
    const result = await fetchStrapi<StrapiItemResponse>(endpoint, {
      method: 'POST',
      body: JSON.stringify({ data: payload })
    });
    const id = result.data.documentId ?? (result.data.id != null ? String(result.data.id) : '');
    if (!id) throw new Error(`Strapi did not return a documentId for ${endpoint}`);
    return id;
  }

  async function updateRecord(
    endpoint: string,
    documentId: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    const result = await fetchStrapi<StrapiItemResponse>(`${endpoint}/${documentId}`, {
      method: 'PUT',
      body: JSON.stringify({ data: payload })
    });
    return result.data?.documentId ?? documentId;
  }

  return { url, fetchStrapi, buildLookupMap, findOrCreate, createRecord, updateRecord };
}

import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

const coercePositiveInt = z.coerce.number().int().min(1);

export const searchGlobalQuerySchema = z.object({
  keyword: z.string().trim().default(''),
  module: optionalQueryParam(z.string().trim().max(64)),
  entityType: optionalQueryParam(z.string().trim().max(64)),
  entityCode: optionalQueryParam(z.string().trim().max(120)),
  status: optionalQueryParam(z.union([z.coerce.number().int().min(1).max(4), z.string().trim()])),
  organizationUnitId: optionalQueryParam(intQueryParam({ min: 1 })),
  page: optionalQueryParam(intQueryParam({ min: 1 })),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
  includeStale: optionalQueryParam(booleanQueryParam()),
});
export type SearchGlobalQuery = z.infer<typeof searchGlobalQuerySchema>;

export const syncSearchIndexBodySchema = z.object({
  module: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityCode: z.string().trim().max(120).optional(),
  userIds: z.array(coercePositiveInt).optional(),
  documentIds: z.array(z.union([coercePositiveInt, z.string().trim().min(1)])).optional(),
  async: z.boolean().optional(),
});
export type SyncSearchIndexBody = z.infer<typeof syncSearchIndexBodySchema>;

export const rebuildSearchIndexBodySchema = z.object({
  module: z.string().trim().max(64).optional(),
  entityType: z.string().trim().max(64).optional(),
  entityCode: z.string().trim().max(120).optional(),
  async: z.boolean().optional(),
});
export type RebuildSearchIndexBody = z.infer<typeof rebuildSearchIndexBodySchema>;

export const searchIndexLagQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().max(64)),
  entityType: optionalQueryParam(z.string().trim().max(64)),
  entityCode: optionalQueryParam(z.string().trim().max(120)),
  staleOnly: optionalQueryParam(booleanQueryParam()),
  staleThresholdMs: optionalQueryParam(intQueryParam({ min: 0 })),
});
export type SearchIndexLagQuery = z.infer<typeof searchIndexLagQuerySchema>;

export const listZeroResultKeywordsQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().max(64)),
  entityType: optionalQueryParam(z.string().trim().max(64)),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 200 })),
});
export type ListZeroResultKeywordsQuery = z.infer<typeof listZeroResultKeywordsQuerySchema>;

export const listSearchableEntitiesQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  entityType: optionalQueryParam(z.string().trim().min(1).max(64)),
  includeAllModules: optionalQueryParam(booleanQueryParam()),
});

export type ListSearchableEntitiesQuery = z.infer<typeof listSearchableEntitiesQuerySchema>;

export const listSearchSyncHistoriesQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim().min(1).max(64)),
  operation: optionalQueryParam(z.enum(['SYNC', 'REBUILD', 'REMOVE'])),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)),
});

export type ListSearchSyncHistoriesQuery = z.infer<typeof listSearchSyncHistoriesQuerySchema>;

export const searchDocumentInputItemSchema = z.object({
  id: z.union([z.string().trim().min(1), z.number().int().positive()]),
  entityCode: z.string().trim().min(1).max(64),
  module: z.string().trim().min(1).max(64).optional(),
  entityType: z.string().trim().min(1).max(64).optional(),
  title: z.string().trim().min(1).max(255),
  subtitle: z.string().trim().max(500).nullable().optional(),
  keywords: z.array(z.string().trim().min(1)).optional(),
  searchableText: z.string().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  organizationUnitId: z.number().int().positive().nullable().optional(),
  status: z.union([z.number(), z.string()]).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sourceUpdatedAt: z.string().optional(),
  indexedAt: z.string().optional(),
});

export const indexSearchDocumentsBodySchema = z.object({
  documents: z.array(searchDocumentInputItemSchema).min(1).max(1000),
});

export type IndexSearchDocumentsBody = z.infer<typeof indexSearchDocumentsBodySchema>;

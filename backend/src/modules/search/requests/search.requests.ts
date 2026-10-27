import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  listZeroResultKeywordsQuerySchema,
  rebuildUserSearchIndexSchema,
  searchIndexLagQuerySchema,
  searchUsersGlobalQuerySchema,
  syncUserSearchIndexSchema,
} from '@modules/users/index.js';

export const searchGlobalQuerySchema = searchUsersGlobalQuerySchema;
export type SearchGlobalQuery = z.infer<typeof searchGlobalQuerySchema>;

export const syncSearchIndexBodySchema = syncUserSearchIndexSchema;
export type SyncSearchIndexBody = z.infer<typeof syncSearchIndexBodySchema>;

export const rebuildSearchIndexBodySchema = rebuildUserSearchIndexSchema;
export type RebuildSearchIndexBody = z.infer<typeof rebuildSearchIndexBodySchema>;

export { listZeroResultKeywordsQuerySchema, searchIndexLagQuerySchema };

export type SearchIndexLagQuery = z.infer<typeof searchIndexLagQuerySchema>;
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

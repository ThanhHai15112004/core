import { z } from 'zod';

export const registeredSearchableEntityResponseSchema = z.object({
  code: z.string(),
  module: z.string(),
  entityType: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  requiredPermission: z.string(),
  searchableFields: z.array(z.string()),
  titleField: z.string(),
  subtitleField: z.string().nullable(),
  staleThresholdMs: z.number(),
  isSystem: z.boolean(),
  status: z.number(),
  registeredAt: z.string(),
});

export const searchHitItemResponseSchema = z.object({
  documentKey: z.string(),
  id: z.union([z.string(), z.number()]),
  entityCode: z.string(),
  module: z.string(),
  entityType: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  score: z.number(),
  matchedHighlights: z.array(z.string()),
  ownerId: z.number().nullable(),
  organizationUnitId: z.number().nullable(),
  status: z.union([z.number(), z.string()]).nullable(),
  metadata: z.record(z.string(), z.unknown()),
  sourceUpdatedAt: z.string(),
  indexedAt: z.string(),
  indexLagMs: z.number(),
  isStale: z.boolean(),
});

export const searchQueryResultResponseSchema = z.object({
  keyword: z.string(),
  normalizedKeyword: z.string(),
  driverUsed: z.enum(['DATABASE', 'ELASTICSEARCH', 'OPENSEARCH']),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  staleHitCount: z.number(),
  maxIndexLagMs: z.number(),
  hits: z.array(searchHitItemResponseSchema),
});

export const searchSyncHistoryResponseSchema = z.object({
  id: z.number(),
  operation: z.enum(['SYNC', 'REBUILD', 'REMOVE']),
  module: z.string().nullable(),
  entityType: z.string().nullable(),
  entityCode: z.string().nullable(),
  driverUsed: z.enum(['DATABASE', 'ELASTICSEARCH', 'OPENSEARCH']),
  executionMode: z.enum(['SYNC', 'QUEUE']),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  indexedCount: z.number(),
  removedCount: z.number(),
  jobId: z.string().nullable(),
  actorId: z.number().nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
});

export const searchIndexLagReportResponseSchema = z.object({
  driverUsed: z.enum(['DATABASE', 'ELASTICSEARCH', 'OPENSEARCH']),
  totalIndexedDocuments: z.number(),
  staleDocumentCount: z.number(),
  maxLagMs: z.number(),
  averageLagMs: z.number(),
  items: z.array(
    z.object({
      documentKey: z.string(),
      id: z.union([z.string(), z.number()]),
      entityCode: z.string(),
      module: z.string(),
      entityType: z.string(),
      title: z.string(),
      sourceUpdatedAt: z.string(),
      indexedAt: z.string(),
      lagMs: z.number(),
      staleThresholdMs: z.number(),
      isStale: z.boolean(),
    }),
  ),
});

export const zeroResultKeywordStatResponseSchema = z.object({
  normalizedKeyword: z.string(),
  sampleKeyword: z.string(),
  searchCount: z.number(),
  lastSearchedAt: z.string(),
  modules: z.array(z.string()),
  entityTypes: z.array(z.string()),
  lastActorId: z.number().nullable(),
});

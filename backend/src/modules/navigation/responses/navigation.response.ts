import { z } from 'zod';

export const menuResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  module: z.string(),
  name: z.string(),
  status: z.number().int(),
  statusName: z.enum(['INACTIVE', 'ACTIVE']),
  link: z.string().nullable(),
  linkApi: z.string().nullable(),
  type: z.number().int(),
  typeName: z.enum(['GROUP', 'ITEM', 'EXTERNAL', 'ACTION']),
  parent: z.number().int().nullable(),
  parentCode: z.string().nullable(),
  level: z.number().int(),
  key: z.string().nullable(),
  numOrder: z.number().int(),
  icon: z.string().nullable(),
  position: z.enum(['SIDEBAR', 'TOPBAR', 'FOOTER', 'SYSTEM_CONSOLE']),
  updatedAt: z.string(),
});

export const menuTreeNodeResponseSchema: z.ZodType<unknown> = z.lazy(() =>
  menuResponseSchema.extend({
    children: z.array(menuTreeNodeResponseSchema),
  }),
);

export const menuTreeResponseSchema = z.object({
  position: z.string(),
  cacheVersion: z.number().int(),
  fromCache: z.boolean(),
  totalNodes: z.number().int(),
  items: z.array(menuTreeNodeResponseSchema),
});

export const syncMenusResultResponseSchema = z.object({
  syncedModules: z.array(z.string()),
  totalMenus: z.number().int(),
});

export const deleteMenuResultResponseSchema = z.object({
  deleted: z.literal(true),
  code: z.string(),
  id: z.number().int(),
});

export const invalidateMenuCacheResultResponseSchema = z.object({
  invalidated: z.literal(true),
  cacheVersion: z.number().int(),
});

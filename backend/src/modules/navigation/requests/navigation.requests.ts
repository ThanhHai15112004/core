import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

export const createMenuSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/i,
      'Menu code must be alphanumeric (dots, underscores, hyphens allowed)',
    ),
  module: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(255),
  status: z
    .union([z.number().int().min(0).max(1), z.string().trim().min(1), z.boolean()])
    .optional(),
  link: z.string().trim().max(255).nullable().optional(),
  linkApi: z.string().trim().max(255).nullable().optional(),
  type: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  parent: z.number().int().min(0).nullable().optional(),
  parentCode: z.string().trim().max(100).nullable().optional(),
  key: z.string().trim().max(150).nullable().optional(),
  numOrder: z.number().int().min(-10000).max(100000).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  position: z.string().trim().min(2).max(32).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CreateMenuRequest = z.infer<typeof createMenuSchema>;

export const updateMenuSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z
    .union([z.number().int().min(0).max(1), z.string().trim().min(1), z.boolean()])
    .optional(),
  link: z.string().trim().max(255).nullable().optional(),
  linkApi: z.string().trim().max(255).nullable().optional(),
  type: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  parent: z.number().int().min(0).nullable().optional(),
  parentCode: z.string().trim().max(100).nullable().optional(),
  key: z.string().trim().max(150).nullable().optional(),
  numOrder: z.number().int().min(-10000).max(100000).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  position: z.string().trim().min(2).max(32).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateMenuRequest = z.infer<typeof updateMenuSchema>;

export const toggleMenuSchema = z.object({
  status: z
    .union([z.number().int().min(0).max(1), z.string().trim().min(1), z.boolean()])
    .optional(),
  cascadeChildren: z.boolean().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ToggleMenuRequest = z.infer<typeof toggleMenuSchema>;

export const reorderMenusSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().min(2).max(100),
        numOrder: z.number().int().min(-10000).max(100000),
        parent: z.number().int().min(0).nullable().optional(),
        parentCode: z.string().trim().max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ReorderMenusRequest = z.infer<typeof reorderMenusSchema>;

export const listMenusQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim()),
  status: optionalQueryParam(intQueryParam({ min: 0, max: 1 })),
  type: optionalQueryParam(intQueryParam({ min: 1, max: 4 })),
  parent: optionalQueryParam(intQueryParam({ min: 0 })),
  level: optionalQueryParam(intQueryParam({ min: 1, max: 20 })),
  position: optionalQueryParam(z.string().trim()),
  q: optionalQueryParam(z.string().trim()),
});

export type ListMenusQuery = z.infer<typeof listMenusQuerySchema>;

export const getMenuTreeQuerySchema = z.object({
  position: optionalQueryParam(z.string().trim()),
  type: optionalQueryParam(intQueryParam({ min: 1, max: 4 })),
  includeInactive: optionalQueryParam(booleanQueryParam()),
});

export type GetMenuTreeQuery = z.infer<typeof getMenuTreeQuerySchema>;

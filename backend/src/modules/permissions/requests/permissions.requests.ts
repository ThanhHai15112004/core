import { z } from 'zod';

const modulePermissionDeclarationSchema = z.union([
  z.string().trim().min(2).max(128),
  z.object({
    code: z.string().trim().min(2).max(128),
    name: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    featureGroup: z.string().trim().min(1).max(100).optional(),
  }),
]);

export const syncPermissionsSchema = z
  .object({
    modules: z
      .array(
        z.object({
          module: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .regex(/^[a-z0-9_-]+$/i, 'Module name may only contain letters, digits, _ and -'),
          displayName: z.string().trim().min(1).max(150).optional(),
          permissions: z.array(modulePermissionDeclarationSchema),
        }),
      )
      .optional(),
    replaceActiveModules: z.boolean().optional(),
  })
  .default({});

export interface SyncPermissionsRequest {
  readonly modules?:
    | readonly {
        readonly module: string;
        readonly displayName?: string | undefined;
        readonly permissions: readonly (
          | string
          | {
              readonly code: string;
              readonly name?: string | undefined;
              readonly description?: string | null | undefined;
              readonly featureGroup?: string | undefined;
            }
        )[];
      }[]
    | undefined;
  readonly replaceActiveModules?: boolean | undefined;
}

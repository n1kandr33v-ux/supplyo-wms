import {z} from "zod";
export class WbError extends Error {
  constructor(
    public status: number,
    public retrySeconds = 60,
  ) {
    super(`WB HTTP ${status}`);
  }
}
export const orderSchema = z.object({
  id: z.number().int().nonnegative(),
  article: z.string().optional().default(""),
  skus: z.array(z.string()).optional().default([]),
  createdAt: z.string(),
  warehouseId: z.number().nullable().optional(),
  nmId: z.number().optional(),
  wbMetaVersion: z.literal(1).optional(),
  requiredMeta: z.array(z.string()).optional(),
  optionalMeta: z.array(z.string()).optional(),
});
export type WbOrder = z.infer<typeof orderSchema>;

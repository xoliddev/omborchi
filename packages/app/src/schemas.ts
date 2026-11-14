import { z } from 'zod';

export const id = z.guid();
export const optId = z.guid().nullish();
export const qty = z.coerce.number().positive().max(1e9);
export const money = z.coerce.number().min(0).max(1e13);
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());
export const text = (max = 200) => z.string().trim().max(max);
export const name = z.string().trim().min(1).max(200);

export const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
};

export const range = {
  from: dateStr.optional(),
  to: dateStr.optional(),
};

export const discount = z
  .object({ type: z.enum(['percent', 'amount']), value: z.coerce.number().min(0) })
  .nullish();

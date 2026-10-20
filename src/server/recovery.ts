import { z } from "zod";
import { pool, assert } from "./db";
import { transition } from "./entitlements";
export const lookupSchema = z
  .object({
    reservation_id: z.uuid().optional(),
    request_id: z.string().min(8).max(128).optional(),
  })
  .strict()
  .refine(
    (x) => Boolean(x.reservation_id) !== Boolean(x.request_id),
    "请提供一个预占ID或原业务请求号",
  );
export const recoverySchema = z
  .object({
    reservation_id: z.uuid().optional(),
    request_id: z.string().min(8).max(128).optional(),
    action: z.enum(["cancel", "refund"]),
    reason: z.string().trim().min(2).max(500),
  })
  .strict()
  .refine(
    (x) => Boolean(x.reservation_id) !== Boolean(x.request_id),
    "请提供一个预占ID或原业务请求号",
  );
export async function locateReservation(
  product: string,
  lookup: { reservation_id?: string; request_id?: string },
) {
  const rows = (
    await pool.query(
      `SELECT * FROM reservations WHERE product_id=$1 AND ${lookup.reservation_id ? "id=$2" : "request_id=$2"} LIMIT 2`,
      [product, lookup.reservation_id || lookup.request_id],
    )
  ).rows;
  assert(rows.length, 404, "RESERVATION_NOT_FOUND", "未找到本产品的预占记录");
  assert(
    rows.length === 1,
    409,
    "AMBIGUOUS_REQUEST",
    "请求号存在歧义，请使用可信任务中保存的预占ID",
  );
  return rows[0];
}
export const reservationStatus = (r: any) => ({
  id: r.id,
  request_id: r.request_id,
  product_id: r.product_id,
  feature_id: r.feature_id,
  amount: r.amount,
  status: r.status,
  expires_at: r.expires_at,
  updated_at: r.updated_at,
});
export async function recoverReservation(
  product: string,
  input: z.infer<typeof recoverySchema>,
) {
  const r = await locateReservation(product, input);
  return reservationStatus(
    await transition(r.uid, product, r.id, input.action, {
      product,
      reason: input.reason,
    }),
  );
}

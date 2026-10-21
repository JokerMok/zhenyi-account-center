import { z } from "zod";
import { pool, tx, assert, lock } from "./db";
import {
  audit,
  keySchema,
  reasonSchema,
  grantSchema,
  grant,
} from "./entitlements";
import { appConfigs, productApps } from "./config";
const httpUrl = z
  .url()
  .refine(
    (s) => ["http:", "https:"].includes(new URL(s).protocol),
    "仅支持 HTTP(S) 地址",
  );
const schemas = {
  products: z
    .object({
      id: keySchema,
      name: z.string().trim().min(1).max(80),
      status: z.enum(["active", "disabled"]),
      application: keySchema,
      callback_url: httpUrl,
      origin: httpUrl,
      reason: reasonSchema,
    })
    .strict(),
  features: z
    .object({
      product_id: keySchema,
      id: keySchema,
      name: z.string().trim().min(1).max(80),
      kind: z.enum(["access", "quota"]),
      member_only: z.boolean(),
      free_quota: z.number().int().min(0).max(1000000),
      period: z.enum(["once", "daily", "monthly"]),
      active: z.boolean(),
      reason: reasonSchema,
    })
    .strict(),
  plans: z
    .object({
      product_id: keySchema,
      id: keySchema,
      name: z.string().trim().min(1).max(80),
      days: z.number().int().min(1).max(36500),
      quotas: z.record(keySchema, z.number().int().min(0).max(1000000)),
      active: z.boolean(),
      casdoor_plan: z
        .string()
        .regex(/^consumers\/[a-zA-Z0-9_-]+$/)
        .nullable(),
      reason: reasonSchema,
    })
    .strict(),
};
export async function catalog() {
  const [products, features, plans] = await Promise.all(
    ["products", "features", "plans"].map((t) =>
      pool.query(
        `SELECT * FROM ${t} ORDER BY ${t === "products" ? "id" : "product_id,id"}`,
      ),
    ),
  );
  return {
    products: await Promise.all(
      products.rows.map(async (p) => {
        const a = productApps.find((a) => a.id === p.id);
        return {
          ...p,
          last_check:
            (
              await pool.query(
                "SELECT result FROM integration_checks WHERE product_id=$1 ORDER BY id DESC LIMIT 1",
                [p.id],
              )
            ).rows[0]?.result || null,
          integration_status: !a
            ? "未登记鉴权"
            : !a.enabled
              ? "鉴权已停用"
              : a.application !== p.application ||
                  a.url + "/auth/callback/" + a.id !== p.callback_url
                ? "登记不一致"
                : "配置已登记，尚未完成产品验收",
        };
      }),
    ),
    features: features.rows,
    plans: plans.rows,
  };
}
export async function saveCatalog(
  actor: string,
  type: keyof typeof schemas,
  input: unknown,
) {
  // Read-only metadata may be echoed by clients; never persist it from a write.
  let editable = input;
  if (type === "products" && input && typeof input === "object") {
    const copy = { ...input } as Record<string, unknown>;
    for (const field of [
      "created_at",
      "integration_status",
      "last_check",
      "verified_environment",
      "verified_at",
      "verification_note",
    ])
      delete copy[field];
    editable = copy;
  }
  const parsed = schemas[type].parse(editable) as any;
  const { reason, ...row } = parsed;
  return tx(async (db) => {
    const pk = type === "products" ? ["id"] : ["product_id", "id"];
    await lock(db, `catalog:${type}:${pk.map((k) => row[k]).join("/")}`);
    const where = pk.map((k, i) => `${k}=$${i + 1}`).join(" AND ");
    const before =
      (
        await db.query(
          `SELECT * FROM ${type} WHERE ${where} FOR UPDATE`,
          pk.map((k) => row[k]),
        )
      ).rows[0] || null;
    if (type === "features" && before) {
      const used = (
        await db.query(
          "SELECT 1 FROM quota_buckets WHERE product_id=$1 AND feature_id=$2 LIMIT 1",
          [row.product_id, row.id],
        )
      ).rowCount;
      assert(
        !used || (row.kind === before.kind && row.period === before.period),
        409,
        "FEATURE_IN_USE",
        "已有额度流水的功能不能更改计次类型或周期，请新建功能标识",
      );
    }
    if (type === "plans")
      for (const f of Object.keys(row.quotas))
        assert(
          (
            await db.query(
              "SELECT 1 FROM features WHERE product_id=$1 AND id=$2 AND kind='quota'",
              [row.product_id, f],
            )
          ).rowCount,
          400,
          "INVALID_FEATURE",
          "套餐中的次数功能不存在",
        );
    const cols = Object.keys(row);
    const updates = cols
      .filter((c) => !pk.includes(c))
      .map((c) => `${c}=EXCLUDED.${c}`)
      .join(",");
    const after = (
      await db.query(
        `INSERT INTO ${type}(${cols.join(",")}) VALUES(${cols.map((_, i) => `$${i + 1}`).join(",")})
   ON CONFLICT(${pk.join(",")}) DO UPDATE SET ${updates} RETURNING *`,
        cols.map((c) => row[c]),
      )
    ).rows[0];
    await audit(
      db,
      actor,
      `configure_${type}`,
      pk.map((k) => row[k]).join("/"),
      reason,
      before,
      after,
    );
    return after;
  });
}
export async function seedCatalog() {
  await tx(async (db) => {
    for (const id of ["beadgrid", "focustake"] as const) {
      const a = appConfigs[id];
      if (!a) continue;
      await db.query(
        "INSERT INTO products(id,name,application,callback_url,origin) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [id, a.name, a.application, a.url + `/auth/callback/${id}`, a.url],
      );
      await db.query(
        `INSERT INTO features(product_id,id,name,kind,member_only,free_quota,period) VALUES
    ($1,'export',$2,'quota',false,$3,'once'),($1,'studio',$4,'access',true,0,'once') ON CONFLICT DO NOTHING`,
        [
          id,
          id === "beadgrid" ? "图纸导出" : "任务导出",
          id === "beadgrid" ? 3 : 2,
          id === "beadgrid" ? "高级配色" : "高级录制设置",
        ],
      );
      await db.query(
        `INSERT INTO plans(product_id,id,name,days,quotas,casdoor_plan) VALUES($1,'monthly','月度会员权益',30,'{"export":20}',$2) ON CONFLICT DO NOTHING`,
        [id, `consumers/${id}-monthly`],
      );
    }
  });
}

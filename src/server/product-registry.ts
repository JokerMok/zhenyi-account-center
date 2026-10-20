import { readFileSync } from "node:fs";
import { z } from "zod";
const key = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const schema = z.array(
  z
    .object({
      id: z
        .string()
        .regex(/^[a-z][a-z0-9_-]{1,39}$/)
        .refine((x) => !["center", "admin"].includes(x)),
      name: z.string().min(1),
      url: z.url(),
      urlEnv: key.optional(),
      application: z
        .string()
        .regex(/^[a-z][a-z0-9_-]{1,99}$/)
        .refine(
          (x) => !["zhenyi-center", "zhenyi-admin", "app-built-in"].includes(x),
        ),
      clientIdEnv: key,
      clientSecretEnv: key,
      serviceKeyEnv: key,
      enabled: z.boolean(),
      port: z.number().int().min(1024).max(65535).optional(),
    })
    .strict(),
);
export function readProductRegistry(
  file = process.env.PRODUCTS_CONFIG || "config/products.json",
) {
  const records = schema.parse(JSON.parse(readFileSync(file, "utf8")));
  for (const field of [
    "id",
    "application",
    "clientIdEnv",
    "clientSecretEnv",
    "serviceKeyEnv",
  ] as const)
    if (new Set(records.map((x) => x[field])).size !== records.length)
      throw Error(`产品配置 ${field} 重复`);
  return records;
}

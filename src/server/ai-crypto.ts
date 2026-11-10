import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
function key(material: string) {
  if (material.length < 32) throw Error("模型密钥加密材料不足");
  return Buffer.from(
    hkdfSync("sha256", material, "zhenyi-account-center", "ai-config-v1", 32),
  );
}
export function encryptModelKey(secret: string, material: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(material), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function decryptModelKey(value: string, material: string) {
  const [version, iv, tag, data, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra)
    throw Error("模型密钥格式无效");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(material),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(data, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

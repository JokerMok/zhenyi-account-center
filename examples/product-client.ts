/** Server-side only. Never ship the service key or user token to a browser. */
export class CenterRequestError extends Error {
  constructor(
    message: string,
    public outcome: "rejected" | "unknown",
    public status?: number,
    public code?: string,
  ) {
    super(message);
  }
}
export function createEntitlementClient(options: {
  centerUrl: string;
  productId: string;
  serviceKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}) {
  const base = new URL(
    `/api/v1/products/${encodeURIComponent(options.productId)}`,
    options.centerUrl,
  ).href;
  async function call(token: string | undefined, path: string, body?: unknown) {
    let response: Response;
    try {
      response = await (options.fetch || fetch)(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${options.serviceKey}`,
          ...(token ? { "X-User-Token": token } : {}),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs || 15000),
      });
    } catch {
      throw new CenterRequestError(
        "中心响应未知，请保留原任务并查询状态",
        "unknown",
      );
    }
    let result: any;
    try {
      result = await response.json();
    } catch {
      throw new CenterRequestError(
        "中心响应不完整，请查询状态",
        "unknown",
        response.status,
      );
    }
    if (!response.ok)
      throw new CenterRequestError(
        result.error || "中心请求失败",
        response.status >= 500 ? "unknown" : "rejected",
        response.status,
        result.code,
      );
    return result;
  }
  type Locator =
    | { reservation_id: string; request_id?: never }
    | { request_id: string; reservation_id?: never };
  const status = (lookup: Locator) =>
    call(
      undefined,
      "/recovery/reservations?" +
        new URLSearchParams(
          Object.entries(lookup).filter(([, v]) => v !== undefined) as [
            string,
            string,
          ][],
        ),
    );
  return {
    get: (token: string) => call(token, "/entitlements"),
    check: (token: string, feature: string) =>
      call(token, "/check", { feature_id: feature }),
    reserve: (token: string, feature: string, requestId: string, amount = 1) =>
      call(token, "/reservations", {
        feature_id: feature,
        request_id: requestId,
        amount,
      }),
    confirm: (token: string, id: string) =>
      call(token, `/reservations/${encodeURIComponent(id)}/confirm`, {}),
    cancel: (token: string, id: string) =>
      call(token, `/reservations/${encodeURIComponent(id)}/cancel`, {}),
    refund: (token: string, id: string) =>
      call(token, `/reservations/${encodeURIComponent(id)}/refund`, {}),
    status,
    recover: (lookup: Locator, action: "cancel" | "refund", reason: string) =>
      call(undefined, "/recovery", { ...lookup, action, reason }),
    async confirmKnown(token: string, id: string) {
      try {
        return await call(
          token,
          `/reservations/${encodeURIComponent(id)}/confirm`,
          {},
        );
      } catch (error) {
        if (
          !(error instanceof CenterRequestError) ||
          error.outcome !== "unknown"
        )
          throw error;
        // A timeout is not a failed debit. Only authoritative status resolves it.
        const current = await status({ reservation_id: id });
        if (current.status === "reserved")
          return call(
            token,
            `/reservations/${encodeURIComponent(id)}/confirm`,
            {},
          );
        return current;
      }
    },
  };
}

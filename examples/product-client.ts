/** Minimal reusable server-side adapter. Copy into a real product BACKEND, never bundle in browser code. */
export function createEntitlementClient(options: {
  centerUrl: string;
  productId: string;
  serviceKey: string;
}) {
  const base = new URL(
    `/api/v1/products/${encodeURIComponent(options.productId)}`,
    options.centerUrl,
  ).href;
  async function call(userAccessToken: string, path: string, body?: unknown) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${options.serviceKey}`,
        "X-User-Token": userAccessToken,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error), {
        status: response.status,
        code: result.code,
      });
    return result;
  }
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
  };
}

/**
 * Requests to the website from inside the Android app. The app's pages come from https://localhost, and the site
 * sends no cross-origin headers, so a plain fetch to it is refused by the WebView. CapacitorHttp makes the request
 * natively instead. Every Android request to SITE_URL goes through here or through the route store's Device.
 */
export async function siteGetText(url: string, timeoutMs = 10_000): Promise<string> {
  const { CapacitorHttp } = await import("@capacitor/core");
  const res = await CapacitorHttp.get({ url, responseType: "text", connectTimeout: timeoutMs, readTimeout: timeoutMs });
  if (res.status < 200 || res.status >= 300) throw new Error(`site ${res.status}`);
  return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
}

export async function siteGetJson(url: string, timeoutMs?: number): Promise<unknown> {
  return JSON.parse(await siteGetText(url, timeoutMs)) as unknown;
}

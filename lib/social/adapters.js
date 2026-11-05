// Platform publishing adapters. Each takes the same input and returns { ok, externalId, permalink } or { ok: false, error }.
// They never throw and never put a token in a message. fetch is injected so tests can use a stand-in.
//
// IMPORTANT: written from general knowledge of the Meta Graph API and LinkedIn Posts API and tested ONLY against
// stand-ins. They have not been run against the live platforms. Endpoint names, versions, scopes and review
// requirements change; read each platform's current developer docs before first use (see ARCHITECTURE.md).
import { PLATFORMS } from "./platforms.js";

const TIMEOUT = 20_000;
const graph = (env) => `https://graph.facebook.com/${(env.META_GRAPH_VERSION || "v23.0").replace(/[^v0-9.]/g, "")}`;
const li = (env) => ({ version: (env.LINKEDIN_API_VERSION || "202511").replace(/\D/g, "").slice(0, 6) });

async function call(fetchImpl, url, init = {}) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    return { ok: false, error: "Could not reach the platform. It will be retried when you press Retry." };
  }
  let body = null;
  try { body = await res.json(); } catch { /* some replies have no body */ }
  if (!res.ok) {
    const code = body?.error?.code || body?.status || res.status;
    const msg = String(body?.error?.message || body?.message || "").replace(/access_token=[^&\s]+/gi, "").slice(0, 160);
    if (res.status === 401 || body?.error?.code === 190) return { ok: false, error: "The platform rejected the saved token. Reconnect the account with a new token." };
    return { ok: false, error: `The platform refused the post (${code}). ${msg}`.trim() };
  }
  return { ok: true, body, headers: res.headers };
}

const form = (o) => new URLSearchParams(o).toString();
const FORM = { "Content-Type": "application/x-www-form-urlencoded" };

export const adapters = {
  async facebook({ account, secret, text, imageUrl, env, fetchImpl }) {
    const base = `${graph(env)}/${encodeURIComponent(account.external_id)}`;
    const r = imageUrl
      ? await call(fetchImpl, `${base}/photos`, { method: "POST", headers: FORM, body: form({ url: imageUrl, caption: text, access_token: secret.token }) })
      : await call(fetchImpl, `${base}/feed`, { method: "POST", headers: FORM, body: form({ message: text, access_token: secret.token }) });
    if (!r.ok) return r;
    const id = String(r.body?.post_id || r.body?.id || "");
    if (!id) return { ok: false, error: "The platform replied without a post id. Check Facebook before retrying so it is not posted twice." };
    return { ok: true, externalId: id, permalink: `https://www.facebook.com/${id}` };
  },

  async instagram({ account, secret, text, imageUrl, env, fetchImpl }) {
    if (!imageUrl) return { ok: false, error: "Instagram needs an image." };
    const base = `${graph(env)}/${encodeURIComponent(account.external_id)}`;
    const c = await call(fetchImpl, `${base}/media`, { method: "POST", headers: FORM, body: form({ image_url: imageUrl, caption: text, access_token: secret.token }) });
    if (!c.ok) return c;
    const creation = String(c.body?.id || "");
    if (!creation) return { ok: false, error: "Instagram did not accept the image." };
    const p = await call(fetchImpl, `${base}/media_publish`, { method: "POST", headers: FORM, body: form({ creation_id: creation, access_token: secret.token }) });
    if (!p.ok) return p;
    const id = String(p.body?.id || "");
    if (!id) return { ok: false, error: "Instagram replied without a post id. Check Instagram before retrying so it is not posted twice." };
    const info = await call(fetchImpl, `${graph(env)}/${encodeURIComponent(id)}?${form({ fields: "permalink", access_token: secret.token })}`);
    return { ok: true, externalId: id, permalink: info.ok ? String(info.body?.permalink || "") : "" };
  },

  async linkedin({ account, secret, text, imageBytes, env, fetchImpl }) {
    const { version } = li(env);
    const headers = { Authorization: `Bearer ${secret.token}`, "LinkedIn-Version": version, "X-Restli-Protocol-Version": "2.0.0", "Content-Type": "application/json" };
    const author = `urn:li:person:${account.external_id}`;
    let content;
    if (imageBytes) {
      const init = await call(fetchImpl, "https://api.linkedin.com/rest/images?action=initializeUpload", { method: "POST", headers, body: JSON.stringify({ initializeUploadRequest: { owner: author } }) });
      if (!init.ok) return init;
      const uploadUrl = init.body?.value?.uploadUrl;
      const image = init.body?.value?.image;
      let host = "";
      try { host = new URL(uploadUrl).hostname; } catch { /* handled below */ }
      if (!image || !/(^|\.)linkedin\.com$|(^|\.)licdn\.com$/.test(host)) return { ok: false, error: "LinkedIn sent an unexpected upload address. Nothing was posted." };
      const up = await call(fetchImpl, uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${secret.token}`, "Content-Type": "application/octet-stream" }, body: imageBytes });
      if (!up.ok) return up;
      content = { media: { id: image, altText: "Post graphic" } };
    }
    const body = {
      author, commentary: text, visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
      ...(content ? { content } : {}),
    };
    const r = await call(fetchImpl, "https://api.linkedin.com/rest/posts", { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) return r;
    const id = r.headers?.get?.("x-restli-id") || "";
    if (!id) return { ok: false, error: "LinkedIn replied without a post id. Check LinkedIn before retrying so it is not posted twice." };
    return { ok: true, externalId: id, permalink: `https://www.linkedin.com/feed/update/${id}` };
  },
};

/** Cheap read-only check that a saved token still works. Never posts. */
export async function checkAccount({ platform, account, secret, env = process.env, fetchImpl = fetch }) {
  if (!PLATFORMS[platform]?.direct) return { ok: true, message: "Assisted posting needs no connection." };
  if (!secret?.token || !account.external_id) return { ok: false, message: "Add the account id and the access token first." };
  if (platform === "linkedin") {
    const r = await call(fetchImpl, "https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${secret.token}` } });
    if (!r.ok) return { ok: false, message: r.error };
    if (r.body?.sub && String(r.body.sub) !== String(account.external_id)) return { ok: false, message: "The token works, but it belongs to a different LinkedIn member id than the one saved." };
    return { ok: true, message: `Connected as ${String(r.body?.name || "this member").slice(0, 60)}.` };
  }
  const fields = platform === "instagram" ? "username" : "name";
  const r = await call(fetchImpl, `${graph(env)}/${encodeURIComponent(account.external_id)}?${form({ fields, access_token: secret.token })}`);
  if (!r.ok) return { ok: false, message: r.error };
  return { ok: true, message: `Connected to ${String(r.body?.username || r.body?.name || "the account").slice(0, 60)}.` };
}

/**
 * Shared Supabase (PostgREST) helpers — used by the serverless API routes only.
 *
 * SECURITY: the service key is read from process.env and NEVER sent to the browser.
 * All user input is sanitised and every column/sort/filter is whitelisted, so the
 * public API cannot be used to read other tables, inject filters, or write data.
 */
"use strict";

const TABLE = "belconnen_sold";

// Columns returned in the LIST view (kept small so payloads stay light at scale).
const LIST_COLS = [
  "id", "suburb", "address", "street", "postcode", "price_sold_price", "status",
  "property_type", "bedrooms", "bathrooms", "parking", "eer", "sold_date",
  "image_urls", "image_count", "listing_url",
].join(",");

// Whitelisted sort options (UI value -> PostgREST order expression).
// NOTE: price is stored as formatted text ("$1,200,000"), so we do NOT offer a
// numeric price sort (it would sort lexically and mislead). Date/text sorts only.
const SORTS = {
  suburb_asc:  "suburb.asc.nullslast,address.asc",
  suburb_desc: "suburb.desc.nullslast,address.asc",
  sold_new:    "sold_date.desc.nullslast,suburb.asc",
  sold_old:    "sold_date.asc.nullslast,suburb.asc",
  updated:     "last_updated.desc.nullslast",
};
const DEFAULT_SORT = "suburb_asc";

// Whitelisted equality filters (request key -> actual column).
const FILTER_COLS = { suburb: "suburb", status: "status", type: "property_type", beds: "bedrooms" };

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_KEY"].filter(Boolean).join(", ");
    const e = new Error("Missing required env var(s): " + missing);
    e.code = "NO_ENV";
    throw e;
  }
  return { base: url.replace(/\/+$/, "") + "/rest/v1/" + TABLE, key };
}

function headers(key, extra) {
  return Object.assign(
    { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" },
    extra || {}
  );
}

// Free-text search term: strip characters that have meaning in PostgREST's
// or=()/ilike grammar, collapse whitespace, cap length.
function sanitizeTerm(s) {
  return String(s == null ? "" : s)
    .replace(/[,()*:%\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

// Equality value: remove quotes/backslashes (we wrap the value in quotes), cap length.
function sanitizeValue(s) {
  return String(s == null ? "" : s).replace(/["\\]/g, "").trim().slice(0, 120);
}

function clampInt(v, def, min, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}

/** Build the PostgREST query string for the list view from raw request query params. */
function buildListQuery(q) {
  q = q || {};
  const params = ["select=" + LIST_COLS];

  // whitelisted equality filters
  for (const [key, col] of Object.entries(FILTER_COLS)) {
    const raw = q[key];
    if (raw != null && String(raw).trim() !== "" && String(raw) !== "all") {
      const val = sanitizeValue(raw);
      if (val) params.push(col + "=eq." + encodeURIComponent('"' + val + '"'));
    }
  }

  // free-text search across address / suburb / street
  const term = sanitizeTerm(q.q);
  if (term) {
    const inner = "(address.ilike.*" + term + "*,suburb.ilike.*" + term + "*,street.ilike.*" + term + "*)";
    params.push("or=" + encodeURIComponent(inner));
  }

  // whitelisted sort
  const sort = SORTS[q.sort] || SORTS[DEFAULT_SORT];
  params.push("order=" + encodeURIComponent(sort));

  // pagination
  const page = clampInt(q.page, 1, 1, 1000000);
  const size = clampInt(q.pageSize, 50, 1, 100);
  const offset = (page - 1) * size;
  params.push("limit=" + size);
  params.push("offset=" + offset);

  return { qs: params.join("&"), page, size, offset };
}

/** Parse the total row count out of a PostgREST Content-Range header ("0-49/6000"). */
function parseTotal(contentRange) {
  if (!contentRange) return null;
  const m = String(contentRange).match(/\/(\d+|\*)\s*$/);
  if (!m || m[1] === "*") return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  TABLE, LIST_COLS, SORTS, DEFAULT_SORT, FILTER_COLS,
  env, headers, sanitizeTerm, sanitizeValue, clampInt, buildListQuery, parseTotal,
};

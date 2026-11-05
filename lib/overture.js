// Reads business listings from Overture Maps, an open dataset published as files in a public
// bucket (no account, key, or billing). We ask for one small rectangle at a time and keep only
// places that list a website or a social page, which is all verification needs.
// DuckDB (a library) does the reading. It is loaded only when needed, so the rest of the app works
// even if it is missing.
const BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com";

/** The newest release folder name, like "2026-10-21.0". Overture publishes a new one about monthly. */
export async function latestRelease({ fetchImpl = fetch, env = process.env } = {}) {
  if (env.OVERTURE_RELEASE && /^\d{4}-\d{2}-\d{2}\.\d+$/.test(env.OVERTURE_RELEASE)) return env.OVERTURE_RELEASE;
  const res = await fetchImpl(`${BUCKET}/?prefix=release/&delimiter=/`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("Could not reach Overture Maps to find the latest data release.");
  const text = await res.text();
  const releases = [...text.matchAll(/<Prefix>release\/(\d{4}-\d{2}-\d{2}\.\d+)\/<\/Prefix>/g)].map((m) => m[1]).sort();
  if (!releases.length) throw new Error("Overture Maps returned no data releases.");
  return releases.at(-1);
}

/** SQL for one rectangle. Numbers are validated here, so nothing user supplied is ever put in the text. */
export function buildPlacesQuery(release, box) {
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(release)) throw new Error("Bad release name.");
  const n = (v) => {
    const x = Number(v);
    if (!Number.isFinite(x) || Math.abs(x) > 180) throw new Error("Bad coordinates.");
    return x;
  };
  const { west, east, south, north } = { west: n(box.west), east: n(box.east), south: n(box.south), north: n(box.north) };
  return `
    SELECT names.primary AS name, websites, socials, phones, addresses[1].locality AS city,
           bbox.xmin AS lon, bbox.ymin AS lat, confidence
    FROM read_parquet('s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*', hive_partitioning=1)
    WHERE bbox.xmin BETWEEN ${west} AND ${east} AND bbox.ymin BETWEEN ${south} AND ${north}
      AND names.primary IS NOT NULL AND (websites IS NOT NULL OR socials IS NOT NULL)`;
}

/** Make a row from the query into the shape matching expects. */
export function normalizeRow(r) {
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return {
    name: String(r.name || ""),
    city: r.city ? String(r.city) : "",
    websites: list(r.websites),
    socials: list(r.socials),
    phones: list(r.phones),
    lat: r.lat == null ? null : Number(r.lat),
    lon: r.lon == null ? null : Number(r.lon),
    confidence: Number(r.confidence) || 0,
  };
}

let connectionPromise;
async function connection() {
  connectionPromise ??= (async () => {
    let mod;
    try {
      mod = await import("@duckdb/node-api");
    } catch {
      throw new Error("The free website lookup needs the DuckDB package. Run npm install, then restart Kestrel.");
    }
    const instance = await mod.DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    await conn.run("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';");
    return conn;
  })().catch((err) => {
    connectionPromise = undefined; // allow a retry
    throw err;
  });
  return connectionPromise;
}

/** Places in a rectangle { west, east, south, north } that list a website or social page. */
export async function fetchPlaces(box, { release } = {}) {
  const rel = release || (await latestRelease());
  const conn = await connection();
  const result = await conn.runAndReadAll(buildPlacesQuery(rel, box));
  return result.getRowObjectsJson().map(normalizeRow);
}

/** A rectangle around a place, grown a little so businesses on the edge are included. */
export function expandBox(box, degrees = 0.02) {
  return { south: box.south - degrees, north: box.north + degrees, west: box.west - degrees, east: box.east + degrees };
}

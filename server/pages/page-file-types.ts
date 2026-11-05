/** What a page's files may be, by extension, and the Content-Type each is served with. The rest of a folder stays out
 * of the page (server/pages/bundle.ts) and the folder page route never serves it (server/page-files.ts). */
export const PAGE_FILE_TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8", ndjson: "application/x-ndjson; charset=utf-8", md: "text/markdown; charset=utf-8",
  geojson: "application/geo+json", topojson: "application/json; charset=utf-8",
  parquet: "application/vnd.apache.parquet", arrow: "application/vnd.apache.arrow.file", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};
export const PAGE_FILE_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(PAGE_FILE_TYPES));

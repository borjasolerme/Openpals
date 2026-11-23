// Screenshots a bot's tools take (a lent Mac's screen, a browser page) are kept for the chat to show, not for the model:
// the model already had the full picture. A Retina screen is 3–7 MB as PNG, so the kept copy is scaled down and saved
// as JPEG, about a twentieth of that.
import { encode as encodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";

/** Longest side of a kept screenshot, in pixels: still readable in the chat, a quarter of a Retina screen. */
export const TOOL_SCREENSHOT_MAX_SIDE = 1600;
/** Kept screenshots go after this long; the person's own files never do. */
export const TOOL_SCREENSHOT_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/** Name prefix that marks a stored file as a tool's screenshot, so it can expire on its own. */
export const TOOL_SCREENSHOT_PREFIX = "tool-";

/** JPEG quality for a kept screenshot: text stays sharp enough to read. */
const JPEG_QUALITY = 80;

export interface KeptImage { bytes: Buffer; mime: string }

/** A PNG screenshot scaled so its longest side fits TOOL_SCREENSHOT_MAX_SIDE and saved as JPEG; each output pixel averages
 * the block of input pixels it covers. A picture with see-through parts stays PNG (JPEG has none). Anything that is not a
 * PNG, cannot be read, or would not come out smaller is kept as it was. */
export function shrinkScreenshot(bytes: Buffer, mime: string): KeptImage {
  const kept = { bytes, mime };
  if (mime.split(";")[0]!.trim().toLowerCase() !== "image/png") return kept;
  let source: PNG;
  try {
    source = PNG.sync.read(bytes);
  } catch {
    return kept;
  }
  const { width, height, data } = source;
  const scale = Math.max(1, Math.max(width, height) / TOOL_SCREENSHOT_MAX_SIDE);
  const outWidth = Math.max(1, Math.round(width / scale));
  const outHeight = Math.max(1, Math.round(height / scale));
  const out = new PNG({ width: outWidth, height: outHeight });
  let opaque = true;
  for (let y = 0; y < outHeight; y++) {
    const y0 = Math.floor((y * height) / outHeight);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * height) / outHeight));
    for (let x = 0; x < outWidth; x++) {
      const x0 = Math.floor((x * width) / outWidth);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * width) / outWidth));
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = y0; sy < y1; sy++) {
        let at = (sy * width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, at += 4) {
          r += data[at]!; g += data[at + 1]!; b += data[at + 2]!; a += data[at + 3]!;
        }
      }
      const count = (y1 - y0) * (x1 - x0);
      const to = (y * outWidth + x) * 4;
      out.data[to] = Math.round(r / count);
      out.data[to + 1] = Math.round(g / count);
      out.data[to + 2] = Math.round(b / count);
      out.data[to + 3] = Math.round(a / count);
      if (out.data[to + 3] !== 255) opaque = false;
    }
  }
  try {
    const shrunk = opaque
      ? { bytes: encodeJpeg({ width: outWidth, height: outHeight, data: out.data }, JPEG_QUALITY).data, mime: "image/jpeg" }
      : { bytes: PNG.sync.write(out, { colorType: 6 }), mime: "image/png" };
    return shrunk.bytes.byteLength < bytes.byteLength ? shrunk : kept;
  } catch {
    return kept;
  }
}

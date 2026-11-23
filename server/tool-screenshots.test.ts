import { decode as decodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { shrinkScreenshot, TOOL_SCREENSHOT_MAX_SIDE } from "./tool-screenshots.ts";

/** A noisy RGBA picture, so it compresses about as badly as a real screen. */
function picture(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  let seed = 7;
  for (let at = 0; at < png.data.length; at += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    png.data[at] = seed & 255; png.data[at + 1] = (seed >> 8) & 255; png.data[at + 2] = (seed >> 16) & 255; png.data[at + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("shrinkScreenshot", () => {
  it("scales a large screenshot so its longest side fits, keeping its shape, as a much smaller JPEG", () => {
    const big = picture(2880, 1800);
    const kept = shrinkScreenshot(big, "image/png");
    expect(kept.mime).toBe("image/jpeg");
    const shrunk = decodeJpeg(kept.bytes);
    expect([shrunk.width, shrunk.height]).toEqual([TOOL_SCREENSHOT_MAX_SIDE, 1000]);
    expect(kept.bytes.byteLength).toBeLessThan(big.byteLength / 4);
  });

  it("keeps a picture with see-through parts as PNG", () => {
    const png = new PNG({ width: 3200, height: 4 });
    const kept = shrinkScreenshot(PNG.sync.write(png), "image/png");
    expect(kept.mime).toBe("image/png");
    expect(PNG.sync.read(kept.bytes).width).toBe(1600);
  });

  it("averages the pixels it folds together", () => {
    const png = new PNG({ width: 3200, height: 2 });
    for (let x = 0; x < 3200; x++) for (let y = 0; y < 2; y++) {
      const at = (y * 3200 + x) * 4;
      png.data[at] = x % 2 ? 200 : 100; png.data[at + 3] = 255;
    }
    const shrunk = decodeJpeg(shrinkScreenshot(PNG.sync.write(png), "image/png").bytes);
    expect(shrunk.width).toBe(1600);
    expect(Math.abs(shrunk.data[0]! - 150)).toBeLessThan(6);
  });

  it("keeps a picture that is not a PNG, and bytes it cannot read, as they were", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(shrinkScreenshot(jpeg, "image/jpeg")).toEqual({ bytes: jpeg, mime: "image/jpeg" });
    const broken = Buffer.from("not a png");
    expect(shrinkScreenshot(broken, "image/png")).toEqual({ bytes: broken, mime: "image/png" });
  });
});

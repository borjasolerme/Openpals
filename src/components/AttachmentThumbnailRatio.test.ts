import { describe, expect, it } from "vitest";
import { thumbnailRatio } from "./AttachmentPreview";

describe("chat image thumbnails keep a standard frame", () => {
  it("shows a full-page screenshot as its top, in a 3:4 frame at most", () => {
    expect(thumbnailRatio(1280, 9000)).toBe(3 / 4);
  });

  it("keeps an ordinary screenshot or photo as it is", () => {
    expect(thumbnailRatio(1280, 800)).toBe(1.6);
    expect(thumbnailRatio(1080, 1350)).toBe(0.8);
  });

  it("stops very wide images at 2:1", () => {
    expect(thumbnailRatio(4000, 500)).toBe(2);
  });
});

/** A thumbnail keeps a standard frame: a full-page screenshot or a long scan shows its top in a 3:4 frame at most,
 * capped by max-h-96, and opens whole in the viewer; wide images stop at 2:1. */
export function thumbnailRatio(width: number, height: number): number {
  return Math.min(Math.max(width / height, 3 / 4), 2);
}

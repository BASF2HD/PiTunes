/**
 * Side-count heuristic (navidrome_coverflow coverflow.js).
 */

export const CONFIG = {
  maxSideCount: 18
};

export function computeVisibleSideCount(containerWidth) {
  const count = Math.ceil(containerWidth / 100);
  return Math.min(count, CONFIG.maxSideCount);
}

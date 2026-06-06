/* =============================================================
   coverflow.js — Pure geometry module
   Computes cover positions, rotations, scales, and opacities
   for an iTunes-style CoverFlow layout.

   ★ No Three.js dependency — returns plain numeric data.
   ★ All visual tuning lives in CONFIG below.
   ============================================================= */

const DEG2RAD = Math.PI / 180;

/**
 * CoverFlow geometry configuration.
 *
 * Classic iTunes CoverFlow geometry:
 *   - Center cover faces the camera, full size
 *   - Side covers are the SAME size but rotated ~70° and pushed back in Z
 *   - Side covers are tightly packed (overlapping)
 *   - Perspective makes the side covers appear smaller
 *   - Clear gap between center and first side cover
 */
export const CONFIG = {
    /* Default side count (used for 800px screens) */
    visibleSideCount: 3,

    /* Maximum side count for mesh pre-allocation.
     * Increase this for even deeper stacks on wide screens. */
    maxSideCount: 18,

    /* Cover plane dimensions — both equal for square covers */
    coverWidth:  2.0,
    coverHeight: 2.0,

    /* Scale multiplier for the center (focused) cover */
    centerScale: 1.0,

    /*
     * Scale multiplier for side covers.
     * In true iTunes style this is 1.0 (same as center) — the perspective
     * camera makes them appear smaller because they're pushed back in Z.
     */
    sideScale: 1.0,

    /* Y-axis rotation for side covers (degrees). */
    sideAngle: 75,

    /* Horizontal distance from center (x=0) to the FIRST side cover's center. */
    centerGap: 1.5,

    /* Horizontal spacing between adjacent SIDE covers. 
     * Increased slightly so they reach the edges of ultra-wide windows. */
    xSpacing: 0.35,

    /* Z offset (depth) for side covers. */
    zOffset: -1.2,

    /* Global vertical shift applied to all covers.
     * Balanced to leave breathing room at the top border while
     * keeping the text safely above the transport controls. */
    baseYOffset: 0.15,

    /* Extra vertical offset for side covers AFTER bottom-alignment (0 = none) */
    sideYOffset: 0,

    /* Opacity reduction per unit of distance from center. 
     * Lowered so distant covers remain slightly visible. */
    opacityFalloff: 0.03,

    /* ---- Reflection ---- */

    reflectionVisible: true,
    reflectionOpacity: 0.3,
    reflectionGap: 0.02,

    /* ---- Animation ---- */

    animSpeed: 8.0,
    snapThreshold: 0.001,
};

/* ------------------------------------------------------------- */
/*  Dynamic side count                                           */
/* ------------------------------------------------------------- */

/**
 * Compute how many covers to show on each side of center,
 * based on the container width in pixels.
 * Dynamic scaling ensures we always fill wider screens.
 */
export function computeVisibleSideCount(containerWidth) {
    /* Rough heuristic: 1 side cover per ~100px of screen width */
    const count = Math.ceil(containerWidth / 100);
    return Math.min(count, CONFIG.maxSideCount);
}

/* ------------------------------------------------------------- */
/*  Layout computation                                           */
/* ------------------------------------------------------------- */

/**
 * Compute the visual transform for a single cover at a given
 * continuous signed distance from the scroll center.
 *
 * distance = 0   → center position (flat, front)
 * distance = ±1  → first side cover (rotated, pushed back)
 * distance = ±2+ → stacked side covers
 *
 * @param  {number} distance  Signed fractional distance from center.
 * @return {{ x, y, z, rotY, scaleXY, opacity }}
 */
export function computeCoverTransform(distance) {
    const sign = distance >= 0 ? 1 : -1;
    const abs  = Math.abs(distance);

    /*
     * `t` blends from 0 (center) to 1 (fully in side position).
     * We use a Quadratic Ease-Out curve. It gives the snappy iTunes
     * transition toward the sides, but gracefully slopes to 0 at the
     * center to prevent microscopic 'stutters' when snapping to rest.
     */
    const tRaw = Math.min(abs, 1.0);
    const t    = tRaw * (2 - tRaw);

    const extra = Math.max(0, abs - 1.0);

    /* Horizontal position */
    const x = sign * (t * CONFIG.centerGap + extra * CONFIG.xSpacing);

    /* Depth and Rotation */
    const z = t * CONFIG.zOffset;
    const rotY = -sign * t * CONFIG.sideAngle * DEG2RAD;

    /* Scale */
    const scaleXY = CONFIG.centerScale + t * (CONFIG.sideScale - CONFIG.centerScale);

    /*
     * Y Position Logic:
     * 1. baseYOffset: Lifts everything up to make room for reflections in the level camera view.
     * 2. yAlign: Keeps smaller/tilted covers bottom-aligned with the center.
     */
    const yAlign = -(CONFIG.coverHeight / 2) * t * (CONFIG.centerScale - CONFIG.sideScale);
    const y = CONFIG.baseYOffset + yAlign + t * CONFIG.sideYOffset;

    /* Opacity: subtle falloff so many covers are visible */
    const opacity = Math.max(0.25, 1.0 - abs * CONFIG.opacityFalloff);

    return { x, y, z, rotY, scaleXY, opacity };
}

/**
 * Compute layout data for every visible cover slot.
 *
 * @param  {number} scrollOffset  Current continuous scroll position.
 * @param  {number} totalItems    Total number of albums / tracks.
 * @param  {number} sideCount     How many covers on each side of center.
 * @return {Array<{ albumIndex, x, y, z, rotY, scaleXY, opacity }>}
 */
export function computeLayout(scrollOffset, totalItems, sideCount) {
    if (totalItems === 0) return [];

    const nearest = Math.round(scrollOffset);
    const sides   = sideCount != null ? sideCount : CONFIG.visibleSideCount;
    const results = [];

    for (let slot = -sides; slot <= sides; slot++) {
        const albumIndex = nearest + slot;
        if (albumIndex < 0 || albumIndex >= totalItems) continue;

        const distance  = albumIndex - scrollOffset;
        const transform = computeCoverTransform(distance);

        transform.albumIndex = albumIndex;
        results.push(transform);
    }

    /* Sort: furthest from center first → painted behind.
     * Center cover last → painted on top. */
    results.sort((a, b) => {
        const da = Math.abs(a.albumIndex - scrollOffset);
        const db = Math.abs(b.albumIndex - scrollOffset);
        if (Math.abs(da - db) > 0.001) return db - da;
        return a.albumIndex - b.albumIndex;
    });

    return results;
}

/* =============================================================
   renderer.js — Three.js scene management
   Ports the original threejs-coverflow slide engine into the local
   Navidrome app while keeping the existing app-facing API.
   ============================================================= */

import { computeVisibleSideCount } from "./coverflow.js";

const PLANE_WIDTH = 304;
const PLANE_HEIGHT = 304;
const COVERFLOW_ANGLE = 52 * (Math.PI / 180);
const STACK_INNER_GAP = 16;
const STACK_PIVOT_STEP = 76;
const SLIDE_DEPTH = 268;
const DEFAULT_COVERFLOW_OFFSET_Y = 24;
const CAMERA_Z = 890;
const BASE_FOV = 30;
const MAX_FOV = 65;
const CENTER_SCALE = 1.05;
const FULLSCREEN_CENTER_SCALE = 1.24;
const FULLSCREEN_HEIGHT_FILL = 0.91;
const FULLSCREEN_COVERFLOW_OFFSET_Y = 10;
const MIN_CENTER_SCALE = 0.6;
const SIDE_SCALE = 0.9;
const SIDE_TO_CENTER_RATIO = SIDE_SCALE / CENTER_SCALE;
const PIXEL_WHEEL_SCALE = 0.018;
const LINE_WHEEL_SCALE = 0.12;
const PAGE_WHEEL_SCALE = 1.2;
const MAX_WHEEL_STEP = 1.2;
/* =============================================================
   COVERFLOW ANIMATION — DO NOT MODIFY WITHOUT EXTREME CARE
   =============================================================
   This GSAP slide/zoom animation took a long time to stabilise.
   Do not change durations, easing, tween targets, snap timing,
   killTweensOf calls, or refit/immediate-layout behaviour unless
   you are deliberately fixing animation itself and can regression-
   test browse swipe, wheel, and programmatic jump on phone + desktop.

   Safe path for UI work: sync overlays in app.js (seek strip, info
   panel) without calling refitStage() on every layout pass.
   ============================================================= */
const MOVE_DURATION = 0.42;
const ROTATION_DURATION = 0.28;
const SCALE_DURATION = 0.32;
const COVER_WIDTH_SYNC_ROT_EPS = 0.06;
const COVER_WIDTH_SYNC_X_EPS = 2.5;
const TEX_SIZE = 512;
const VIRTUAL_SIDE_BUFFER = 4;

const animationEngine = window.gsap || null;

let scene = null;
let camera = null;
let webglRenderer = null;
let ambientLight = null;
let frameId = 0;
let defaultTexture = null;
let currentSideCount = 0;
let currentCenterScale = CENTER_SCALE;
let slideCards = new Map();
let albumTextures = [];
let currentSlideIndex = -1;
let targetSlideIndex = -1;
let coverBounds = null;
let coverflowOffsetY = DEFAULT_COVERFLOW_OFFSET_Y;
let coverLayoutProfile = "normal";
let _container = null;
let _onSnap = null;
let snapTimerId = 0;
let resizeTimerId = 0;

const textureCache = new Map();
const coverMetricsCorners = [
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
];

export function initScene(container) {
    if (webglRenderer) {
        _container = container;
        _syncStageViewport(container);
        if (albumTextures.length && currentSlideIndex >= 0) {
            _applyCurrentSlideLayoutImmediate();
            _fitCoverOffsetToStage();
        }
        return;
    }

    _container = container;
    scene = new THREE.Scene();

    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    camera = new THREE.PerspectiveCamera(30, width / height, 1, 5000);
    camera.position.z = CAMERA_Z;
    camera.lookAt(new THREE.Vector3(0, 0, 0));

    ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    webglRenderer.outputEncoding = THREE.sRGBEncoding;
    webglRenderer.domElement.style.cursor =
        document.body.classList.contains("is-touch-kiosk") ? "none" : "grab";
    webglRenderer.domElement.style.touchAction = "none";
    container.appendChild(webglRenderer.domElement);

    defaultTexture = _createFallbackTexture();
    currentSideCount = computeVisibleSideCount(width);

    const scheduleResize = () => {
        if (resizeTimerId) {
            window.clearTimeout(resizeTimerId);
        }
        resizeTimerId = window.setTimeout(() => {
            resizeTimerId = 0;
            _handleResize(container);
        }, 120);
    };
    window.addEventListener("resize", scheduleResize);
    window.addEventListener("orientationchange", scheduleResize);
    _handleResize(container);
    _tick();
}

export function setAlbumData(textures) {
    const previousLength = albumTextures.length;
    albumTextures = Array.isArray(textures) ? textures : [];

    if (!webglRenderer) {
        return;
    }

    if (!albumTextures.length) {
        _destroySlides();
        currentSlideIndex = -1;
        targetSlideIndex = -1;
        coverBounds = null;
        return;
    }

    if (previousLength !== albumTextures.length) {
        const anchorIndex =
            targetSlideIndex >= 0
                ? _clamp(targetSlideIndex, 0, Math.max(0, albumTextures.length - 1))
                : _clamp(currentSlideIndex >= 0 ? currentSlideIndex : 0, 0, Math.max(0, albumTextures.length - 1));
        _syncSlideWindow(anchorIndex, { layoutCenter: anchorIndex, immediate: true });
        jumpTo(anchorIndex, { suppressSnap: true });
        for (const [index, slide] of _orderedSlideEntries()) {
            slide.applyTexture(albumTextures[index] || defaultTexture);
        }
        return;
    }

    for (const [index, slide] of _orderedSlideEntries()) {
        slide.applyTexture(albumTextures[index] || defaultTexture);
    }
}

export function setTextureAtIndex(index, texture) {
    if (index < 0 || index >= albumTextures.length) {
        return;
    }
    const nextTexture = texture || defaultTexture;
    albumTextures[index] = nextTexture;
    const slide = slideCards.get(index);
    if (slide) {
        slide.applyTexture(nextTexture);
    }
}

/** User-driven browse: animated GSAP transition. Do not route through jumpTo. */
export function navigateTo(index) {
    if (!albumTextures.length) {
        return;
    }
    _moveSlide(index);
}

/** Programmatic/instant positioning only (bootstrap, resize, album reload). */
export function jumpTo(index, options = {}) {
    if (!albumTextures.length) {
        return;
    }
    _moveSlide(index, { force: true, immediate: true, suppressSnap: Boolean(options.suppressSnap) });
}

export function renderOnce() {
    _renderScene();
    _updateCoverBounds();
}

/**
 * Stage/camera refit. Kills active tweens via _applyCurrentSlideLayoutImmediate.
 * app.js must only call this on real stage size changes — never every layout tick.
 */
export function refitStage() {
    if (!_container) {
        renderOnce();
        return;
    }
    const width = _container.clientWidth || 0;
    const height = _container.clientHeight || 0;
    if (width < 8 || height < 8) {
        return;
    }
    _syncStageViewport(_container);
    if (albumTextures.length && currentSlideIndex >= 0) {
        // Never snap covers while GSAP is mid-transition.
        if (_isSlideAnimating()) {
            _renderScene();
            return;
        }
        _applyCurrentSlideLayoutImmediate();
        _fitCoverOffsetToStage();
        return;
    }
    _renderScene();
    _updateCoverBounds();
}

export function onSnap(fn) {
    _onSnap = fn;
}

export function getTargetIndex() {
    return targetSlideIndex >= 0 ? targetSlideIndex : 0;
}

export function getScrollOffset() {
    return currentSlideIndex >= 0 ? currentSlideIndex : 0;
}

export function getSideCount() {
    return currentSideCount;
}

export function getCenterCoverMetrics() {
    const defaultOffsetY = coverLayoutProfile === "fullscreen"
        ? FULLSCREEN_COVERFLOW_OFFSET_Y
        : DEFAULT_COVERFLOW_OFFSET_Y;
    return {
        width: PLANE_WIDTH * currentCenterScale,
        height: PLANE_HEIGHT * currentCenterScale,
        offsetY: coverflowOffsetY,
        defaultOffsetY,
    };
}

export function setCoverLayoutProfile(profile = "normal") {
    const next = profile === "fullscreen" ? "fullscreen" : "normal";
    if (coverLayoutProfile === next) {
        return;
    }
    coverLayoutProfile = next;
    if (_container) {
        _handleResize(_container);
    }
}

export function setCoverflowOffsetY(nextOffsetY) {
    if (!Number.isFinite(nextOffsetY)) {
        return false;
    }

    const clampedOffsetY = _clamp(nextOffsetY, DEFAULT_COVERFLOW_OFFSET_Y - 80, DEFAULT_COVERFLOW_OFFSET_Y + 300);
    if (Math.abs(clampedOffsetY - coverflowOffsetY) < 0.01) {
        return false;
    }

    coverflowOffsetY = clampedOffsetY;
    _applyCurrentSlideLayoutImmediate();
    return true;
}

export function isSlideAnimating() {
    return _isSlideAnimating();
}

export function worldToScreenY(worldY) {
    if (!camera || !webglRenderer) return null;
    const vec = new THREE.Vector3(0, worldY, 0);
    vec.project(camera);
    return (-vec.y * 0.5 + 0.5) * webglRenderer.domElement.clientHeight;
}

export function worldToScreenX(worldX) {
    if (!camera || !webglRenderer) return null;
    const vec = new THREE.Vector3(worldX, 0, 0);
    vec.project(camera);
    return (vec.x * 0.5 + 0.5) * webglRenderer.domElement.clientWidth;
}

export function getActiveCoverBounds() {
    return coverBounds ? { ...coverBounds } : null;
}

export function invalidateTexture(url) {
    if (!url) return;
    textureCache.delete(url);
}

function textureFromImage(img, cacheKey) {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;

    if (cacheKey) textureCache.set(cacheKey, tex);
    return tex;
}

export function loadTexture(url) {
    if (!url) return Promise.resolve(defaultTexture);
    if (textureCache.has(url)) return Promise.resolve(textureCache.get(url));

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";

        img.onload = () => resolve(textureFromImage(img, url));
        img.onerror = () => resolve(defaultTexture);
        img.src = url;
    });
}

export function loadRadioTexture(url, fallbackTitle = "") {
    if (!url) return Promise.resolve(createRadioPlaceholderTexture(fallbackTitle || "Radio"));
    const cacheKey = `radio:${url}`;
    if (textureCache.has(cacheKey)) return Promise.resolve(textureCache.get(cacheKey));

    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(textureFromImage(img, cacheKey));
        img.onerror = () => resolve(createRadioPlaceholderTexture(fallbackTitle || "Radio"));
        img.src = url;
    });
}

export function textureFromCanvas(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

export function getDefaultTexture() {
    return defaultTexture;
}

const radioPlaceholderCache = new Map();

function wrapRadioPlaceholderLines(ctx, text, maxWidth) {
    const words = String(text || "Radio").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return ["Radio"];
    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i += 1) {
        const next = `${current} ${words[i]}`;
        if (ctx.measureText(next).width <= maxWidth) {
            current = next;
        } else {
            lines.push(current);
            current = words[i];
        }
    }
    lines.push(current);
    return lines.slice(0, 3);
}

export function createRadioPlaceholderTexture(title = "Radio") {
    const key = String(title || "Radio").trim().slice(0, 80) || "Radio";
    if (radioPlaceholderCache.has(key)) return radioPlaceholderCache.get(key);

    const canvas = document.createElement("canvas");
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, TEX_SIZE, TEX_SIZE);
    grad.addColorStop(0, "#4f7cff");
    grad.addColorStop(1, "#151621");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(TEX_SIZE / 2, TEX_SIZE * 0.38, 118, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(TEX_SIZE / 2, TEX_SIZE * 0.38, 78, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.beginPath();
    ctx.arc(TEX_SIZE / 2, TEX_SIZE * 0.38, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.beginPath();
    ctx.arc(TEX_SIZE / 2, TEX_SIZE * 0.38, 28, 0, Math.PI * 2);
    ctx.fill();

    const initial = key.trim().charAt(0).toUpperCase() || "R";
    ctx.fillStyle = "#111322";
    ctx.font = "bold 34px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initial, TEX_SIZE / 2, TEX_SIZE * 0.38);

    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "600 22px Arial, sans-serif";
    ctx.fillText("RADIO", TEX_SIZE / 2, 72);

    const labelLines = wrapRadioPlaceholderLines(ctx, key, TEX_SIZE - 72);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "bold 30px Arial, sans-serif";
    const lineHeight = 36;
    const blockHeight = labelLines.length * lineHeight;
    let y = TEX_SIZE - 48 - blockHeight;
    for (const line of labelLines) {
        ctx.fillText(line, TEX_SIZE / 2, y);
        y += lineHeight;
    }

    const tex = textureFromCanvas(canvas);
    radioPlaceholderCache.set(key, tex);
    return tex;
}

function _destroySlides() {
    _clearSnapTimer();
    for (const slide of slideCards.values()) {
        _disposeSlide(slide);
    }
    slideCards.clear();
    currentSlideIndex = -1;
}

/** Guard: refitStage and immediate layout must not run during active tweens. */
function _isSlideAnimating() {
    if (!animationEngine) {
        return Boolean(snapTimerId);
    }
    for (const [, slide] of slideCards) {
        if (
            animationEngine.isTweening(slide.position) ||
            animationEngine.isTweening(slide.rotation) ||
            animationEngine.isTweening(slide.scale) ||
            animationEngine.isTweening(slide.contentRoot.position)
        ) {
            return true;
        }
    }
    return Boolean(snapTimerId);
}

function _moveSlide(targetIndex, options = {}) {
    const nextIndex = _clamp(Math.round(targetIndex), 0, albumTextures.length - 1);
    if (currentSlideIndex === nextIndex && !options.force) {
        return;
    }

    const previousIndex = currentSlideIndex >= 0 ? currentSlideIndex : nextIndex;
    const halfFront = (PLANE_WIDTH * currentCenterScale) / 2;
    const ranges = options.immediate
        ? [_getVirtualRange(nextIndex)]
        : [_getVirtualRange(previousIndex), _getVirtualRange(nextIndex)];
    _ensureSlidesForRanges(ranges, previousIndex);

    for (const [index, slide] of _orderedSlideEntries()) {
        const {
            targetX,
            targetY,
            targetZ,
            targetRotationY,
            targetScale,
            targetPivotOffsetX,
        } = _getSlideTarget(index, nextIndex, halfFront);

        if (options.immediate || !animationEngine) {
            if (animationEngine) {
                animationEngine.killTweensOf(slide.contentRoot.position);
                animationEngine.killTweensOf(slide.position);
                animationEngine.killTweensOf(slide.rotation);
                animationEngine.killTweensOf(slide.scale);
            }
            slide.contentRoot.position.x = targetPivotOffsetX;
            slide.position.set(targetX, targetY, targetZ);
            slide.rotation.set(0, targetRotationY, 0);
            slide.scale.set(targetScale, targetScale, targetScale);
        } else {
            animationEngine.to(slide.contentRoot.position, {
                x: targetPivotOffsetX,
                duration: MOVE_DURATION,
                ease: "power2.out",
                overwrite: true,
            });
            _tweenTo(slide.position, { x: targetX, y: targetY, z: targetZ }, MOVE_DURATION);
            _tweenTo(slide.rotation, { y: targetRotationY }, ROTATION_DURATION);
            _tweenTo(slide.scale, { x: targetScale, y: targetScale, z: targetScale }, SCALE_DURATION);
        }

        slide.setSelected(index === nextIndex);
    }

    currentSlideIndex = nextIndex;
    targetSlideIndex = nextIndex;

    if (options.immediate) {
        _pruneSlidesToRange(_getVirtualRange(nextIndex));
        _renderScene();
        _updateCoverBounds();
        if (_onSnap && !options.suppressSnap) {
            _onSnap(nextIndex);
        }
        return;
    }

    _clearSnapTimer();
    snapTimerId = window.setTimeout(() => {
        snapTimerId = 0;
        _pruneSlidesToRange(_getVirtualRange(nextIndex));
        _updateCoverBounds();
        if (_onSnap) {
            _onSnap(nextIndex);
        }
    }, Math.ceil(Math.max(MOVE_DURATION, ROTATION_DURATION, SCALE_DURATION) * 1000) + 24);
}

/** Snaps all slides instantly and kills GSAP tweens. Never call during browse animation. */
function _applyCurrentSlideLayoutImmediate() {
    if (!albumTextures.length) {
        coverBounds = null;
        return;
    }

    const activeIndex = _clamp(targetSlideIndex >= 0 ? targetSlideIndex : currentSlideIndex, 0, albumTextures.length - 1);
    const halfFront = (PLANE_WIDTH * currentCenterScale) / 2;
    _syncSlideWindow(activeIndex, { layoutCenter: activeIndex, immediate: true });

    for (const [index, slide] of _orderedSlideEntries()) {
        const {
            targetX,
            targetY,
            targetZ,
            targetRotationY,
            targetScale,
            targetPivotOffsetX,
        } = _getSlideTarget(index, activeIndex, halfFront);

        if (animationEngine) {
            animationEngine.killTweensOf(slide.contentRoot.position);
            animationEngine.killTweensOf(slide.position);
            animationEngine.killTweensOf(slide.rotation);
            animationEngine.killTweensOf(slide.scale);
        }

        slide.contentRoot.position.x = targetPivotOffsetX;
        slide.position.set(targetX, targetY, targetZ);
        slide.rotation.set(0, targetRotationY, 0);
        slide.scale.set(targetScale, targetScale, targetScale);
        slide.setSelected(index === activeIndex);
    }

    currentSlideIndex = activeIndex;
    targetSlideIndex = activeIndex;
    _renderScene();
    _updateCoverBounds();
}

function _getVirtualRange(centerIndex) {
    if (!albumTextures.length) {
        return { lo: 0, hi: -1 };
    }
    const center = _clamp(Math.round(centerIndex), 0, albumTextures.length - 1);
    const radius = Math.max(1, currentSideCount) + VIRTUAL_SIDE_BUFFER;
    return {
        lo: Math.max(0, center - radius),
        hi: Math.min(albumTextures.length - 1, center + radius),
    };
}

function _ensureSlidesForRanges(ranges, layoutCenter) {
    const safeLayoutCenter = _clamp(
        Math.round(Number.isFinite(layoutCenter) ? layoutCenter : 0),
        0,
        Math.max(0, albumTextures.length - 1)
    );
    const halfFront = (PLANE_WIDTH * currentCenterScale) / 2;

    for (const range of ranges) {
        for (let index = range.lo; index <= range.hi; index += 1) {
            if (!slideCards.has(index)) {
                const slide = new SlideCard(index, albumTextures[index] || defaultTexture);
                slideCards.set(index, slide);
                scene.add(slide);
                _positionSlideImmediately(slide, index, safeLayoutCenter, halfFront);
            }
        }
    }
}

function _syncSlideWindow(centerIndex, options = {}) {
    const range = _getVirtualRange(centerIndex);
    _ensureSlidesForRanges([range], options.layoutCenter ?? centerIndex);
    if (options.immediate) {
        const halfFront = (PLANE_WIDTH * currentCenterScale) / 2;
        for (const [index, slide] of _orderedSlideEntries()) {
            if (index >= range.lo && index <= range.hi) {
                _positionSlideImmediately(slide, index, centerIndex, halfFront);
                slide.setSelected(index === centerIndex);
            }
        }
    }
    _pruneSlidesToRange(range);
}

function _positionSlideImmediately(slide, index, centerIndex, halfFront = (PLANE_WIDTH * currentCenterScale) / 2) {
    const {
        targetX,
        targetY,
        targetZ,
        targetRotationY,
        targetScale,
        targetPivotOffsetX,
    } = _getSlideTarget(index, centerIndex, halfFront);

    slide.contentRoot.position.x = targetPivotOffsetX;
    slide.position.set(targetX, targetY, targetZ);
    slide.rotation.set(0, targetRotationY, 0);
    slide.scale.set(targetScale, targetScale, targetScale);
    slide.setSelected(index === centerIndex);
}

function _pruneSlidesToRange(range) {
    for (const [index, slide] of Array.from(slideCards.entries())) {
        if (index < range.lo || index > range.hi || index >= albumTextures.length) {
            _disposeSlide(slide);
            slideCards.delete(index);
        }
    }
}

function _disposeSlide(slide) {
    if (animationEngine) {
        animationEngine.killTweensOf(slide.position);
        animationEngine.killTweensOf(slide.rotation);
        animationEngine.killTweensOf(slide.scale);
        animationEngine.killTweensOf(slide.contentRoot.position);
    }
    slide.dispose();
    scene.remove(slide);
}

function _orderedSlideEntries() {
    return Array.from(slideCards.entries()).sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex);
}

function _getLayoutScaleFactor() {
    return currentCenterScale / CENTER_SCALE;
}

function _getSideScale() {
    return currentCenterScale * SIDE_TO_CENTER_RATIO;
}

function _getSlideTarget(index, nextIndex, halfFront = (PLANE_WIDTH * currentCenterScale) / 2) {
    let targetX = 0;
    let targetZ = 0;
    let targetRotationY = 0;
    let targetScale = currentCenterScale;
    let targetPivotOffsetX = 0;
    const layoutScale = _getLayoutScaleFactor();
    const innerGap = STACK_INNER_GAP * layoutScale;
    const pivotStep = STACK_PIVOT_STEP * layoutScale;
    const sideScale = _getSideScale();

    if (index < nextIndex) {
        const k = nextIndex - index;
        targetX = -(halfFront + innerGap + (k - 1) * pivotStep);
        targetZ = -SLIDE_DEPTH;
        targetRotationY = COVERFLOW_ANGLE;
        targetScale = sideScale;
        targetPivotOffsetX = -PLANE_WIDTH / 2;
    } else if (index > nextIndex) {
        const k = index - nextIndex;
        targetX = halfFront + innerGap + (k - 1) * pivotStep;
        targetZ = -SLIDE_DEPTH;
        targetRotationY = -COVERFLOW_ANGLE;
        targetScale = sideScale;
        targetPivotOffsetX = PLANE_WIDTH / 2;
    }

    return {
        targetX,
        targetY: coverflowOffsetY + (PLANE_HEIGHT / 2) * (targetScale - currentCenterScale),
        targetZ,
        targetRotationY,
        targetScale,
        targetPivotOffsetX,
    };
}

function _tweenTo(target, props, duration) {
    if (!animationEngine) {
        Object.assign(target, props);
        return;
    }
    animationEngine.to(target, {
        ...props,
        duration,
        ease: "power2.out",
        overwrite: true,
    });
}

function _tick() {
    if (!webglRenderer) {
        return;
    }
    _renderScene();
    _updateCoverBounds();
    frameId = requestAnimationFrame(_tick);
}

function _renderScene() {
    if (!scene || !camera || !webglRenderer) {
        return;
    }
    webglRenderer.render(scene, camera);
}

function _measureMeshScreenBounds(mesh) {
    if (!camera || !webglRenderer || !mesh) {
        return null;
    }

    const halfWidth = PLANE_WIDTH / 2;
    const halfHeight = PLANE_HEIGHT / 2;
    const corners = [
        [-halfWidth, -halfHeight],
        [halfWidth, -halfHeight],
        [halfWidth, halfHeight],
        [-halfWidth, halfHeight],
    ];

    const rect = webglRenderer.domElement.getBoundingClientRect();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < 4; index += 1) {
        const point = coverMetricsCorners[index];
        point.set(corners[index][0], corners[index][1], 0);
        point.applyMatrix4(mesh.matrixWorld);
        point.project(camera);

        const vx = (point.x * 0.5 + 0.5) * rect.width;
        const vy = (-point.y * 0.5 + 0.5) * rect.height;
        minX = Math.min(minX, vx);
        maxX = Math.max(maxX, vx);
        minY = Math.min(minY, vy);
        maxY = Math.max(maxY, vy);
    }

    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
        return null;
    }

    return {
        left: minX,
        right: maxX,
        top: minY,
        bottom: maxY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2,
    };
}

function _measureCenterCoverBounds() {
    if (!camera || !webglRenderer || currentSlideIndex < 0) {
        return null;
    }

    const slide = slideCards.get(currentSlideIndex);
    if (!slide?.topPlane) {
        return null;
    }

    if (
        Math.abs(slide.rotation.y) > COVER_WIDTH_SYNC_ROT_EPS ||
        Math.abs(slide.position.x) > COVER_WIDTH_SYNC_X_EPS
    ) {
        return "unstable";
    }

    const topBounds = _measureMeshScreenBounds(slide.topPlane);
    if (!topBounds) {
        return null;
    }

    const reflectionBounds = _measureMeshScreenBounds(slide.reflectionPlane);
    const stackBottom = reflectionBounds
        ? Math.max(topBounds.bottom, reflectionBounds.bottom)
        : topBounds.bottom;

    return {
        ...topBounds,
        stackBottom,
    };
}

function _updateCoverBounds() {
    const measured = _measureCenterCoverBounds();
    if (measured === null) {
        coverBounds = null;
        return;
    }
    if (measured === "unstable") {
        return;
    }
    coverBounds = measured;
}

function _createFallbackTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_SIZE;
    canvas.height = TEX_SIZE;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, TEX_SIZE, TEX_SIZE);
    grad.addColorStop(0, "#2c2c3e");
    grad.addColorStop(1, "#18182a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, TEX_SIZE - 16, TEX_SIZE - 16);

    ctx.fillStyle = "#555568";
    ctx.font = "bold 144px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♫", TEX_SIZE / 2, TEX_SIZE / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function _computeDynamicFov(viewportHeight) {
    void viewportHeight;
    // Keep the cover scale stable during window-height changes.
    // The overlay UI can ride over the reflection area; shrinking the
    // camera FOV to reserve a large fixed bottom band created the large
    // dead space below the cover on short windows.
    return BASE_FOV;
}

function _computeDynamicCenterScale(viewportWidth, viewportHeight) {
    const safeWidth = Math.max(1, viewportWidth || 0);
    const safeHeight = Math.max(1, viewportHeight || 0);
    const isFullscreen = coverLayoutProfile === "fullscreen";
    const isTouchLandscape = Boolean(
        window.matchMedia?.("(hover: none) and (pointer: coarse) and (max-width: 932px) and (orientation: landscape)")?.matches
    );
    const heightFillRatio = isFullscreen
        ? FULLSCREEN_HEIGHT_FILL
        : (isTouchLandscape ? 0.68 : 0.82);
    const fovRadians = BASE_FOV * (Math.PI / 180);
    const projectedCoverAtScaleOne =
        safeHeight * PLANE_HEIGHT / (2 * Math.tan(fovRadians / 2) * CAMERA_Z);
    const widthFitScale = (safeWidth * (isFullscreen ? 0.92 : 0.86)) / Math.max(1, projectedCoverAtScaleOne);
    const heightFitScale = (safeHeight * heightFillRatio) / Math.max(1, projectedCoverAtScaleOne);
    const maxScale = isFullscreen ? FULLSCREEN_CENTER_SCALE : CENTER_SCALE;
    return _clamp(
        Math.min(maxScale, widthFitScale, heightFitScale),
        MIN_CENTER_SCALE,
        maxScale
    );
}

function _projectWorldYToScreen(worldY) {
    if (!camera || !webglRenderer) {
        return null;
    }
    const vec = new THREE.Vector3(0, worldY, 0);
    vec.project(camera);
    return (-vec.y * 0.5 + 0.5) * webglRenderer.domElement.clientHeight;
}

function _fitCoverOffsetToStage() {
    if (!camera || !webglRenderer || !_container || currentSlideIndex < 0) {
        return;
    }

    const stageHeight = _container.clientHeight || 1;
    const topMarginPx = Math.max(2, Math.round(stageHeight * 0.01));
    const bottomMarginPx = Math.max(4, Math.round(stageHeight * 0.02));

    for (let pass = 0; pass < 4; pass += 1) {
        _renderScene();
        const measured = _measureCenterCoverBounds();
        if (!measured || measured === "unstable") {
            return;
        }

        // Anchor the album art top edge only. Reflection hangs below and may clip;
        // including it in stack height was pushing the cover down and leaving a
        // large dead band between the seek chrome and the art.
        const artTop = measured.top;
        const artBottom = measured.bottom;
        const artHeight = Math.max(1, artBottom - artTop);
        let targetTop = topMarginPx;
        if (targetTop + artHeight > stageHeight - bottomMarginPx) {
            targetTop = Math.max(topMarginPx, stageHeight - bottomMarginPx - artHeight);
        }
        const deltaPx = targetTop - artTop;
        if (Math.abs(deltaPx) < 1) {
            coverBounds = measured;
            return;
        }

        const y1 = _projectWorldYToScreen(coverflowOffsetY);
        const y2 = _projectWorldYToScreen(coverflowOffsetY + 10);
        if (y1 == null || y2 == null || Math.abs(y2 - y1) < 0.05) {
            coverBounds = measured;
            return;
        }

        const worldPerPx = 10 / (y2 - y1);
        coverflowOffsetY += deltaPx * worldPerPx;
        _applyCurrentSlideLayoutImmediate();
    }

    _updateCoverBounds();
}

function _syncStageViewport(container) {
    if (!camera || !webglRenderer || !container) {
        return;
    }
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    webglRenderer.setSize(width, height);
    camera.aspect = width / height;
    camera.fov = _computeDynamicFov(height);
    currentCenterScale = _computeDynamicCenterScale(width, height);
    camera.updateProjectionMatrix();
    currentSideCount = computeVisibleSideCount(width);
}

function _handleResize(container) {
    if (!camera || !webglRenderer) {
        return;
    }
    _syncStageViewport(container);
    if (albumTextures.length && currentSlideIndex >= 0) {
        jumpTo(currentSlideIndex);
    } else {
        _renderScene();
        _updateCoverBounds();
    }
}

function _clearSnapTimer() {
    if (!snapTimerId) {
        return;
    }
    window.clearTimeout(snapTimerId);
    snapTimerId = 0;
}

function _clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

class SlideCard extends THREE.Object3D {
    constructor(index, texture) {
        super();
        this.index = index;
        this.topMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
        this.reflectionMaterial = new THREE.MeshLambertMaterial({
            color: 0xffffff,
            depthWrite: false,
            opacity: 0.18,
            side: THREE.DoubleSide,
            transparent: true,
        });

        this.contentRoot = new THREE.Group();
        this.add(this.contentRoot);

        this.topPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT),
            this.topMaterial
        );
        this.contentRoot.add(this.topPlane);

        this.reflectionPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT),
            this.reflectionMaterial
        );
        this.reflectionPlane.frustumCulled = false;
        this.reflectionPlane.position.y = -PLANE_HEIGHT - 0.5;
        this.reflectionPlane.rotation.x = Math.PI;
        this.contentRoot.add(this.reflectionPlane);

        this.applyTexture(texture || defaultTexture);
        this.setSelected(false);
    }

    applyTexture(texture) {
        const nextTexture = texture || defaultTexture;
        this.topMaterial.map = nextTexture;
        this.reflectionMaterial.map = nextTexture;
        this.topMaterial.needsUpdate = true;
        this.reflectionMaterial.needsUpdate = true;
    }

    setSelected(selected) {
        this.topMaterial.color.set(selected ? 0xffffff : 0xe1e1e1);
        this.reflectionMaterial.opacity = selected ? 0.24 : 0.12;
    }

    dispose() {
        this.topPlane.geometry.dispose();
        this.reflectionPlane.geometry.dispose();
        this.topMaterial.dispose();
        this.reflectionMaterial.dispose();
    }
}

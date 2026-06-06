/**
 * Three.js CoverFlow slide engine (from navidrome_coverflow public/renderer.js).
 * GSAP tweens on album index change; idle cost is one WebGL frame + bounds read.
 */

import * as THREE from "/vendor/three.module.js";
import { computeVisibleSideCount } from "./coverflow.js";

const PLANE_WIDTH = 304;
const PLANE_HEIGHT = 304;
const COVERFLOW_ANGLE = 52 * (Math.PI / 180);
const STACK_INNER_GAP = 16;
const STACK_PIVOT_STEP = 76;
const SLIDE_DEPTH = 268;
export const DEFAULT_COVERFLOW_OFFSET_Y = 24;
const CAMERA_Z = 890;
const BASE_FOV = 30;
const CENTER_SCALE = 1.05;
const MIN_CENTER_SCALE = 0.6;
const SIDE_SCALE = 0.9;
const MOVE_DURATION = 0.42;
const ROTATION_DURATION = 0.28;
const SCALE_DURATION = 0.32;
const COVER_WIDTH_SYNC_ROT_EPS = 0.06;
const COVER_WIDTH_SYNC_X_EPS = 2.5;
const TEX_SIZE = 512;
const VIRTUAL_SIDE_BUFFER = 4;

const animationEngine = typeof window !== "undefined" ? window.gsap || null : null;

let scene = null;
let camera = null;
let webglRenderer = null;
let defaultTexture = null;
let currentSideCount = 0;
let currentCenterScale = CENTER_SCALE;
let slideCards = new Map();
let albumTextures = [];
let currentSlideIndex = -1;
let targetSlideIndex = -1;
let coverBounds = null;
let coverflowOffsetY = DEFAULT_COVERFLOW_OFFSET_Y;
let _container = null;
let _onSnap = null;
let snapTimerId = 0;
let resizeTimerId = 0;

const textureCache = new Map();
const coverMetricsCorners = [
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3(),
  new THREE.Vector3()
];

function applyTextureColorSpace(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
}

export function initScene(container) {
  if (webglRenderer) {
    _container = container;
    return;
  }

  _container = container;
  scene = new THREE.Scene();

  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;

  camera = new THREE.PerspectiveCamera(BASE_FOV, width / height, 1, 5000);
  camera.position.z = CAMERA_Z;
  camera.lookAt(new THREE.Vector3(0, 0, 0));

  scene.add(new THREE.AmbientLight(0xffffff, 1));

  webglRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
  webglRenderer.domElement.style.cursor = "grab";
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
  if (!webglRenderer) return;

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
    jumpTo(anchorIndex);
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

export function navigateTo(index) {
  if (!albumTextures.length) return;
  _moveSlide(index);
}

export function jumpTo(index) {
  if (!albumTextures.length) return;
  _moveSlide(index, { force: true, immediate: true });
}

export function onSnap(fn) {
  _onSnap = fn;
}

export function renderOnce() {
  _renderScene();
  _updateCoverBounds();
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
  return {
    width: PLANE_WIDTH * currentCenterScale,
    height: PLANE_HEIGHT * currentCenterScale,
    offsetY: coverflowOffsetY,
    defaultOffsetY: DEFAULT_COVERFLOW_OFFSET_Y
  };
}

export function setCoverflowOffsetY(nextOffsetY) {
  if (!Number.isFinite(nextOffsetY)) return false;
  const clamped = _clamp(nextOffsetY, DEFAULT_COVERFLOW_OFFSET_Y - 80, DEFAULT_COVERFLOW_OFFSET_Y + 300);
  if (Math.abs(clamped - coverflowOffsetY) < 0.01) return false;
  coverflowOffsetY = clamped;
  _applyCurrentSlideLayoutImmediate();
  return true;
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

export function getProjectedCenterCoverBounds() {
  const metrics = getCenterCoverMetrics();
  const halfWidth = metrics.width / 2;
  const halfHeight = metrics.height / 2;
  const left = worldToScreenX(-halfWidth);
  const right = worldToScreenX(halfWidth);
  const top = worldToScreenY(metrics.offsetY + halfHeight);
  const bottom = worldToScreenY(metrics.offsetY - halfHeight);
  if (![left, right, top, bottom].every(Number.isFinite)) return null;

  const normalizedLeft = Math.min(left, right);
  const normalizedRight = Math.max(left, right);
  const normalizedTop = Math.min(top, bottom);
  const normalizedBottom = Math.max(top, bottom);

  return {
    left: normalizedLeft,
    right: normalizedRight,
    top: normalizedTop,
    bottom: normalizedBottom,
    width: normalizedRight - normalizedLeft,
    height: normalizedBottom - normalizedTop,
    centerX: (normalizedLeft + normalizedRight) / 2,
    centerY: (normalizedTop + normalizedBottom) / 2
  };
}

export function loadTexture(url) {
  if (!url) return Promise.resolve(defaultTexture);
  if (textureCache.has(url)) return Promise.resolve(textureCache.get(url));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
      const tex = new THREE.CanvasTexture(canvas);
      applyTextureColorSpace(tex);
      textureCache.set(url, tex);
      resolve(tex);
    };
    img.onerror = () => resolve(defaultTexture);
    img.src = url;
  });
}

export function getDefaultTexture() {
  return defaultTexture;
}

function _destroySlides() {
  _clearSnapTimer();
  for (const slide of slideCards.values()) {
    _disposeSlide(slide);
  }
  slideCards.clear();
  currentSlideIndex = -1;
}

function _moveSlide(targetIndex, options = {}) {
  const nextIndex = _clamp(Math.round(targetIndex), 0, albumTextures.length - 1);
  if (currentSlideIndex === nextIndex && !options.force) return;

  const previousIndex = currentSlideIndex >= 0 ? currentSlideIndex : nextIndex;
  const halfFront = (PLANE_WIDTH * currentCenterScale) / 2;
  const ranges = options.immediate
    ? [_getVirtualRange(nextIndex)]
    : [_getVirtualRange(previousIndex), _getVirtualRange(nextIndex)];
  _ensureSlidesForRanges(ranges, previousIndex);

  for (const [index, slide] of _orderedSlideEntries()) {
    const target = _getSlideTarget(index, nextIndex, halfFront);

    if (options.immediate || !animationEngine) {
      if (animationEngine) {
        animationEngine.killTweensOf(slide.contentRoot.position);
        animationEngine.killTweensOf(slide.position);
        animationEngine.killTweensOf(slide.rotation);
        animationEngine.killTweensOf(slide.scale);
      }
      slide.contentRoot.position.x = target.targetPivotOffsetX;
      slide.position.set(target.targetX, target.targetY, target.targetZ);
      slide.rotation.set(0, target.targetRotationY, 0);
      slide.scale.set(target.targetScale, target.targetScale, target.targetScale);
    } else {
      animationEngine.to(slide.contentRoot.position, {
        x: target.targetPivotOffsetX,
        duration: MOVE_DURATION,
        ease: "power2.out",
        overwrite: true
      });
      _tweenTo(slide.position, { x: target.targetX, y: target.targetY, z: target.targetZ }, MOVE_DURATION);
      _tweenTo(slide.rotation, { y: target.targetRotationY }, ROTATION_DURATION);
      _tweenTo(slide.scale, { x: target.targetScale, y: target.targetScale, z: target.targetScale }, SCALE_DURATION);
    }

    slide.setSelected(index === nextIndex);
  }

  currentSlideIndex = nextIndex;
  targetSlideIndex = nextIndex;

  if (options.immediate) {
    _pruneSlidesToRange(_getVirtualRange(nextIndex));
    _renderScene();
    _updateCoverBounds();
    _onSnap?.(nextIndex);
    return;
  }

  _clearSnapTimer();
  snapTimerId = window.setTimeout(() => {
    snapTimerId = 0;
    _pruneSlidesToRange(_getVirtualRange(nextIndex));
    _updateCoverBounds();
    _onSnap?.(nextIndex);
  }, Math.ceil(Math.max(MOVE_DURATION, ROTATION_DURATION, SCALE_DURATION) * 1000) + 24);
}

function _applyCurrentSlideLayoutImmediate() {
  if (!albumTextures.length) {
    coverBounds = null;
    return;
  }

  const activeIndex = _clamp(targetSlideIndex >= 0 ? targetSlideIndex : currentSlideIndex, 0, albumTextures.length - 1);
  const halfFront = (PLANE_WIDTH * currentCenterScale) / 2;
  _syncSlideWindow(activeIndex, { layoutCenter: activeIndex, immediate: true });

  for (const [index, slide] of _orderedSlideEntries()) {
    const target = _getSlideTarget(index, activeIndex, halfFront);
    if (animationEngine) {
      animationEngine.killTweensOf(slide.contentRoot.position);
      animationEngine.killTweensOf(slide.position);
      animationEngine.killTweensOf(slide.rotation);
      animationEngine.killTweensOf(slide.scale);
    }
    slide.contentRoot.position.x = target.targetPivotOffsetX;
    slide.position.set(target.targetX, target.targetY, target.targetZ);
    slide.rotation.set(0, target.targetRotationY, 0);
    slide.scale.set(target.targetScale, target.targetScale, target.targetScale);
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
    hi: Math.min(albumTextures.length - 1, center + radius)
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
  const target = _getSlideTarget(index, centerIndex, halfFront);
  slide.contentRoot.position.x = target.targetPivotOffsetX;
  slide.position.set(target.targetX, target.targetY, target.targetZ);
  slide.rotation.set(0, target.targetRotationY, 0);
  slide.scale.set(target.targetScale, target.targetScale, target.targetScale);
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

function _getSlideTarget(index, nextIndex, halfFront = (PLANE_WIDTH * currentCenterScale) / 2) {
  let targetX = 0;
  let targetZ = 0;
  let targetRotationY = 0;
  let targetScale = currentCenterScale;
  let targetPivotOffsetX = 0;

  if (index < nextIndex) {
    const k = nextIndex - index;
    targetX = -(halfFront + STACK_INNER_GAP + (k - 1) * STACK_PIVOT_STEP);
    targetZ = -SLIDE_DEPTH;
    targetRotationY = COVERFLOW_ANGLE;
    targetScale = SIDE_SCALE;
    targetPivotOffsetX = -PLANE_WIDTH / 2;
  } else if (index > nextIndex) {
    const k = index - nextIndex;
    targetX = halfFront + STACK_INNER_GAP + (k - 1) * STACK_PIVOT_STEP;
    targetZ = -SLIDE_DEPTH;
    targetRotationY = -COVERFLOW_ANGLE;
    targetScale = SIDE_SCALE;
    targetPivotOffsetX = PLANE_WIDTH / 2;
  }

  return {
    targetX,
    targetY: coverflowOffsetY + (PLANE_HEIGHT / 2) * (targetScale - currentCenterScale),
    targetZ,
    targetRotationY,
    targetScale,
    targetPivotOffsetX
  };
}

function _tweenTo(target, props, duration) {
  if (!animationEngine) {
    Object.assign(target, props);
    return;
  }
  animationEngine.to(target, { ...props, duration, ease: "power2.out", overwrite: true });
}

function _tick() {
  if (!webglRenderer) return;
  _renderScene();
  _updateCoverBounds();
  requestAnimationFrame(_tick);
}

function _renderScene() {
  if (scene && camera && webglRenderer) {
    webglRenderer.render(scene, camera);
  }
}

function _measureCenterCoverBounds() {
  if (!camera || !webglRenderer || currentSlideIndex < 0) return null;
  const slide = slideCards.get(currentSlideIndex);
  if (!slide?.topPlane) return null;
  if (
    Math.abs(slide.rotation.y) > COVER_WIDTH_SYNC_ROT_EPS ||
    Math.abs(slide.position.x) > COVER_WIDTH_SYNC_X_EPS
  ) {
    return "unstable";
  }

  const halfWidth = PLANE_WIDTH / 2;
  const halfHeight = PLANE_HEIGHT / 2;
  const corners = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ];
  const rect = webglRenderer.domElement.getBoundingClientRect();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < 4; index += 1) {
    const point = coverMetricsCorners[index];
    point.set(corners[index][0], corners[index][1], 0);
    point.applyMatrix4(slide.topPlane.matrixWorld);
    point.project(camera);
    const vx = (point.x * 0.5 + 0.5) * rect.width;
    const vy = (-point.y * 0.5 + 0.5) * rect.height;
    minX = Math.min(minX, vx);
    maxX = Math.max(maxX, vx);
    minY = Math.min(minY, vy);
    maxY = Math.max(maxY, vy);
  }

  return {
    left: minX,
    right: maxX,
    top: minY,
    bottom: maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

function _updateCoverBounds() {
  const measured = _measureCenterCoverBounds();
  if (measured === null) {
    coverBounds = null;
    return;
  }
  if (measured === "unstable") return;
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
  ctx.fillStyle = "#555568";
  ctx.font = "bold 144px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("♫", TEX_SIZE / 2, TEX_SIZE / 2);
  const tex = new THREE.CanvasTexture(canvas);
  applyTextureColorSpace(tex);
  return tex;
}

function _computeDynamicFov(viewportHeight) {
  void viewportHeight;
  return BASE_FOV;
}

function _computeDynamicCenterScale(viewportWidth, viewportHeight) {
  const safeWidth = Math.max(1, viewportWidth || 0);
  const safeHeight = Math.max(1, viewportHeight || 0);
  const isTouchLandscape = Boolean(
    window.matchMedia?.("(hover: none) and (pointer: coarse) and (max-width: 932px) and (orientation: landscape)")?.matches
  );
  const heightFillRatio = isTouchLandscape ? 0.58 : 0.72;
  const fovRadians = BASE_FOV * (Math.PI / 180);
  const projectedCoverAtScaleOne =
    safeHeight * PLANE_HEIGHT / (2 * Math.tan(fovRadians / 2) * CAMERA_Z);
  const widthFitScale = (safeWidth * 0.86) / Math.max(1, projectedCoverAtScaleOne);
  const heightFitScale = (safeHeight * heightFillRatio) / Math.max(1, projectedCoverAtScaleOne);
  return _clamp(
    Math.min(CENTER_SCALE, widthFitScale, heightFitScale),
    MIN_CENTER_SCALE,
    CENTER_SCALE
  );
}

function _handleResize(container) {
  if (!camera || !webglRenderer) return;
  const width = container.clientWidth || 1;
  const height = container.clientHeight || 1;
  webglRenderer.setSize(width, height);
  camera.aspect = width / height;
  camera.fov = _computeDynamicFov(height);
  currentCenterScale = _computeDynamicCenterScale(width, height);
  camera.updateProjectionMatrix();
  currentSideCount = computeVisibleSideCount(width);
  if (albumTextures.length && currentSlideIndex >= 0) {
    jumpTo(currentSlideIndex);
  } else {
    _renderScene();
    _updateCoverBounds();
  }
}

function _clearSnapTimer() {
  if (!snapTimerId) return;
  window.clearTimeout(snapTimerId);
  snapTimerId = 0;
}

function _clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

class SlideCard extends THREE.Group {
  constructor(index, texture) {
    super();
    this.index = index;
    this.topMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.reflectionMaterial = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      depthWrite: false,
      opacity: 0.18,
      side: THREE.DoubleSide,
      transparent: true
    });

    this.contentRoot = new THREE.Group();
    this.add(this.contentRoot);

    this.topPlane = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), this.topMaterial);
    this.contentRoot.add(this.topPlane);

    this.reflectionPlane = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), this.reflectionMaterial);
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

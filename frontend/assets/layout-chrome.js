/**
 * Positions playback strip and album info from the active CoverFlow card bounds
 * (same approach as navidrome_coverflow positionInfoPanel).
 */

import * as THREE from "/vendor/three.module.js";

export const DEFAULT_COVERFLOW_OFFSET_Y = 24;
const PLANE_SIZE = 470;
const CENTER_SCALE = 1.2;
const _v = new THREE.Vector3();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function measureCenterCoverBounds(camera, renderer, centerCard) {
  if (!camera || !renderer || !centerCard?.cover || !centerCard.group.visible) {
    return null;
  }
  if (Math.abs(centerCard.group.rotation.y) > 0.12 || Math.abs(centerCard.group.position.x) > 8) {
    return null;
  }

  const half = (PLANE_SIZE * centerCard.group.scale.x) / 2;
  const localCorners = [
    [-half, -half, 0],
    [half, -half, 0],
    [half, half, 0],
    [-half, half, 0]
  ];

  const rect = renderer.domElement.getBoundingClientRect();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < 4; i += 1) {
    _v.set(localCorners[i][0], localCorners[i][1], localCorners[i][2]);
    _v.applyMatrix4(centerCard.cover.matrixWorld);
    _v.project(camera);
    const vx = (_v.x * 0.5 + 0.5) * rect.width;
    const vy = (-_v.y * 0.5 + 0.5) * rect.height;
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

export function worldToScreenY(camera, renderer, worldY) {
  _v.set(0, worldY, 0);
  _v.project(camera);
  return (-_v.y * 0.5 + 0.5) * renderer.domElement.clientHeight;
}

export function worldToScreenX(camera, renderer, worldX) {
  _v.set(worldX, 0, 0);
  _v.project(camera);
  return (_v.x * 0.5 + 0.5) * renderer.domElement.clientWidth;
}

export function getProjectedCenterCoverBounds(camera, renderer, offsetY) {
  const halfWidth = (PLANE_SIZE * CENTER_SCALE) / 2;
  const halfHeight = (PLANE_SIZE * CENTER_SCALE) / 2;
  const left = worldToScreenX(camera, renderer, -halfWidth);
  const right = worldToScreenX(camera, renderer, halfWidth);
  const top = worldToScreenY(camera, renderer, offsetY + halfHeight);
  const bottom = worldToScreenY(camera, renderer, offsetY - halfHeight);
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

function fitPlaybackStripLayout(containerEl, coverWidthPx, coverHeightPx) {
  const safeCoverWidth = Math.max(140, coverWidthPx || 0);
  const safeCoverHeight = Math.max(140, coverHeightPx || 0);
  const scaleT = clamp((Math.min(safeCoverWidth, safeCoverHeight) - 150) / 170, 0, 1);
  const mix = (min, max) => min + (max - min) * scaleT;
  const style = containerEl.style;
  style.setProperty("--playback-strip-gap", `${Math.round(mix(4, 10))}px`);
  style.setProperty("--seek-time-min-width", `${Math.round(Math.min(safeCoverWidth * 0.28, mix(48, 88)))}px`);
  style.setProperty("--seek-time-font-size", `${mix(9, 13).toFixed(1)}px`);
  style.setProperty("--seek-track-height", `${Math.round(mix(3, 5))}px`);
  style.setProperty("--seek-handle-size", `${Math.round(mix(8, 12))}px`);
}

function fitInfoPanelTypography(infoPanelEl, coverWidthPx, availableHeight) {
  const safeWidth = Math.max(160, coverWidthPx || 0);
  const safeHeight = Math.max(18, availableHeight || 0);
  const widthT = clamp((safeWidth - 180) / 220, 0, 1);
  const heightT = clamp((safeHeight - 22) / 34, 0, 1);
  const t = Math.min(widthT, heightT);
  const titleSize = 18 + t * 24;
  const artistSize = 12 + t * 8;
  const gap = Math.max(1, Math.round(1 + t * 2));
  infoPanelEl.style.setProperty("--info-title-size", `${titleSize.toFixed(1)}px`);
  infoPanelEl.style.setProperty("--info-artist-size", `${artistSize.toFixed(1)}px`);
  infoPanelEl.style.setProperty("--info-gap", `${gap}px`);
  const lineHeight = 1.12;
  return {
    titleSize,
    artistSize,
    height: Math.ceil(titleSize * lineHeight + gap + artistSize * lineHeight)
  };
}

function getControlsSurfaceTop(controlsEl) {
  const rect = controlsEl?.getBoundingClientRect();
  return rect?.top ?? window.innerHeight;
}

function fitControlsLayout(controlsEl) {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 800;
  const t = clamp((viewportHeight - 360) / 140, 0, 1);
  const controlsWidthT = clamp((viewportWidth - 620) / 420, 0, 1);
  const controlsT = (t + controlsWidthT) / 2;
  const mixControls = (min, max) => min + (max - min) * controlsT;
  controlsEl.style.setProperty("--controls-shell-width", `${Math.round(mixControls(320, 560))}px`);
}

/**
 * @param {object} opts
 * @param {object} opts.camera
 * @param {object} opts.renderer
 * @param {object|null} opts.centerCard
 * @param {HTMLElement} opts.containerEl
 * @param {HTMLElement} opts.playbackStripEl
 * @param {HTMLElement} opts.infoPanelEl
 * @param {HTMLElement} opts.controlsEl
 * @param {() => number} opts.getCoverflowOffsetY
 * @param {(next: number) => boolean} opts.setCoverflowOffsetY
 */
export function positionChrome(opts) {
  const {
    camera,
    renderer,
    centerCard,
    containerEl,
    playbackStripEl,
    infoPanelEl,
    controlsEl,
    getCoverflowOffsetY,
    setCoverflowOffsetY
  } = opts;

  fitControlsLayout(controlsEl);

  if (Math.abs(getCoverflowOffsetY() - DEFAULT_COVERFLOW_OFFSET_Y) > 0.01) {
    setCoverflowOffsetY(DEFAULT_COVERFLOW_OFFSET_Y);
  }

  let coverBounds =
    measureCenterCoverBounds(camera, renderer, centerCard) ||
    getProjectedCenterCoverBounds(camera, renderer, DEFAULT_COVERFLOW_OFFSET_Y);

  if (!coverBounds) {
    playbackStripEl.style.removeProperty("left");
    playbackStripEl.style.removeProperty("top");
    playbackStripEl.style.removeProperty("width");
    infoPanelEl.style.display = "none";
    return;
  }

  const containerRect = containerEl.getBoundingClientRect();
  const controlsTop = getControlsSurfaceTop(controlsEl);
  const controlsTopLocal = controlsTop - containerRect.top;
  let coverWidthPx = 0;
  let coverHeightPx = 0;

  const syncCoverChrome = () => {
    coverWidthPx = Math.min(containerEl.clientWidth * 0.9, Math.max(0, Math.round(coverBounds.width)));
    coverHeightPx = Math.max(0, Math.round(coverBounds.height));
    fitPlaybackStripLayout(containerEl, coverWidthPx, coverHeightPx);

    const playbackInsetX = clamp(Math.round(coverWidthPx * 0.04), 8, 18);
    const playbackWidthPx = Math.max(0, coverWidthPx - playbackInsetX * 2);
    playbackStripEl.style.left = `${Math.round(coverBounds.centerX)}px`;
    playbackStripEl.style.width = `${playbackWidthPx}px`;
    playbackStripEl.style.maxWidth = `${playbackWidthPx}px`;

    const playbackGap = clamp(Math.round(coverHeightPx * 0.015), 2, 6);
    const playbackHeightPx = Math.max(
      0,
      Math.round(playbackStripEl.getBoundingClientRect().height || playbackStripEl.offsetHeight || 0)
    );
    const playbackTop = Math.max(6, Math.round(coverBounds.top - playbackHeightPx - playbackGap));
    playbackStripEl.style.top = `${playbackTop}px`;

    infoPanelEl.style.bottom = "auto";
    infoPanelEl.style.width = `${coverWidthPx}px`;
    infoPanelEl.style.maxWidth = `${coverWidthPx}px`;
    infoPanelEl.style.left = `${Math.round(coverBounds.centerX)}px`;
    infoPanelEl.style.transform = "translateX(-50%)";
    return playbackTop;
  };

  let playbackTop = syncCoverChrome();

  const desiredTopMargin = clamp(Math.round(coverHeightPx * 0.015), 4, 10);
  for (let pass = 0; pass < 3; pass += 1) {
    const excess = playbackTop - desiredTopMargin;
    if (excess <= 3) break;
    const curOffset = getCoverflowOffsetY();
    const probe = 10;
    const y1 = worldToScreenY(camera, renderer, curOffset);
    const y2 = worldToScreenY(camera, renderer, curOffset + probe);
    if (y1 == null || y2 == null || Math.abs(y1 - y2) < 0.1) break;
    const pxPerUnit = Math.abs(y1 - y2) / probe;
    const worldShift = excess / pxPerUnit;
    if (!setCoverflowOffsetY(curOffset + worldShift)) break;
    coverBounds =
      measureCenterCoverBounds(camera, renderer, centerCard) ||
      getProjectedCenterCoverBounds(camera, renderer, curOffset + worldShift) ||
      coverBounds;
    playbackTop = syncCoverChrome();
  }

  const infoPanelGap = clamp(Math.round(coverHeightPx * 0.006), 1, 3);
  const infoBottomMargin = clamp(Math.round(coverHeightPx * 0.012), 2, 6);
  const minInfoTop = Math.round(coverBounds.bottom + infoPanelGap);
  const availableInfoHeight = Math.max(0, Math.floor(controlsTopLocal - minInfoTop - infoBottomMargin));

  if (availableInfoHeight < 10) {
    infoPanelEl.style.display = "none";
  } else {
    infoPanelEl.style.display = "";
    const infoLayout = fitInfoPanelTypography(infoPanelEl, coverWidthPx, availableInfoHeight);
    const desiredBottomGap = clamp(Math.round(coverHeightPx * 0.012), 4, 8);
    const preferredInfoTop = Math.floor(
      controlsTopLocal - infoBottomMargin - infoLayout.height - desiredBottomGap
    );
    const infoTop = Math.max(minInfoTop, preferredInfoTop);
    infoPanelEl.style.top = `${infoTop}px`;
  }
}

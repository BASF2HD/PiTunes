import {
  initScene,
  setAlbumData,
  navigateTo,
  jumpTo,
  onSnap,
  loadTexture,
  getDefaultTexture,
  getActiveCoverBounds,
  getCenterCoverMetrics,
  setCoverflowOffsetY,
  worldToScreenY,
  getProjectedCenterCoverBounds
} from "./renderer.js";

const PAGE_SIZE = 96;

const api = {
  albums: (offset = 0, filter = "") =>
    fetchJson(
      `/api/library/albums?offset=${offset}&limit=${PAGE_SIZE}${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`
    ),
  tracks: (albumId) => fetchJson(`/api/library/album/${encodeURIComponent(albumId)}/tracks`),
  artists: () => fetchJson("/api/library/artists"),
  search: (q) => fetchJson(`/api/search?q=${encodeURIComponent(q)}&limit=200`),
  scanStatus: () => fetchJson("/api/library/scan-status"),
  state: () => fetchJson("/api/player/state"),
  settings: () => fetchJson("/api/settings"),
  audio: () => fetchJson("/api/audio/devices"),
  post: (path, body = {}) =>
    fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then((res) => res.json())
};

const state = {
  albums: [],
  albumTotal: 0,
  albumFilter: "",
  loadingMore: false,
  browseIndex: 0,
  currentAlbum: null,
  playing: false,
  duration: 0,
  elapsed: 0,
  seekDragging: false
};

const el = {
  container: document.querySelector("#coverflow-container"),
  controls: document.querySelector("#controls"),
  transport: document.querySelector("#transport"),
  playbackStrip: document.querySelector("#playback-strip"),
  infoPanel: document.querySelector("#info-panel"),
  title: document.querySelector("#album-title"),
  albumArtist: document.querySelector("#album-artist"),
  topTime: document.querySelector("#top-time"),
  topSeek: document.querySelector("#top-seek"),
  searchToggle: document.querySelector("#search-toggle"),
  search: document.querySelector("#search-input"),
  fullscreen: document.querySelector("#fullscreen-button"),
  mute: document.querySelector("#mute-button"),
  previous: document.querySelector("#previous-button"),
  play: document.querySelector("#play-button"),
  playIcon: document.querySelector("#play-icon"),
  pauseIcon: document.querySelector("#pause-icon"),
  next: document.querySelector("#next-button"),
  browseStrip: document.querySelector("#browse-strip"),
  seekTrack: document.querySelector("#seek-track"),
  seekFill: document.querySelector("#seek-fill"),
  seekHandle: document.querySelector("#seek-handle"),
  browseBack: document.querySelector("#browse-back"),
  browseForward: document.querySelector("#browse-forward"),
  trackListButton: document.querySelector("#track-list-button"),
  dockTabs: document.querySelectorAll(".browse-btn"),
  drawer: document.querySelector("#tracks-drawer"),
  drawerTitle: document.querySelector("#drawer-title"),
  drawerSubtitle: document.querySelector("#drawer-subtitle"),
  drawerClose: document.querySelector("#drawer-close"),
  trackList: document.querySelector("#track-list"),
  playAlbum: document.querySelector("#play-album-button"),
  settingsButton: document.querySelector("#settings-button"),
  settingsPanel: document.querySelector("#settings-panel"),
  settingsClose: document.querySelector("#settings-close"),
  settingsForm: document.querySelector("#settings-form"),
  settingMusicPath: document.querySelector("#setting-music-path"),
  audioOutputDevice: document.querySelector("#audio-output-device"),
  audioOutputMixer: document.querySelector("#audio-output-mixer"),
  rescan: document.querySelector("#rescan-button"),
  rebuild: document.querySelector("#rebuild-button"),
  audioRefresh: document.querySelector("#audio-refresh-button"),
  settingsStatus: document.querySelector("#settings-status")
};

let albumTextures = [];
const texturePromises = new Map();

initScene(el.container);
onSnap(handleSnap);

function coverCanvas() {
  return el.container.querySelector("canvas");
}

function albumArtUrl(album) {
  return album.artUrl || `/api/art?album_id=${encodeURIComponent(album.id)}&size=128`;
}

function ensureTexture(index) {
  if (index < 0 || index >= state.albums.length) return;
  if (albumTextures[index]) return;
  const album = state.albums[index];
  const url = albumArtUrl(album);
  if (!texturePromises.has(url)) {
    texturePromises.set(url, loadTexture(url));
  }
  texturePromises.get(url).then((texture) => {
    if (state.albums[index]?.id !== album.id) return;
    albumTextures[index] = texture;
    if (albumTextures.length === state.albums.length && state.albums.length > 0) {
      setAlbumData(albumTextures.map((tex) => tex || getDefaultTexture()));
    }
  });
}

function ensureTextures(anchorIndex = state.browseIndex) {
  const start = Math.max(0, anchorIndex - 8);
  const end = Math.min(state.albums.length, anchorIndex + 9);
  for (let index = start; index < end; index += 1) {
    ensureTexture(index);
  }
}

function syncAlbumSlides({ jump = false } = {}) {
  while (albumTextures.length < state.albums.length) {
    albumTextures.push(null);
  }
  if (albumTextures.length > state.albums.length) {
    albumTextures.length = state.albums.length;
  }
  ensureTextures(state.browseIndex);
  setAlbumData(albumTextures.map((tex) => tex || getDefaultTexture()));
  if (jump && state.albums.length) {
    jumpTo(state.browseIndex);
  }
}

function handleSnap(index) {
  state.browseIndex = clamp(index, 0, Math.max(0, state.albums.length - 1));
  updateAlbumLabel(true);
  updateBrowseStrip();
  positionInfoPanel();
  maybeLoadMoreAlbums();
}

function navigateBrowseBy(delta) {
  if (!state.albums.length) return;
  navigateBrowseToIndex(state.browseIndex + delta);
}

function navigateBrowseToIndex(nextIndex) {
  if (!state.albums.length) return;
  const clamped = clamp(nextIndex, 0, state.albums.length - 1);
  if (clamped === state.browseIndex) {
    updateBrowseStrip();
    return;
  }
  state.browseIndex = clamped;
  ensureTextures(clamped);
  updateAlbumLabel(true);
  updateBrowseStrip();
  navigateTo(clamped);
}

function updateBrowseStrip() {
  const max = Math.max(0, state.albums.length - 1);
  el.browseStrip.max = String(max);
  el.browseStrip.value = String(state.browseIndex);
  el.browseStrip.disabled = max <= 0;
}

function updateAlbumLabel(force = false) {
  const album = state.albums[state.browseIndex];
  if (!album) return;
  if (!force && album === state.currentAlbum) return;
  state.currentAlbum = album;
  el.title.textContent = album.title || "Unknown Album";
  el.albumArtist.textContent = [album.albumArtist || album.artist, album.year].filter(Boolean).join(" · ");
}

function getControlsSurfaceTop() {
  const tops = [el.controls, el.transport]
    .map((node) => node?.getBoundingClientRect().top)
    .filter(Number.isFinite);
  return tops.length ? Math.min(...tops) : window.innerHeight;
}

function fitControlsLayout() {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 800;
  const t = clamp((viewportHeight - 360) / 140, 0, 1);
  const controlsWidthT = clamp((viewportWidth - 620) / 420, 0, 1);
  const controlsT = (t + controlsWidthT) / 2;
  const mixControls = (min, max) => min + (max - min) * controlsT;
  el.controls.style.setProperty("--controls-shell-width", `${Math.round(mixControls(320, 560))}px`);
}

function fitPlaybackStripLayout(coverWidthPx, coverHeightPx) {
  const safeCoverWidth = Math.max(140, coverWidthPx || 0);
  const safeCoverHeight = Math.max(140, coverHeightPx || 0);
  const scaleT = clamp((Math.min(safeCoverWidth, safeCoverHeight) - 150) / 170, 0, 1);
  const mix = (min, max) => min + (max - min) * scaleT;
  const style = el.container.style;
  style.setProperty("--playback-strip-gap", `${Math.round(mix(4, 10))}px`);
  style.setProperty("--seek-time-min-width", `${Math.round(Math.min(safeCoverWidth * 0.28, mix(48, 88)))}px`);
  style.setProperty("--seek-time-font-size", `${mix(9, 13).toFixed(1)}px`);
  style.setProperty("--seek-track-height", `${Math.round(mix(3, 5))}px`);
  style.setProperty("--seek-handle-size", `${Math.round(mix(8, 12))}px`);
}

function fitInfoPanelTypography(coverWidthPx, availableHeight) {
  const safeWidth = Math.max(160, coverWidthPx || 0);
  const safeHeight = Math.max(18, availableHeight || 0);
  const widthT = clamp((safeWidth - 180) / 220, 0, 1);
  const heightT = clamp((safeHeight - 22) / 34, 0, 1);
  const t = Math.min(widthT, heightT);
  const titleSize = 18 + t * 24;
  const artistSize = 12 + t * 8;
  const gap = Math.max(1, Math.round(1 + t * 2));
  el.infoPanel.style.setProperty("--info-title-size", `${titleSize.toFixed(1)}px`);
  el.infoPanel.style.setProperty("--info-artist-size", `${artistSize.toFixed(1)}px`);
  el.infoPanel.style.setProperty("--info-gap", `${gap}px`);
  const lineHeight = 1.12;
  return { height: Math.ceil(titleSize * lineHeight + gap + artistSize * lineHeight) };
}

function positionInfoPanel() {
  fitControlsLayout();

  const coverMetrics = getCenterCoverMetrics();
  if (Math.abs(coverMetrics.offsetY - coverMetrics.defaultOffsetY) > 0.01) {
    setCoverflowOffsetY(coverMetrics.defaultOffsetY);
  }

  let coverBounds = getActiveCoverBounds() || getProjectedCenterCoverBounds();
  if (!coverBounds) {
    el.playbackStrip.style.removeProperty("left");
    el.playbackStrip.style.removeProperty("top");
    el.playbackStrip.style.removeProperty("width");
    el.infoPanel.style.display = "none";
    return;
  }

  const containerRect = el.container.getBoundingClientRect();
  const controlsTopLocal = getControlsSurfaceTop() - containerRect.top;
  let coverWidthPx = 0;
  let coverHeightPx = 0;

  const syncCoverLayout = () => {
    coverWidthPx = Math.min(el.container.clientWidth * 0.9, Math.max(0, Math.round(coverBounds.width)));
    coverHeightPx = Math.max(0, Math.round(coverBounds.height));
    fitPlaybackStripLayout(coverWidthPx, coverHeightPx);

    const playbackInsetX = clamp(Math.round(coverWidthPx * 0.04), 8, 18);
    const playbackWidthPx = Math.max(0, coverWidthPx - playbackInsetX * 2);
    el.playbackStrip.style.left = `${Math.round(coverBounds.centerX)}px`;
    el.playbackStrip.style.width = `${playbackWidthPx}px`;
    el.playbackStrip.style.maxWidth = `${playbackWidthPx}px`;

    const playbackGap = clamp(Math.round(coverHeightPx * 0.015), 2, 6);
    const playbackHeightPx = Math.max(
      0,
      Math.round(el.playbackStrip.getBoundingClientRect().height || el.playbackStrip.offsetHeight || 0)
    );
    const playbackTop = Math.max(6, Math.round(coverBounds.top - playbackHeightPx - playbackGap));
    el.playbackStrip.style.top = `${playbackTop}px`;

    el.infoPanel.style.bottom = "auto";
    el.infoPanel.style.width = `${coverWidthPx}px`;
    el.infoPanel.style.maxWidth = `${coverWidthPx}px`;
    el.infoPanel.style.left = `${Math.round(coverBounds.centerX)}px`;
    el.infoPanel.style.transform = "translateX(-50%)";
    return playbackTop;
  };

  let playbackTop = syncCoverLayout();

  const desiredTopMargin = clamp(Math.round(coverHeightPx * 0.015), 4, 10);
  for (let pass = 0; pass < 3; pass += 1) {
    const excess = playbackTop - desiredTopMargin;
    if (excess <= 3) break;
    const curOffset = getCenterCoverMetrics().offsetY;
    const probe = 10;
    const y1 = worldToScreenY(curOffset);
    const y2 = worldToScreenY(curOffset + probe);
    if (y1 == null || y2 == null || Math.abs(y1 - y2) < 0.1) break;
    const worldShift = excess / (Math.abs(y1 - y2) / probe);
    if (!setCoverflowOffsetY(curOffset + worldShift)) break;
    coverBounds = getActiveCoverBounds() || getProjectedCenterCoverBounds() || coverBounds;
    playbackTop = syncCoverLayout();
  }

  const infoPanelGap = clamp(Math.round(coverHeightPx * 0.006), 1, 3);
  const infoBottomMargin = clamp(Math.round(coverHeightPx * 0.012), 2, 6);
  const minInfoTop = Math.round(coverBounds.bottom + infoPanelGap);
  const availableInfoHeight = Math.max(0, Math.floor(controlsTopLocal - minInfoTop - infoBottomMargin));

  if (availableInfoHeight < 10) {
    el.infoPanel.style.display = "none";
  } else {
    el.infoPanel.style.display = "";
    const infoLayout = fitInfoPanelTypography(coverWidthPx, availableInfoHeight);
    const desiredBottomGap = clamp(Math.round(coverHeightPx * 0.012), 4, 8);
    const preferredInfoTop = Math.floor(
      controlsTopLocal - infoBottomMargin - infoLayout.height - desiredBottomGap
    );
    el.infoPanel.style.top = `${Math.max(minInfoTop, preferredInfoTop)}px`;
  }
}

async function maybeLoadMoreAlbums() {
  if (state.loadingMore || state.albumFilter.startsWith("search:")) return;
  if (state.albums.length >= state.albumTotal) return;
  if (state.browseIndex < state.albums.length - 24) return;
  state.loadingMore = true;
  try {
    const data = await api.albums(state.albums.length, state.albumFilter);
    const incoming = data.albums || [];
    if (incoming.length) {
      state.albums.push(...incoming);
      state.albumTotal = data.total ?? state.albumTotal;
      syncAlbumSlides();
    }
  } finally {
    state.loadingMore = false;
  }
}

async function loadAlbums(filter = "", resetIndex = true) {
  state.albumFilter = filter;
  const data = await api.albums(0, filter);
  state.albums = data.albums || [];
  state.albumTotal = data.total ?? state.albums.length;
  albumTextures = [];
  texturePromises.clear();
  if (resetIndex) {
    state.browseIndex = 0;
    state.currentAlbum = null;
  }
  syncAlbumSlides({ jump: true });
  updateBrowseStrip();
  positionInfoPanel();
}

async function openDrawer(album = state.currentAlbum) {
  if (!album) return;
  const data = await api.tracks(album.id);
  el.drawerTitle.textContent = album.title || "Tracks";
  el.drawerSubtitle.textContent = [album.albumArtist || album.artist, album.year].filter(Boolean).join(" - ");
  el.trackList.innerHTML = "";
  for (const track of data.tracks || []) {
    const row = document.createElement("div");
    row.className = "track-row";
    row.innerHTML = `<div class="track-number"></div><button type="button"></button><div class="track-duration"></div>`;
    row.children[0].textContent = track.trackNumber || "";
    row.children[1].textContent = track.title || "Untitled";
    row.children[2].textContent = formatTime(track.duration);
    row.children[1].addEventListener("click", () => api.post("/api/player/play", { trackId: track.id }));
    el.trackList.appendChild(row);
  }
  el.drawer.classList.add("open");
  el.drawer.setAttribute("aria-hidden", "false");
}

function updateSeekUi() {
  const max = Math.max(0, Math.floor(state.duration));
  const elapsed = Math.max(0, Math.floor(state.elapsed));
  const percent = max > 0 ? clamp((elapsed / max) * 100, 0, 100) : 0;
  el.topSeek.max = String(max);
  el.topSeek.value = String(elapsed);
  el.seekFill.style.width = `${percent}%`;
  el.seekHandle.style.left = `${percent}%`;
  el.seekTrack.setAttribute("aria-valuenow", String(Math.round(percent)));
  el.topTime.textContent = `${formatTime(elapsed)} / ${max > 0 ? formatTime(max) : "--:--"}`;
  el.playIcon.classList.toggle("hidden", state.playing);
  el.pauseIcon.classList.toggle("hidden", !state.playing);
}

async function refreshPlayer() {
  const data = await api.state();
  const status = data.status || {};
  const song = data.song || {};
  state.playing = status.state === "play";
  state.duration = Number(status.duration || song.Time || 0);
  state.elapsed = Number(status.elapsed || 0);
  updateSeekUi();
}

function seekFromClientX(clientX) {
  const rect = el.seekTrack.getBoundingClientRect();
  if (rect.width <= 0 || state.duration <= 0) return 0;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const seconds = Math.floor(state.duration * ratio);
  state.elapsed = seconds;
  updateSeekUi();
  return seconds;
}

async function commitSeek(seconds) {
  await api.post("/api/player/seek", { seconds });
  await refreshPlayer();
}

async function openSettings() {
  const data = await api.settings();
  el.settingMusicPath.value = data.config?.musicDir || data.settings?.music_directory || "/mnt/music";
  const scan = data.scan || {};
  el.settingsStatus.textContent = scan.running
    ? `Library scan: ${scan.message || "running"}…`
    : `Library: ${data.counts?.albums ?? 0} albums, ${data.counts?.tracks ?? 0} tracks (${data.libraryBackend || "mpd"})`;
  await refreshAudioDevices();
  el.settingsPanel.classList.add("open");
  el.settingsPanel.setAttribute("aria-hidden", "false");
}

async function refreshAudioDevices() {
  const data = await api.audio().catch(() => ({ devices: [] }));
  el.audioOutputDevice.innerHTML = "";
  for (const device of data.devices || [{ alsa: "default", label: "default - ALSA default output" }]) {
    const option = document.createElement("option");
    option.value = device.alsa;
    option.textContent = device.label;
    if (data.current?.device === device.alsa) option.selected = true;
    el.audioOutputDevice.appendChild(option);
  }
  if (data.current?.mixer) el.audioOutputMixer.value = data.current.mixer;
}

function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function fetchJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizedWheelStep(event) {
  let delta = event.deltaY;
  if (event.deltaMode === 1) delta *= 16;
  else if (event.deltaMode === 2) delta *= window.innerHeight;
  return clamp(delta * 0.004, -1.2, 1.2);
}

const canvas = coverCanvas();
if (canvas) {
  canvas.addEventListener("click", (event) => {
    const bounds = getActiveCoverBounds();
    if (!bounds) return;
    const rect = canvas.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const coverCenterX = bounds.centerX;
    if (localX < coverCenterX) navigateBrowseBy(-1);
    else navigateBrowseBy(1);
    event.stopPropagation();
  });
}

let wheelAccum = 0;
let wheelTimer = 0;
el.container.addEventListener(
  "wheel",
  (event) => {
    if (event.target.closest?.("#tracks-drawer")) return;
    event.preventDefault();
    wheelAccum += normalizedWheelStep(event);
    const wholeSteps = wheelAccum > 0 ? Math.floor(wheelAccum) : Math.ceil(wheelAccum);
    if (wholeSteps !== 0) {
      navigateBrowseBy(wholeSteps);
      wheelAccum -= wholeSteps;
    }
    clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => {
      wheelAccum = 0;
    }, 140);
  },
  { passive: false }
);

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") navigateBrowseBy(-1);
  if (event.key === "ArrowRight") navigateBrowseBy(1);
  if (event.key === "Enter") openDrawer();
  if (event.key === "Escape") {
    el.drawer.classList.remove("open");
    el.settingsPanel.classList.remove("open");
  }
});

if (canvas) {
  canvas.addEventListener("dblclick", () => openDrawer());
}
el.trackListButton.addEventListener("click", () => openDrawer());
el.drawerClose.addEventListener("click", () => el.drawer.classList.remove("open"));
el.playAlbum.addEventListener("click", () =>
  state.currentAlbum && api.post("/api/player/queue", { albumId: state.currentAlbum.id, clear: true, play: true })
);
el.play.addEventListener("click", () =>
  api.post(state.playing ? "/api/player/pause" : "/api/player/play").then(refreshPlayer)
);
el.previous.addEventListener("click", () => api.post("/api/player/previous").then(refreshPlayer));
el.next.addEventListener("click", () => api.post("/api/player/next").then(refreshPlayer));

function bindSeekInput(input) {
  input.addEventListener("input", () => {
    state.elapsed = Number(input.value);
    updateSeekUi();
  });
  input.addEventListener("change", () => commitSeek(Number(input.value)));
}

bindSeekInput(el.topSeek);

el.browseStrip.addEventListener("input", () => navigateBrowseToIndex(Number(el.browseStrip.value)));
el.browseStrip.addEventListener("change", () => navigateBrowseToIndex(Number(el.browseStrip.value)));

el.seekTrack.addEventListener("pointerdown", (event) => {
  state.seekDragging = true;
  el.seekTrack.setPointerCapture(event.pointerId);
  seekFromClientX(event.clientX);
});
el.seekTrack.addEventListener("pointermove", (event) => {
  if (!state.seekDragging) return;
  seekFromClientX(event.clientX);
});
el.seekTrack.addEventListener("pointerup", () => {
  if (!state.seekDragging) return;
  state.seekDragging = false;
  commitSeek(state.elapsed);
});

el.browseBack.addEventListener("click", () => navigateBrowseBy(-1));
el.browseForward.addEventListener("click", () => navigateBrowseBy(1));
el.searchToggle.addEventListener("click", () => {
  el.playbackStrip.classList.toggle("search-open");
  if (el.playbackStrip.classList.contains("search-open")) el.search.focus();
});
el.search.addEventListener("input", async () => {
  const query = el.search.value.trim();
  if (!query) {
    await loadAlbums();
    return;
  }
  const data = await api.search(query);
  state.albums = data.albums || [];
  state.albumTotal = state.albums.length;
  state.albumFilter = "search:" + query;
  state.browseIndex = 0;
  state.currentAlbum = null;
  albumTextures = [];
  texturePromises.clear();
  syncAlbumSlides({ jump: true });
  updateBrowseStrip();
  positionInfoPanel();
});
el.fullscreen.addEventListener("click", () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
el.mute.addEventListener("click", () => api.post("/api/player/volume", { volume: 0 }).then(refreshPlayer));
el.settingsButton.addEventListener("click", openSettings);
el.settingsClose.addEventListener("click", () => el.settingsPanel.classList.remove("open"));
el.rescan.addEventListener("click", async () => {
  el.settingsStatus.textContent = "Starting library scan…";
  await api.post("/api/library/rescan");
  const poll = setInterval(async () => {
    const scan = await api.scanStatus();
    el.settingsStatus.textContent = scan.running ? `Scanning: ${scan.message}` : `Scan complete — ${scan.albumCount} albums`;
    if (!scan.running) {
      clearInterval(poll);
      await loadAlbums(state.albumFilter.replace(/^search:.*/, ""));
    }
  }, 2000);
});
el.rebuild.addEventListener("click", () =>
  api.post("/api/library/rebuild-cache").then((data) => {
    el.settingsStatus.textContent = data.message || "Artwork cache rebuilt.";
  })
);
el.audioRefresh.addEventListener("click", refreshAudioDevices);
el.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await api.post("/api/settings", {
    music_directory: el.settingMusicPath.value,
    audio_output: el.audioOutputDevice.value
  });
  el.settingsStatus.textContent = "Settings saved.";
});
for (const tab of el.dockTabs) {
  tab.addEventListener("click", async () => {
    for (const other of el.dockTabs) other.classList.remove("active");
    tab.classList.add("active");
    if (tab.dataset.view === "settings") await openSettings();
    else if (tab.dataset.view === "songs") await openDrawer();
    else if (tab.dataset.view === "artists") {
      const artists = await api.artists();
      const first = artists.artists?.[0]?.name;
      if (first) await loadAlbums(`artist:${first}`);
    } else if (tab.dataset.view === "albums") await loadAlbums();
  });
}

window.addEventListener("resize", positionInfoPanel);
window.addEventListener("orientationchange", positionInfoPanel);

await loadAlbums();
await refreshPlayer();
setInterval(refreshPlayer, 2000);
positionInfoPanel();

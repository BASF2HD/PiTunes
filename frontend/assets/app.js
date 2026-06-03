import * as THREE from "/vendor/three.module.js";

const PAGE_SIZE = 96;
const TEXTURE_CACHE_MAX = 48;

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
  currentAlbum: null,
  textures: new Map(),
  textureOrder: [],
  speed: 0.30,
  visible: 31,
  playing: false,
  duration: 0,
  elapsed: 0,
  targetIndex: 0,
  renderIndex: 0,
  dragging: false,
  dragStartX: 0,
  dragStartIndex: 0
};

const el = {
  app: document.querySelector("#app"),
  coverflow: document.querySelector("#coverflow"),
  title: document.querySelector("#album-title"),
  menu: document.querySelector("#album-menu-button"),
  topTime: document.querySelector("#top-time"),
  topSeek: document.querySelector("#top-seek"),
  searchToggle: document.querySelector("#search-toggle"),
  search: document.querySelector("#search-input"),
  fullscreen: document.querySelector("#fullscreen-button"),
  mute: document.querySelector("#mute-button"),
  previous: document.querySelector("#previous-button"),
  play: document.querySelector("#play-button"),
  playIcon: document.querySelector("#play-icon path"),
  next: document.querySelector("#next-button"),
  seek: document.querySelector("#seek-input"),
  seekBack: document.querySelector("#seek-back"),
  seekForward: document.querySelector("#seek-forward"),
  trackListButton: document.querySelector("#track-list-button"),
  dockTabs: document.querySelectorAll(".dock-tab"),
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
  settingSpeed: document.querySelector("#setting-speed"),
  settingVisible: document.querySelector("#setting-visible"),
  rescan: document.querySelector("#rescan-button"),
  rebuild: document.querySelector("#rebuild-button"),
  audioRefresh: document.querySelector("#audio-refresh-button"),
  saveSettings: document.querySelector("#save-settings-button"),
  settingsStatus: document.querySelector("#settings-status")
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 1, 5000);
camera.position.set(0, 15, 1050);
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
el.coverflow.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 1));

const loader = new THREE.TextureLoader();
const fallbackTexture = makeFallbackTexture();
let poolRadius = 0;
let cardPool = [];

function poolSize() {
  return poolRadius * 2 + 1;
}

function updatePoolRadius() {
  poolRadius = Math.max(8, Math.ceil(state.visible / 2) + 2);
}

function createCardMesh() {
  const group = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(470, 470);
  const material = new THREE.MeshBasicMaterial({ map: fallbackTexture, transparent: true });
  const cover = new THREE.Mesh(geometry, material);
  group.add(cover);

  const reflectionMaterial = new THREE.MeshBasicMaterial({
    map: fallbackTexture,
    transparent: true,
    opacity: 0.28
  });
  const reflection = new THREE.Mesh(geometry, reflectionMaterial);
  reflection.position.y = -500;
  reflection.scale.y = -0.72;
  group.add(reflection);

  scene.add(group);
  return {
    group,
    cover,
    reflection,
    album: null,
    albumIndex: -1,
    index: 0
  };
}

function ensureCardPool() {
  updatePoolRadius();
  const needed = poolSize();
  while (cardPool.length < needed) {
    cardPool.push(createCardMesh());
  }
  while (cardPool.length > needed) {
    const card = cardPool.pop();
    scene.remove(card.group);
  }
}

function rememberTexture(id, texture) {
  if (state.textures.has(id)) {
    const existing = state.textures.get(id);
    if (existing !== texture) existing.dispose?.();
  }
  state.textures.set(id, texture);
  state.textureOrder = state.textureOrder.filter((key) => key !== id);
  state.textureOrder.push(id);
  while (state.textureOrder.length > TEXTURE_CACHE_MAX) {
    const evict = state.textureOrder.shift();
    const old = state.textures.get(evict);
    state.textures.delete(evict);
    old?.dispose?.();
  }
}

function setTexture(card, album) {
  if (!album) {
    applyTexture(card, fallbackTexture);
    return;
  }
  const cached = state.textures.get(album.id);
  if (cached) {
    applyTexture(card, cached);
    return;
  }
  applyTexture(card, fallbackTexture);
  const url = album.artUrl || `/api/art?album_id=${album.id}&size=128`;
  loader.load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      rememberTexture(album.id, texture);
      if (card.album?.id === album.id) applyTexture(card, texture);
    },
    undefined,
    () => {}
  );
}

function applyTexture(card, texture) {
  card.cover.material.map = texture;
  card.reflection.material.map = texture;
  card.cover.material.needsUpdate = true;
  card.reflection.material.needsUpdate = true;
}

function layoutCard(card) {
  const offset = card.index - state.renderIndex;
  const abs = Math.abs(offset);
  const side = Math.sign(offset);
  const radius = Math.max(8, Math.floor(state.visible / 2));

  if (abs > radius) {
    card.group.visible = false;
    return;
  }

  card.group.visible = true;
  const centerBlend = Math.min(1, abs);
  const eased = easeOutCubic(centerBlend);
  const folded = Math.max(0, abs - 1);
  const x = side * (eased * 430 + folded * 158);
  const z = lerp(150, -45, eased) - Math.min(folded, 11) * 18;
  const y = lerp(66, 40, eased) - Math.min(folded, 4) * 7;
  const rotation = side * -1.16 * eased;
  const scale = lerp(1.2, 1.02, eased) - Math.min(folded, 8) * 0.012;
  card.group.position.set(x, y, z);
  card.group.rotation.set(0, rotation, 0);
  card.group.scale.setScalar(Math.max(0.74, scale));
  card.cover.material.opacity = Math.max(0.42, 1 - abs * 0.025);
  card.reflection.material.opacity = Math.max(0.08, 0.32 - abs * 0.012);
}

function syncCardPool() {
  ensureCardPool();
  const center = Math.round(state.renderIndex);
  for (let slot = 0; slot < cardPool.length; slot += 1) {
    const albumIndex = center - poolRadius + slot;
    const card = cardPool[slot];
    card.index = albumIndex;

    if (albumIndex < 0 || albumIndex >= state.albums.length) {
      card.album = null;
      card.albumIndex = -1;
      card.group.visible = false;
      continue;
    }

    const album = state.albums[albumIndex];
    if (card.albumIndex !== albumIndex) {
      card.albumIndex = albumIndex;
      card.album = album;
      setTexture(card, album);
    }
    layoutCard(card);
  }
}

function renderLoop() {
  state.renderIndex += (state.targetIndex - state.renderIndex) * state.speed;
  if (Math.abs(state.targetIndex - state.renderIndex) < 0.001) {
    state.renderIndex = state.targetIndex;
  }
  syncCardPool();
  maybeLoadMoreAlbums();
  const album = state.albums[Math.round(state.targetIndex)];
  if (album && album !== state.currentAlbum) {
    state.currentAlbum = album;
    el.title.textContent = album.title || "Unknown Album";
  }
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

async function maybeLoadMoreAlbums() {
  if (state.loadingMore || state.albumFilter.startsWith("search:")) return;
  const index = Math.round(state.targetIndex);
  if (state.albums.length >= state.albumTotal) return;
  if (index < state.albums.length - 24) return;
  state.loadingMore = true;
  try {
    const data = await api.albums(state.albums.length, state.albumFilter);
    const incoming = data.albums || [];
    if (incoming.length) {
      state.albums.push(...incoming);
      state.albumTotal = data.total ?? state.albumTotal;
    }
  } finally {
    state.loadingMore = false;
  }
}

function goTo(index) {
  state.targetIndex = clamp(index, 0, Math.max(0, state.albums.length - 1));
}

async function loadAlbums(filter = "", resetIndex = true) {
  state.albumFilter = filter;
  const data = await api.albums(0, filter);
  state.albums = data.albums || [];
  state.albumTotal = data.total ?? state.albums.length;
  if (resetIndex) {
    state.targetIndex = 0;
    state.renderIndex = 0;
    state.currentAlbum = null;
  }
  syncCardPool();
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

async function refreshPlayer() {
  const data = await api.state();
  const status = data.status || {};
  const song = data.song || {};
  state.playing = status.state === "play";
  state.duration = Number(status.duration || song.Time || 0);
  state.elapsed = Number(status.elapsed || 0);
  el.playIcon.setAttribute("d", state.playing ? "M7 5h4v14H7zm6 0h4v14h-4z" : "M8 5v14l11-7z");
  const max = Math.max(1, Math.floor(state.duration));
  el.seek.max = max;
  el.topSeek.max = max;
  el.seek.value = Math.floor(state.elapsed);
  el.topSeek.value = Math.floor(state.elapsed);
  el.topTime.textContent = `${formatTime(state.elapsed)} / ${state.duration ? formatTime(state.duration) : "--:--"}`;
}

async function openSettings() {
  const data = await api.settings();
  el.settingMusicPath.value = data.config?.musicDir || data.settings?.music_directory || "/mnt/music";
  state.speed = Number(data.settings?.animationSpeed ?? data.config?.ui?.animationSpeed ?? state.speed);
  state.visible = Number(data.settings?.visibleCoverCount ?? data.config?.ui?.visibleCoverCount ?? state.visible);
  el.settingSpeed.value = state.speed;
  el.settingVisible.value = state.visible;
  updatePoolRadius();
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

function resize() {
  const rect = el.coverflow.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function makeFallbackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, "#111");
  grad.addColorStop(1, "#303746");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#020308";
  ctx.beginPath();
  ctx.arc(128, 128, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#f5f5f5";
  ctx.beginPath();
  ctx.arc(128, 128, 18, 0, Math.PI * 2);
  ctx.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

el.coverflow.addEventListener("pointerdown", (event) => {
  state.dragging = true;
  state.dragStartX = event.clientX;
  state.dragStartIndex = state.targetIndex;
  el.coverflow.classList.add("dragging");
  el.coverflow.setPointerCapture(event.pointerId);
});

el.coverflow.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  goTo(state.dragStartIndex - (event.clientX - state.dragStartX) / 150);
});

el.coverflow.addEventListener("pointerup", () => {
  state.dragging = false;
  el.coverflow.classList.remove("dragging");
  goTo(Math.round(state.targetIndex));
});

el.coverflow.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    goTo(Math.round(state.targetIndex + Math.sign(event.deltaY || event.deltaX)));
  },
  { passive: false }
);

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") goTo(Math.round(state.targetIndex) - 1);
  if (event.key === "ArrowRight") goTo(Math.round(state.targetIndex) + 1);
  if (event.key === "Enter") openDrawer();
  if (event.key === "Escape") {
    el.drawer.classList.remove("open");
    el.settingsPanel.classList.remove("open");
  }
});

el.coverflow.addEventListener("dblclick", () => openDrawer());
el.menu.addEventListener("click", () => openDrawer());
el.trackListButton.addEventListener("click", () => openDrawer());
el.drawerClose.addEventListener("click", () => el.drawer.classList.remove("open"));
el.playAlbum.addEventListener("click", () =>
  state.currentAlbum && api.post("/api/player/queue", { albumId: state.currentAlbum.id, clear: true, play: true })
);
el.play.addEventListener("click", () => api.post(state.playing ? "/api/player/pause" : "/api/player/play").then(refreshPlayer));
el.previous.addEventListener("click", () => api.post("/api/player/previous").then(refreshPlayer));
el.next.addEventListener("click", () => api.post("/api/player/next").then(refreshPlayer));
el.seek.addEventListener("change", () => api.post("/api/player/seek", { seconds: Number(el.seek.value) }).then(refreshPlayer));
el.topSeek.addEventListener("change", () => api.post("/api/player/seek", { seconds: Number(el.topSeek.value) }).then(refreshPlayer));
el.seekBack.addEventListener("click", () => goTo(Math.round(state.targetIndex) - 1));
el.seekForward.addEventListener("click", () => goTo(Math.round(state.targetIndex) + 1));
el.searchToggle.addEventListener("click", () => {
  el.search.parentElement.classList.toggle("search-open");
  if (el.search.parentElement.classList.contains("search-open")) el.search.focus();
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
  state.targetIndex = 0;
  state.renderIndex = 0;
  state.currentAlbum = null;
  syncCardPool();
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
  state.speed = Number(el.settingSpeed.value);
  state.visible = Number(el.settingVisible.value);
  updatePoolRadius();
  syncCardPool();
  await api.post("/api/settings", {
    music_directory: el.settingMusicPath.value,
    audio_output: el.audioOutputDevice.value,
    animationSpeed: state.speed,
    visibleCoverCount: state.visible
  });
  el.settingsStatus.textContent = "Settings saved.";
});
for (const tab of el.dockTabs) {
  tab.addEventListener("click", async () => {
    for (const other of el.dockTabs) other.classList.remove("active");
    tab.classList.add("active");
    if (tab.dataset.view === "settings") {
      await openSettings();
    } else if (tab.dataset.view === "songs") {
      await openDrawer();
    } else if (tab.dataset.view === "artists") {
      const artists = await api.artists();
      const first = artists.artists?.[0]?.name;
      if (first) await loadAlbums(`artist:${first}`);
    } else if (tab.dataset.view === "albums") {
      await loadAlbums();
    }
  });
}

window.addEventListener("resize", resize);
resize();
await loadAlbums();
await refreshPlayer();
setInterval(refreshPlayer, 2000);
renderLoop();

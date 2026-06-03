import * as THREE from "/vendor/three.module.js";

const api = {
  albums: (filter = "") => fetchJson(`/api/library/albums?limit=1200${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`),
  tracks: (albumId) => fetchJson(`/api/library/album/${albumId}/tracks`),
  artists: () => fetchJson("/api/library/artists"),
  genres: () => fetchJson("/api/library/genres"),
  years: () => fetchJson("/api/library/years"),
  search: (q) => fetchJson(`/api/search?q=${encodeURIComponent(q)}`),
  state: () => fetchJson("/api/player/state"),
  post: (path, body = {}) => fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((res) => res.json()),
  settings: () => fetchJson("/api/settings")
};

const state = {
  albums: [],
  currentIndex: 0,
  currentAlbum: null,
  currentView: "albums",
  currentFilter: "",
  textures: new Map(),
  speed: 0.18,
  visible: 96,
  playing: false,
  duration: 0,
  elapsed: 0
};

const el = {
  coverflow: document.querySelector("#coverflow"),
  albumTitle: document.querySelector("#album-title"),
  albumSubtitle: document.querySelector("#album-subtitle"),
  filterPanel: document.querySelector("#filter-panel"),
  search: document.querySelector("#search-input"),
  tabs: document.querySelectorAll(".tab"),
  drawer: document.querySelector("#tracks-drawer"),
  drawerTitle: document.querySelector("#drawer-title"),
  drawerSubtitle: document.querySelector("#drawer-subtitle"),
  drawerClose: document.querySelector("#drawer-close"),
  trackList: document.querySelector("#track-list"),
  queueAlbum: document.querySelector("#queue-album-button"),
  playAlbum: document.querySelector("#play-album-button"),
  nowTitle: document.querySelector("#now-title"),
  nowArtist: document.querySelector("#now-artist"),
  play: document.querySelector("#play-button"),
  playIcon: document.querySelector("#play-icon path"),
  previous: document.querySelector("#previous-button"),
  next: document.querySelector("#next-button"),
  seek: document.querySelector("#seek-input"),
  elapsed: document.querySelector("#elapsed"),
  duration: document.querySelector("#duration"),
  volume: document.querySelector("#volume-input"),
  settingsButton: document.querySelector("#settings-button"),
  settingsPanel: document.querySelector("#settings-panel"),
  settingsClose: document.querySelector("#settings-close"),
  settingMusicPath: document.querySelector("#setting-music-path"),
  settingWebAccess: document.querySelector("#setting-web-access"),
  settingSystemStatus: document.querySelector("#setting-system-status"),
  settingMpd: document.querySelector("#setting-mpd"),
  settingDb: document.querySelector("#setting-db"),
  settingKiosk: document.querySelector("#setting-kiosk"),
  settingSpeed: document.querySelector("#setting-speed"),
  settingVisible: document.querySelector("#setting-visible"),
  settingAccent: document.querySelector("#setting-accent"),
  settingWifiStatus: document.querySelector("#setting-wifi-status"),
  wifiNetwork: document.querySelector("#wifi-network"),
  wifiSsid: document.querySelector("#wifi-ssid"),
  wifiPassword: document.querySelector("#wifi-password"),
  wifiScan: document.querySelector("#wifi-scan-button"),
  wifiConnect: document.querySelector("#wifi-connect-button"),
  bluetoothService: document.querySelector("#setting-bluetooth-service"),
  airplayService: document.querySelector("#setting-airplay-service"),
  bluetoothOn: document.querySelector("#bluetooth-on-button"),
  bluetoothOff: document.querySelector("#bluetooth-off-button"),
  airplayOn: document.querySelector("#airplay-on-button"),
  airplayOff: document.querySelector("#airplay-off-button"),
  audioOutputDevice: document.querySelector("#audio-output-device"),
  audioOutputMixer: document.querySelector("#audio-output-mixer"),
  audioRefresh: document.querySelector("#audio-refresh-button"),
  audioApply: document.querySelector("#audio-apply-button"),
  kioskService: document.querySelector("#setting-kiosk-service"),
  kioskOn: document.querySelector("#kiosk-on-button"),
  kioskOff: document.querySelector("#kiosk-off-button"),
  systemRefresh: document.querySelector("#system-refresh-button"),
  systemReboot: document.querySelector("#system-reboot-button"),
  systemShutdown: document.querySelector("#system-shutdown-button"),
  settingsStatus: document.querySelector("#settings-status"),
  rescan: document.querySelector("#rescan-button"),
  rebuild: document.querySelector("#rebuild-button"),
  saveSettings: document.querySelector("#save-settings-button")
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 1, 5000);
camera.position.set(0, 0, 900);
const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
el.coverflow.appendChild(renderer.domElement);
const ambient = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambient);

const loader = new THREE.TextureLoader();
const pool = [];
const active = new Map();
const fallbackTexture = makeFallbackTexture();
let targetIndex = 0;
let renderIndex = 0;
let dragging = false;
let dragStartX = 0;
let dragStartIndex = 0;

function getCard() {
  const card = pool.pop() || createCard();
  card.group.visible = true;
  scene.add(card.group);
  return card;
}

function releaseCard(index, card) {
  scene.remove(card.group);
  card.group.visible = false;
  pool.push(card);
  active.delete(index);
}

function createCard() {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(270, 270);
  const material = new THREE.MeshBasicMaterial({ map: fallbackTexture, transparent: true });
  const mesh = new THREE.Mesh(geo, material);
  group.add(mesh);
  const reflMaterial = new THREE.MeshBasicMaterial({ map: fallbackTexture, transparent: true, opacity: 0.22 });
  const reflection = new THREE.Mesh(geo, reflMaterial);
  reflection.position.y = -284;
  reflection.scale.y = -0.72;
  group.add(reflection);
  return { group, mesh, reflection };
}

function setTexture(card, album) {
  const cached = state.textures.get(album.id);
  if (cached) {
    card.mesh.material.map = cached;
    card.reflection.material.map = cached;
    card.mesh.material.needsUpdate = true;
    card.reflection.material.needsUpdate = true;
    return;
  }
  card.mesh.material.map = fallbackTexture;
  card.reflection.material.map = fallbackTexture;
  loader.load(album.artUrl, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    state.textures.set(album.id, texture);
  });
}

function layoutCard(card, index) {
  const offset = index - renderIndex;
  const abs = Math.abs(offset);
  const side = Math.sign(offset);
  if (abs < 0.001) {
    card.group.position.set(0, 38, 0);
    card.group.rotation.y = 0;
    card.group.scale.setScalar(1.08);
    card.mesh.material.opacity = 1;
    card.reflection.material.opacity = 0.23;
    return;
  }
  const x = side * (190 + Math.min(abs - 1, 12) * 54);
  const z = -130 - Math.min(abs, 18) * 11;
  card.group.position.set(x, 24, z);
  card.group.rotation.y = side * -1.12;
  card.group.scale.setScalar(Math.max(0.72, 0.95 - abs * 0.01));
  card.mesh.material.opacity = Math.max(0.08, 1 - abs * 0.045);
  card.reflection.material.opacity = Math.max(0.02, 0.18 - abs * 0.014);
}

function renderLoop() {
  renderIndex += (targetIndex - renderIndex) * state.speed;
  updateCards();
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}

function updateCards() {
  const radius = Math.max(12, Math.floor(state.visible / 2));
  const center = Math.round(renderIndex);
  const start = Math.max(0, center - radius);
  const end = Math.min(state.albums.length - 1, center + radius);
  for (const [index, card] of active.entries()) {
    if (index < start || index > end) {
      releaseCard(index, card);
    }
  }
  for (let index = start; index <= end; index += 1) {
    if (!active.has(index)) {
      const card = getCard();
      setTexture(card, state.albums[index]);
      active.set(index, card);
    }
    layoutCard(active.get(index), index);
  }
  const nextAlbum = state.albums[Math.round(targetIndex)];
  if (nextAlbum && nextAlbum !== state.currentAlbum) {
    state.currentAlbum = nextAlbum;
    el.albumTitle.textContent = nextAlbum.title || "Unknown Album";
    el.albumSubtitle.textContent = [nextAlbum.albumArtist || nextAlbum.artist, nextAlbum.year].filter(Boolean).join(" - ");
  }
  pruneTextures(center, radius * 3);
}

function pruneTextures(center, retainRadius) {
  const keepIds = new Set();
  const start = Math.max(0, center - retainRadius);
  const end = Math.min(state.albums.length - 1, center + retainRadius);
  for (let index = start; index <= end; index += 1) {
    keepIds.add(state.albums[index].id);
  }
  for (const [id, texture] of state.textures.entries()) {
    if (!keepIds.has(id)) {
      texture.dispose();
      state.textures.delete(id);
    }
  }
}

function goTo(index) {
  targetIndex = clamp(index, 0, Math.max(0, state.albums.length - 1));
  state.currentIndex = Math.round(targetIndex);
}

async function loadAlbums(filter = "") {
  state.currentFilter = filter;
  const data = await api.albums(filter);
  state.albums = data.albums || [];
  targetIndex = 0;
  renderIndex = 0;
  for (const card of active.values()) {
    scene.remove(card.group);
    pool.push(card);
  }
  active.clear();
  state.currentAlbum = null;
  updateCards();
}

async function loadFilterPanel(view) {
  el.filterPanel.innerHTML = "";
  if (view === "albums") {
    const button = filterButton("All Albums", state.albums.length, "");
    el.filterPanel.appendChild(button);
    return;
  }
  const data = view === "artists" ? await api.artists() : view === "genres" ? await api.genres() : await api.years();
  const rows = data.artists || data.genres || data.years || [];
  for (const row of rows) {
    const label = row.name || String(row.year);
    el.filterPanel.appendChild(filterButton(label, row.album_count || row.albumCount || row.track_count, `${view.slice(0, -1)}:${label}`));
  }
}

function filterButton(label, count, filter) {
  const button = document.createElement("button");
  button.className = "filter-item";
  button.innerHTML = `<span></span><span class="filter-count"></span>`;
  button.firstElementChild.textContent = label;
  button.lastElementChild.textContent = count || "";
  button.addEventListener("click", () => loadAlbums(filter));
  return button;
}

async function openDrawer(album = state.currentAlbum) {
  if (!album) return;
  const data = await api.tracks(album.id);
  el.drawerTitle.textContent = album.title;
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
  el.nowTitle.textContent = song.Title || song.file || "Not Playing";
  el.nowArtist.textContent = song.Artist || song.Album || (data.error ? `MPD: ${data.error}` : "MPD ready");
  el.playIcon.setAttribute("d", state.playing ? "M7 5h4v14H7zm6 0h4v14h-4z" : "M8 5v14l11-7z");
  el.seek.max = Math.max(1, Math.floor(state.duration));
  el.seek.value = Math.floor(state.elapsed);
  el.elapsed.textContent = formatTime(state.elapsed);
  el.duration.textContent = formatTime(state.duration);
  if (status.volume !== undefined) {
    el.volume.value = status.volume;
  }
}

async function openSettings() {
  const data = await api.settings();
  el.settingMusicPath.value = data.config.musicDir;
  el.settingMpd.value = data.scan?.error ? `Error: ${data.scan.error}` : "Connected through backend";
  el.settingDb.value = `${data.counts.albums} albums, ${data.counts.tracks} tracks`;
  el.settingKiosk.value = "systemd optional";
  el.settingSpeed.value = data.settings.animationSpeed ?? data.config.ui.animationSpeed;
  el.settingVisible.value = data.settings.visibleCoverCount ?? data.config.ui.visibleCoverCount;
  el.settingAccent.value = data.settings.themeAccent ?? data.config.ui.themeAccent;
  el.settingsStatus.textContent = JSON.stringify({ scan: data.scan, outputs: data.outputs }, null, 2);
  await refreshWifiStatus();
  await refreshServiceStatus();
  await refreshAudioDevices();
  await refreshSystemInfo();
  el.settingsPanel.classList.add("open");
  el.settingsPanel.setAttribute("aria-hidden", "false");
}

async function refreshSystemInfo() {
  const data = await fetchJson("/api/system/info").catch((error) => ({ error: error.message }));
  if (data.error) {
    el.settingWebAccess.value = `Unavailable: ${data.error}`;
    el.settingSystemStatus.value = "";
    return;
  }
  el.settingWebAccess.value = (data.urls || []).join(" | ");
  el.settingSystemStatus.value = `${data.hostname} ${data.uptime || ""}`.trim();
  el.settingsStatus.textContent = JSON.stringify({
    urls: data.urls,
    ip: data.ip,
    disk: data.rootDisk
  }, null, 2);
}

async function systemControl(action) {
  const label = action === "shutdown" ? "shut down" : "reboot";
  if (!window.confirm(`Confirm ${label}?`)) {
    return;
  }
  const result = await api.post("/api/system/control", { action });
  el.settingsStatus.textContent = result.error || `System ${action} command sent.`;
}

async function refreshWifiStatus() {
  const data = await fetchJson("/api/network/wifi/status").catch((error) => ({ error: error.message }));
  if (data.error) {
    el.settingWifiStatus.value = `Unavailable: ${data.error}`;
    return;
  }
  const ip = (data.ip || []).join(", ");
  el.settingWifiStatus.value = `${data.iface} ${data.state} ${data.connection || ""} ${ip}`.trim();
}

async function scanWifi() {
  el.wifiNetwork.innerHTML = `<option>Scanning...</option>`;
  const data = await fetchJson("/api/network/wifi/scan").catch(() => ({ networks: [] }));
  el.wifiNetwork.innerHTML = "";
  for (const network of data.networks || []) {
    const option = document.createElement("option");
    option.value = network.ssid;
    option.textContent = `${network.ssid} (${network.signal}%, ${network.security})`;
    el.wifiNetwork.appendChild(option);
  }
  if (!el.wifiNetwork.children.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No networks found";
    el.wifiNetwork.appendChild(option);
  }
}

async function connectWifi() {
  const ssid = el.wifiSsid.value.trim() || el.wifiNetwork.value;
  if (!ssid) {
    el.settingsStatus.textContent = "Choose a Wi-Fi network or enter an SSID.";
    return;
  }
  const result = await api.post("/api/network/wifi/connect", {
    ssid,
    password: el.wifiPassword.value
  });
  el.settingsStatus.textContent = result.message || "Wi-Fi connection started.";
}

async function refreshServiceStatus() {
  const data = await fetchJson("/api/services").catch((error) => ({ error: error.message, services: {} }));
  if (data.error) {
    el.bluetoothService.value = `Unavailable: ${data.error}`;
    el.airplayService.value = `Unavailable: ${data.error}`;
    return;
  }
  el.bluetoothService.value = formatService(data.services.bluetooth);
  el.airplayService.value = formatService(data.services.airplay);
  el.kioskService.value = formatService(data.services.kiosk);
}

async function controlService(service, action) {
  const result = await api.post("/api/services/control", { service, action });
  if (result.error) {
    el.settingsStatus.textContent = result.error;
    return;
  }
  el.settingsStatus.textContent = `${service} ${action} complete.`;
  await refreshServiceStatus();
}

function formatService(rows = []) {
  return rows.map((row) => `${row.name}: ${row.active}/${row.enabled}`).join(" | ") || "unknown";
}

async function refreshAudioDevices() {
  const data = await fetchJson("/api/audio/devices").catch((error) => ({ error: error.message, devices: [] }));
  el.audioOutputDevice.innerHTML = "";
  if (data.error) {
    const option = document.createElement("option");
    option.textContent = `Unavailable: ${data.error}`;
    option.value = "";
    el.audioOutputDevice.appendChild(option);
    return;
  }
  const defaults = [{ alsa: "default", label: "default - ALSA default output" }];
  for (const device of [...defaults, ...(data.devices || [])]) {
    const option = document.createElement("option");
    option.value = device.alsa;
    option.textContent = device.label;
    if (data.current?.device === device.alsa) option.selected = true;
    el.audioOutputDevice.appendChild(option);
  }
  if (data.current?.mixer) {
    el.audioOutputMixer.value = data.current.mixer;
  }
}

async function applyAudioOutput() {
  const device = el.audioOutputDevice.value;
  if (!device) {
    el.settingsStatus.textContent = "Choose an ALSA output device first.";
    return;
  }
  const result = await api.post("/api/audio/output", {
    device,
    name: "CoverFlow ALSA",
    mixer: el.audioOutputMixer.value
  });
  el.settingsStatus.textContent = result.error || `Audio output applied: ${device}. MPD restarted.`;
  await refreshAudioDevices();
}

async function bootstrapSettings() {
  const data = await api.settings().catch(() => null);
  if (!data) return;
  const settings = data.settings || {};
  state.speed = Number(settings.animationSpeed || data.config.ui.animationSpeed || state.speed);
  state.visible = Number(settings.visibleCoverCount || data.config.ui.visibleCoverCount || state.visible);
  document.documentElement.style.setProperty("--accent", settings.themeAccent || data.config.ui.themeAccent || "#8ea0ff");
}

function resize() {
  const rect = el.coverflow.getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

function makeFallbackTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, "#151b27");
  grad.addColorStop(1, "#35415f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "#080b11";
  ctx.beginPath();
  ctx.arc(256, 256, 116, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#8ea0ff";
  ctx.beginPath();
  ctx.arc(256, 256, 38, 0, Math.PI * 2);
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

window.addEventListener("resize", resize);
el.coverflow.addEventListener("pointerdown", (event) => {
  dragging = true;
  dragStartX = event.clientX;
  dragStartIndex = targetIndex;
  el.coverflow.setPointerCapture(event.pointerId);
});
el.coverflow.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  goTo(dragStartIndex - (event.clientX - dragStartX) / 92);
});
el.coverflow.addEventListener("pointerup", () => {
  dragging = false;
  goTo(Math.round(targetIndex));
});
el.coverflow.addEventListener("wheel", (event) => {
  event.preventDefault();
  goTo(Math.round(targetIndex + Math.sign(event.deltaY || event.deltaX)));
}, { passive: false });
el.coverflow.addEventListener("dblclick", () => openDrawer());
window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") goTo(Math.round(targetIndex) - 1);
  if (event.key === "ArrowRight") goTo(Math.round(targetIndex) + 1);
  if (event.key === "Enter") openDrawer();
});

for (const tab of el.tabs) {
  tab.addEventListener("click", async () => {
    for (const other of el.tabs) other.classList.remove("active");
    tab.classList.add("active");
    state.currentView = tab.dataset.view;
    await loadFilterPanel(state.currentView);
  });
}

let searchTimer = 0;
el.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = el.search.value.trim();
    if (!q) {
      await loadAlbums(state.currentFilter);
      return;
    }
    const data = await api.search(q);
    state.albums = data.albums || [];
    goTo(0);
  }, 220);
});

el.drawerClose.addEventListener("click", () => el.drawer.classList.remove("open"));
el.queueAlbum.addEventListener("click", () => state.currentAlbum && api.post("/api/player/queue", { albumId: state.currentAlbum.id, clear: false }));
el.playAlbum.addEventListener("click", () => state.currentAlbum && api.post("/api/player/queue", { albumId: state.currentAlbum.id, clear: true, play: true }));
el.play.addEventListener("click", () => api.post(state.playing ? "/api/player/pause" : "/api/player/play"));
el.previous.addEventListener("click", () => api.post("/api/player/previous"));
el.next.addEventListener("click", () => api.post("/api/player/next"));
el.seek.addEventListener("change", () => api.post("/api/player/seek", { seconds: Number(el.seek.value) }));
el.volume.addEventListener("change", () => api.post("/api/player/volume", { volume: Number(el.volume.value) }));
el.settingsButton.addEventListener("click", openSettings);
el.settingsClose.addEventListener("click", () => el.settingsPanel.classList.remove("open"));
el.rescan.addEventListener("click", async () => {
  await api.post("/api/library/rescan");
  el.settingsStatus.textContent = "Incremental rescan started.";
});
el.rebuild.addEventListener("click", async () => {
  await api.post("/api/library/rebuild-cache");
  el.settingsStatus.textContent = "Full rebuild started.";
});
el.wifiScan.addEventListener("click", scanWifi);
el.wifiConnect.addEventListener("click", connectWifi);
el.bluetoothOn.addEventListener("click", () => controlService("bluetooth", "enable-now"));
el.bluetoothOff.addEventListener("click", () => controlService("bluetooth", "disable-now"));
el.airplayOn.addEventListener("click", () => controlService("airplay", "enable-now"));
el.airplayOff.addEventListener("click", () => controlService("airplay", "disable-now"));
el.kioskOn.addEventListener("click", () => controlService("kiosk", "enable-now"));
el.kioskOff.addEventListener("click", () => controlService("kiosk", "disable-now"));
el.audioRefresh.addEventListener("click", refreshAudioDevices);
el.audioApply.addEventListener("click", applyAudioOutput);
el.systemRefresh.addEventListener("click", refreshSystemInfo);
el.systemReboot.addEventListener("click", () => systemControl("reboot"));
el.systemShutdown.addEventListener("click", () => systemControl("shutdown"));
el.saveSettings.addEventListener("click", async () => {
  state.speed = Number(el.settingSpeed.value);
  state.visible = Number(el.settingVisible.value);
  document.documentElement.style.setProperty("--accent", el.settingAccent.value);
  await api.post("/api/settings", {
    animationSpeed: state.speed,
    visibleCoverCount: state.visible,
    themeAccent: el.settingAccent.value
  });
  el.settingsStatus.textContent = "Settings saved.";
});

resize();
await bootstrapSettings();
await loadAlbums();
await loadFilterPanel("albums");
setInterval(refreshPlayer, 1500);
refreshPlayer();
renderLoop();

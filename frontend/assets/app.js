const state = {
  albums: [],
  artists: [],
  tracks: [],
  currentIndex: 0,
  targetIndex: 0,
  renderIndex: 0,
  activeView: "albums",
  selectedAlbum: null,
  selectedArtist: null,
  status: null,
  dragging: false,
  dragStartX: 0,
  dragStartIndex: 0,
  speed: 0.18,
  visible: 17,
  filter: "",
  raf: 0,
  pollTimer: 0
};

const el = {
  tabs: document.querySelectorAll(".tab"),
  filterPanel: document.getElementById("filter-panel"),
  search: document.getElementById("search-input"),
  coverStage: document.getElementById("cover-stage"),
  nowPanel: document.getElementById("now-panel"),
  coverflow: document.getElementById("coverflow"),
  albumTitle: document.getElementById("album-title"),
  albumSubtitle: document.getElementById("album-subtitle"),
  drawer: document.getElementById("tracks-drawer"),
  drawerTitle: document.getElementById("drawer-title"),
  drawerSubtitle: document.getElementById("drawer-subtitle"),
  drawerClose: document.getElementById("drawer-close"),
  trackList: document.getElementById("track-list"),
  playAlbum: document.getElementById("play-album-button"),
  rescan: document.getElementById("rescan-button"),
  play: document.getElementById("play-button"),
  playIcon: document.querySelector("#play-icon path"),
  previous: document.getElementById("previous-button"),
  stop: document.getElementById("stop-button"),
  next: document.getElementById("next-button"),
  seek: document.getElementById("seek-input"),
  elapsed: document.getElementById("elapsed"),
  duration: document.getElementById("duration"),
  volume: document.getElementById("volume-input"),
  miniArt: document.getElementById("mini-art"),
  nowTitle: document.getElementById("now-title"),
  nowArtist: document.getElementById("now-artist"),
  nowArt: document.getElementById("now-art"),
  nowTitleLarge: document.getElementById("now-title-large"),
  nowArtistLarge: document.getElementById("now-artist-large"),
  nowAlbumLarge: document.getElementById("now-album-large"),
  settingsButton: document.getElementById("settings-button"),
  settingsPanel: document.getElementById("settings-panel"),
  settingsClose: document.getElementById("settings-close"),
  settingsForm: document.getElementById("settings-form"),
  musicPath: document.getElementById("setting-music-path"),
  audioOutput: document.getElementById("setting-audio-output"),
  settingSpeed: document.getElementById("setting-speed"),
  settingVisible: document.getElementById("setting-visible"),
  settingsStatus: document.getElementById("settings-status")
};

function api(path, options = {}) {
  const request = {
    headers: { "Content-Type": "application/json" },
    ...options
  };
  if (request.body && typeof request.body !== "string") {
    request.body = JSON.stringify(request.body);
  }
  return fetch(path, request).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  });
}

function post(path, body = {}) {
  return api(path, { method: "POST", body });
}

function albumId(album) {
  return album.album;
}

function artUrl(album, file) {
  if (album) return `/api/art?album=${encodeURIComponent(album)}`;
  if (file) return `/api/art?file=${encodeURIComponent(file)}`;
  return "";
}

function createCover(album, index) {
  const button = document.createElement("button");
  button.className = "cover-card";
  button.type = "button";
  button.dataset.index = index;
  button.dataset.album = album.album;
  button.innerHTML = `
    <div class="cover-face"><img alt=""></div>
    <div class="cover-reflection"><img alt=""></div>
  `;
  const src = album.art_url || artUrl(album.album);
  for (const img of button.querySelectorAll("img")) {
    img.src = src;
    img.addEventListener("error", () => {
      img.removeAttribute("src");
      img.style.background = "linear-gradient(135deg, #151b27, #35415f)";
    }, { once: true });
  }
  button.addEventListener("click", () => {
    const distance = Math.abs(index - Math.round(state.targetIndex));
    if (distance > 0) {
      goTo(index);
      return;
    }
    openAlbumDrawer(album);
  });
  return button;
}

function renderCoverflow() {
  el.coverflow.innerHTML = "";
  state.albums.forEach((album, index) => {
    el.coverflow.appendChild(createCover(album, index));
  });
  updateCoverflow(true);
}

function updateCoverflow(forceCaption = false) {
  if (!state.albums.length) {
    el.albumTitle.textContent = "Library empty";
    el.albumSubtitle.textContent = "Add music to /mnt/music and rescan";
    return;
  }

  state.renderIndex += (state.targetIndex - state.renderIndex) * state.speed;
  if (Math.abs(state.targetIndex - state.renderIndex) < 0.001) {
    state.renderIndex = state.targetIndex;
  }

  const cards = el.coverflow.querySelectorAll(".cover-card");
  const stageWidth = Math.max(320, el.coverflow.clientWidth);
  const sideGap = Math.max(56, Math.min(98, stageWidth / 12));
  const center = Math.round(state.targetIndex);
  const radius = Math.max(3, Math.floor(state.visible / 2));

  cards.forEach((card, index) => {
    const offset = index - state.renderIndex;
    const abs = Math.abs(offset);
    const side = Math.sign(offset);
    const visible = abs <= radius;
    if (!visible) {
      card.style.opacity = "0";
      card.style.pointerEvents = "none";
      return;
    }

    const folded = Math.max(0, abs - 1);
    const x = side * (118 + folded * sideGap);
    const z = -Math.min(520, abs * 72);
    const rotate = side * -64;
    const scale = abs < 0.05 ? 1.08 : Math.max(0.68, 0.95 - abs * 0.035);
    const opacity = Math.max(0.18, 1 - abs * 0.07);
    const zIndex = String(1000 - Math.round(abs * 20));

    card.style.opacity = String(opacity);
    card.style.zIndex = zIndex;
    card.style.pointerEvents = "auto";
    card.style.transform = `translate(-50%, -50%) translate3d(${x}px, 0, ${z}px) rotateY(${rotate}deg) scale(${scale})`;
  });

  if (forceCaption || center !== state.currentIndex) {
    state.currentIndex = center;
    const album = state.albums[center];
    state.selectedAlbum = album || null;
    if (album) {
      el.albumTitle.textContent = album.album;
      el.albumSubtitle.textContent = "Double-click or tap the center cover for tracks";
    }
  }
}

function animationLoop() {
  updateCoverflow();
  state.raf = requestAnimationFrame(animationLoop);
}

function goTo(index) {
  state.targetIndex = clamp(index, 0, Math.max(0, state.albums.length - 1));
}

function filteredAlbums() {
  const needle = state.filter.toLowerCase();
  if (!needle) return state.albums;
  return state.albums.filter(album => album.album.toLowerCase().includes(needle));
}

async function loadAlbums() {
  const data = await api("/api/albums");
  state.albums = data.albums || [];
  state.targetIndex = 0;
  state.renderIndex = 0;
  renderCoverflow();
  renderFilterPanel("albums");
}

async function loadArtists() {
  const data = await api("/api/artists");
  state.artists = data.artists || [];
  renderFilterPanel("artists");
}

async function loadTracks(query = "") {
  const data = await api(`/api/tracks${query}`);
  state.tracks = data.tracks || [];
  openTrackDrawer(state.tracks, query ? "Tracks" : "All Tracks", query ? "" : "Full library");
}

function renderFilterPanel(view) {
  el.filterPanel.innerHTML = "";
  if (view === "albums") {
    state.albums.forEach((album, index) => {
      el.filterPanel.appendChild(filterButton(album.album, "", () => goTo(index)));
    });
    return;
  }
  if (view === "artists") {
    state.artists.forEach(artist => {
      el.filterPanel.appendChild(filterButton(artist, "Artist", () => selectArtist(artist)));
    });
  }
}

function filterButton(label, count, onClick) {
  const button = document.createElement("button");
  button.className = "filter-item";
  button.type = "button";
  button.innerHTML = `<span></span><span class="filter-count"></span>`;
  button.firstElementChild.textContent = label;
  button.lastElementChild.textContent = count || "";
  button.addEventListener("click", onClick);
  return button;
}

async function selectArtist(artist) {
  state.selectedArtist = artist;
  const data = await api(`/api/tracks?artist=${encodeURIComponent(artist)}`);
  state.tracks = data.tracks || [];
  const albumNames = new Set(state.tracks.map(track => track.album));
  const visibleAlbums = state.albums.filter(album => albumNames.has(album.album));
  if (visibleAlbums.length) {
    state.albums = visibleAlbums;
    state.targetIndex = 0;
    state.renderIndex = 0;
    renderCoverflow();
  }
  openTrackDrawer(state.tracks, artist, "Artist");
}

async function openAlbumDrawer(album = state.selectedAlbum) {
  if (!album) return;
  const data = await api(`/api/tracks?album=${encodeURIComponent(album.album)}`);
  state.tracks = data.tracks || [];
  openTrackDrawer(state.tracks, album.album, "Album");
}

function openTrackDrawer(tracks, title, subtitle) {
  el.drawerTitle.textContent = title || "Tracks";
  el.drawerSubtitle.textContent = subtitle || "";
  el.trackList.innerHTML = "";
  tracks.forEach(track => {
    const row = document.createElement("div");
    row.className = "track-row";
    row.innerHTML = `<div class="track-number"></div><button type="button"></button><div class="track-duration"></div>`;
    row.children[0].textContent = track.track || "";
    row.children[1].textContent = track.title || "Untitled";
    row.children[2].textContent = formatTime(track.duration);
    row.children[1].addEventListener("click", () => playTrack(track.file));
    el.trackList.appendChild(row);
  });
  el.drawer.classList.add("open");
  el.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  el.drawer.classList.remove("open");
  el.drawer.setAttribute("aria-hidden", "true");
}

function showNowPanel(show) {
  el.coverStage.style.display = show ? "none" : "block";
  el.nowPanel.classList.toggle("open", show);
  el.nowPanel.setAttribute("aria-hidden", show ? "false" : "true");
}

async function playTrack(file) {
  await post("/api/play-track", { file });
  await refreshStatus();
}

async function playCurrentAlbum() {
  if (!state.selectedAlbum) return;
  await post("/api/play-album", { album: state.selectedAlbum.album });
  await refreshStatus();
}

async function refreshStatus() {
  const status = await api("/api/status");
  state.status = status;
  const song = status.song || {};
  const title = song.title || "Not Playing";
  const artist = song.artist || "MPD ready";
  const album = song.album || "No album selected";
  const image = artUrl(song.album, song.file);
  const playing = status.state === "play";

  el.nowTitle.textContent = title;
  el.nowArtist.textContent = artist;
  el.nowTitleLarge.textContent = title;
  el.nowArtistLarge.textContent = artist;
  el.nowAlbumLarge.textContent = album;
  el.playIcon.setAttribute("d", playing ? "M7 5h4v14H7zm6 0h4v14h-4z" : "M8 5v14l11-7z");

  if (image) {
    el.miniArt.src = image;
    el.nowArt.src = image;
  }

  const duration = Math.max(0, Math.floor(status.duration || 0));
  const elapsed = Math.max(0, Math.floor(status.elapsed || 0));
  el.seek.max = duration || 100;
  if (document.activeElement !== el.seek) {
    el.seek.value = Math.min(elapsed, duration || 100);
  }
  el.elapsed.textContent = formatTime(elapsed);
  el.duration.textContent = formatTime(duration);
  if (Number.isFinite(status.volume)) {
    el.volume.value = status.volume;
  }
}

async function openSettings() {
  const data = await api("/api/settings").catch(() => ({ settings: {} }));
  el.musicPath.value = data.settings?.music_directory || "/mnt/music";
  el.audioOutput.value = data.settings?.audio_output || "auto";
  el.settingSpeed.value = state.speed;
  el.settingVisible.value = state.visible;
  el.settingsStatus.textContent = "";
  el.settingsPanel.classList.add("open");
  el.settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  el.settingsPanel.classList.remove("open");
  el.settingsPanel.setAttribute("aria-hidden", "true");
}

function switchView(view) {
  state.activeView = view;
  el.tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.view === view));
  closeDrawer();
  showNowPanel(view === "now");
  if (view === "albums") {
    loadAlbums().catch(showError);
  } else if (view === "artists") {
    loadArtists().catch(showError);
  } else if (view === "tracks") {
    loadTracks("").catch(showError);
  }
}

function formatTime(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showError(error) {
  console.error(error);
  el.albumTitle.textContent = "EchoFlow error";
  el.albumSubtitle.textContent = error.message || String(error);
}

el.coverflow.addEventListener("pointerdown", event => {
  state.dragging = true;
  state.dragStartX = event.clientX;
  state.dragStartIndex = state.targetIndex;
  el.coverflow.classList.add("dragging");
  el.coverflow.setPointerCapture(event.pointerId);
});

el.coverflow.addEventListener("pointermove", event => {
  if (!state.dragging) return;
  goTo(state.dragStartIndex - (event.clientX - state.dragStartX) / 92);
});

el.coverflow.addEventListener("pointerup", () => {
  state.dragging = false;
  el.coverflow.classList.remove("dragging");
  goTo(Math.round(state.targetIndex));
});

el.coverflow.addEventListener("wheel", event => {
  event.preventDefault();
  const delta = event.deltaY || event.deltaX;
  goTo(Math.round(state.targetIndex + Math.sign(delta)));
}, { passive: false });

el.coverflow.addEventListener("dblclick", () => openAlbumDrawer());

window.addEventListener("keydown", event => {
  if (event.key === "ArrowLeft") goTo(Math.round(state.targetIndex) - 1);
  if (event.key === "ArrowRight") goTo(Math.round(state.targetIndex) + 1);
  if (event.key === "Enter") openAlbumDrawer();
  if (event.key === "Escape") {
    closeDrawer();
    closeSettings();
  }
});

el.tabs.forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
el.search.addEventListener("input", () => {
  state.filter = el.search.value.trim();
  const all = filteredAlbums();
  if (state.activeView === "albums" && state.filter) {
    const needle = state.filter.toLowerCase();
    const index = state.albums.findIndex(album => album.album.toLowerCase().includes(needle));
    if (index >= 0) goTo(index);
  }
  el.filterPanel.querySelectorAll(".filter-item").forEach(button => {
    button.style.display = button.textContent.toLowerCase().includes(state.filter.toLowerCase()) ? "" : "none";
  });
});
el.drawerClose.addEventListener("click", closeDrawer);
el.playAlbum.addEventListener("click", playCurrentAlbum);
el.rescan.addEventListener("click", () => post("/api/rescan").then(loadAlbums).catch(showError));
el.play.addEventListener("click", () => {
  const path = state.status?.state === "play" ? "/api/pause" : "/api/resume";
  post(path).then(refreshStatus).catch(showError);
});
el.previous.addEventListener("click", () => post("/api/previous").then(refreshStatus).catch(showError));
el.stop.addEventListener("click", () => post("/api/stop").then(refreshStatus).catch(showError));
el.next.addEventListener("click", () => post("/api/next").then(refreshStatus).catch(showError));
el.seek.addEventListener("change", () => post("/api/seek", { seconds: el.seek.value }).then(refreshStatus).catch(showError));
el.volume.addEventListener("change", () => post("/api/volume", { volume: el.volume.value }).then(refreshStatus).catch(showError));
el.settingsButton.addEventListener("click", openSettings);
el.settingsClose.addEventListener("click", closeSettings);
el.settingsForm.addEventListener("submit", event => {
  event.preventDefault();
  state.speed = Number(el.settingSpeed.value);
  state.visible = Number(el.settingVisible.value);
  post("/api/settings", {
    music_directory: el.musicPath.value,
    audio_output: el.audioOutput.value
  }).then(data => {
    el.settingsStatus.textContent = data.message || "Settings saved.";
  }).catch(error => {
    el.settingsStatus.textContent = error.message || String(error);
  });
});

loadAlbums().then(() => refreshStatus()).then(() => {
  cancelAnimationFrame(state.raf);
  animationLoop();
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(refreshStatus, 2500);
}).catch(showError);

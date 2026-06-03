const state = {
  albums: [],
  artists: [],
  tracks: [],
  selectedAlbum: null,
  selectedArtist: null,
  status: null,
  filter: "",
  pollTimer: null
};

const el = {
  tabs: document.querySelectorAll(".tab"),
  views: document.querySelectorAll(".view"),
  search: document.getElementById("search"),
  echoflow: document.getElementById("echoflow"),
  albumList: document.getElementById("albumList"),
  artistList: document.getElementById("artistList"),
  trackList: document.getElementById("trackList"),
  trackHeader: document.getElementById("trackHeader"),
  rescan: document.getElementById("rescan"),
  playPause: document.getElementById("playPause"),
  previous: document.getElementById("previous"),
  next: document.getElementById("next"),
  stop: document.getElementById("stop"),
  seek: document.getElementById("seek"),
  elapsed: document.getElementById("elapsed"),
  duration: document.getElementById("duration"),
  volume: document.getElementById("volume"),
  miniArt: document.getElementById("miniArt"),
  miniTitle: document.getElementById("miniTitle"),
  miniArtist: document.getElementById("miniArtist"),
  nowArt: document.getElementById("nowArt"),
  nowTitle: document.getElementById("nowTitle"),
  nowArtist: document.getElementById("nowArtist"),
  nowAlbum: document.getElementById("nowAlbum"),
  settingsForm: document.getElementById("settingsForm"),
  musicDirectory: document.getElementById("musicDirectory"),
  audioOutput: document.getElementById("audioOutput"),
  settingsMessage: document.getElementById("settingsMessage")
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
    if (!response.ok) {
      throw new Error(data.error || response.statusText);
    }
    return data;
  });
}

function post(path, body = {}) {
  return api(path, { method: "POST", body });
}

function switchView(name) {
  el.tabs.forEach(tab => tab.classList.toggle("active", tab.dataset.view === name));
  el.views.forEach(view => view.classList.toggle("active", view.id === `view-${name}`));
  if (name === "tracks" && state.tracks.length === 0) {
    loadTracks();
  }
}

function textMatch(...values) {
  const needle = state.filter.toLowerCase();
  if (!needle) return true;
  return values.join(" ").toLowerCase().includes(needle);
}

function artUrl(album, file) {
  if (album) return `/api/art?album=${encodeURIComponent(album)}`;
  if (file) return `/api/art?file=${encodeURIComponent(file)}`;
  return "";
}

function attachArtFallback(img) {
  img.addEventListener("error", () => {
    img.removeAttribute("src");
    img.classList.add("placeholder-art");
  }, { once: true });
}

function renderAlbums() {
  const albums = state.albums.filter(item => textMatch(item.album));
  el.echoflow.innerHTML = "";
  el.albumList.innerHTML = "";

  albums.forEach((item, index) => {
    const cover = document.createElement("button");
    cover.className = `flow-card ${index === 0 ? "active" : ""}`;
    cover.innerHTML = `<img alt=""><p>${escapeHtml(item.album)}</p>`;
    const img = cover.querySelector("img");
    img.src = item.art_url;
    attachArtFallback(img);
    cover.addEventListener("click", () => selectAlbum(item.album, true));
    el.echoflow.appendChild(cover);

    const row = document.createElement("button");
    row.className = "list-item";
    row.innerHTML = `<img alt=""><div><strong>${escapeHtml(item.album)}</strong><span>Album</span></div>`;
    const rowImg = row.querySelector("img");
    rowImg.src = item.art_url;
    attachArtFallback(rowImg);
    row.addEventListener("click", () => selectAlbum(item.album, true));
    el.albumList.appendChild(row);
  });
}

function renderArtists() {
  const artists = state.artists.filter(name => textMatch(name));
  el.artistList.innerHTML = "";
  artists.forEach(name => {
    const row = document.createElement("button");
    row.className = "list-item";
    row.innerHTML = `<div class="list-thumb"></div><div><strong>${escapeHtml(name)}</strong><span>Artist</span></div>`;
    row.addEventListener("click", () => selectArtist(name));
    el.artistList.appendChild(row);
  });
}

function renderTracks() {
  const tracks = state.tracks.filter(track => textMatch(track.title, track.artist, track.album));
  el.trackList.innerHTML = "";
  tracks.forEach(track => {
    const row = document.createElement("div");
    row.className = "track-row";
    row.innerHTML = `
      <span>${escapeHtml(track.track || "")}</span>
      <div><strong>${escapeHtml(track.title)}</strong><span>${escapeHtml(track.artist)} - ${escapeHtml(track.album)}</span></div>
      <button>Play</button>
    `;
    row.querySelector("button").addEventListener("click", () => playTrack(track.file));
    el.trackList.appendChild(row);
  });
}

function loadTracks() {
  el.trackHeader.textContent = "Tracks";
  return api("/api/tracks").then(data => {
    state.tracks = data.tracks || [];
    renderTracks();
  }).catch(showError);
}

function renderStatus(status) {
  state.status = status;
  const song = status.song || {};
  const title = song.title || "Nothing playing";
  const artist = song.artist || "Idle";
  const album = song.album || "No album";
  const image = artUrl(song.album, song.file);

  el.miniTitle.textContent = title;
  el.miniArtist.textContent = artist;
  el.nowTitle.textContent = title;
  el.nowArtist.textContent = artist;
  el.nowAlbum.textContent = album;
  el.playPause.textContent = status.state === "play" ? "Pause" : "Play";
  el.volume.value = Number.isFinite(status.volume) ? status.volume : 0;

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
}

function selectAlbum(album, play) {
  state.selectedAlbum = album;
  state.selectedArtist = null;
  el.trackHeader.textContent = album;
  api(`/api/tracks?album=${encodeURIComponent(album)}`).then(data => {
    state.tracks = data.tracks || [];
    renderTracks();
    switchView("tracks");
    if (play) {
      return post("/api/play-album", { album }).then(renderStatus);
    }
    return null;
  }).catch(showError);
}

function selectArtist(artist) {
  state.selectedArtist = artist;
  state.selectedAlbum = null;
  el.trackHeader.textContent = artist;
  api(`/api/tracks?artist=${encodeURIComponent(artist)}`).then(data => {
    state.tracks = data.tracks || [];
    renderTracks();
    switchView("tracks");
  }).catch(showError);
}

function playTrack(file) {
  post("/api/play-track", { file }).then(renderStatus).catch(showError);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function showError(error) {
  console.error(error);
  el.settingsMessage.textContent = error.message || String(error);
}

function loadLibrary() {
  return Promise.all([
    api("/api/albums"),
    api("/api/artists"),
    api("/api/status"),
    api("/api/settings")
  ]).then(([albums, artists, status, settings]) => {
    state.albums = albums.albums || [];
    state.artists = artists.artists || [];
    renderAlbums();
    renderArtists();
    renderStatus(status);
    if (settings.settings) {
      el.musicDirectory.value = settings.settings.music_directory || "/mnt/music";
      el.audioOutput.value = settings.settings.audio_output || "auto";
    }
  }).catch(showError);
}

function pollStatus() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    api("/api/status").then(renderStatus).catch(error => console.warn(error));
  }, 2500);
}

el.tabs.forEach(tab => tab.addEventListener("click", () => switchView(tab.dataset.view)));
el.search.addEventListener("input", event => {
  state.filter = event.target.value;
  renderAlbums();
  renderArtists();
  renderTracks();
});
el.rescan.addEventListener("click", () => {
  post("/api/rescan").then(renderStatus).then(loadLibrary).catch(showError);
});
el.playPause.addEventListener("click", () => {
  const path = state.status && state.status.state === "play" ? "/api/pause" : "/api/resume";
  post(path).then(renderStatus).catch(showError);
});
el.previous.addEventListener("click", () => post("/api/previous").then(renderStatus).catch(showError));
el.next.addEventListener("click", () => post("/api/next").then(renderStatus).catch(showError));
el.stop.addEventListener("click", () => post("/api/stop").then(renderStatus).catch(showError));
el.volume.addEventListener("change", () => post("/api/volume", { volume: el.volume.value }).then(renderStatus).catch(showError));
el.seek.addEventListener("change", () => post("/api/seek", { seconds: el.seek.value }).then(renderStatus).catch(showError));
el.settingsForm.addEventListener("submit", event => {
  event.preventDefault();
  post("/api/settings", {
    music_directory: el.musicDirectory.value,
    audio_output: el.audioOutput.value
  }).then(data => {
    el.settingsMessage.textContent = data.message || "Saved";
  }).catch(showError);
});

attachArtFallback(el.miniArt);
attachArtFallback(el.nowArt);
loadLibrary().then(pollStatus);

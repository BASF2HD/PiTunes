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

const PAGE_SIZE = 200;
const SEARCH_DELAY_MS = 180;

const BROWSE_MODE = Object.freeze({
  ALBUM: "album",
  SONGS: "songs",
  ARTIST: "artist",
  PLAYLIST: "playlist",
  MORE: "more",
  SETTINGS: "settings",
  SEARCH: "search",
  YEAR: "year",
  GENRE: "genre",
  RATING: "rating",
  STARRED: "starred",
  RADIO: "radio"
});

const HEART_ICON_OUTLINE_PATH =
  "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z";
const HEART_ICON_FILLED_PATH =
  "m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z";

const state = {
  mode: BROWSE_MODE.ALBUM,
  entries: [],
  total: 0,
  browseIndex: 0,
  currentEntry: null,
  textures: [],
  texturePromises: new Map(),
  loadingMore: false,
  drawerOpen: false,
  drawerLoading: false,
  drawerTitle: "Songs",
  drawerSubtitle: "",
  drawerTracks: [],
  activeSongMenuIndex: null,
  infoTrackIndex: null,
  searchOpen: false,
  searchQuery: "",
  searchLoading: false,
  activeDropdown: null,
  activeMorePanel: "",
  activeInfoMenuMode: "closed",
  selectedArtist: "",
  selectedGenre: "",
  selectedYear: "",
  songsDisplayMode: "album",
  playlistDisplayMode: "album",
  albumInfoFontScale: Number(window.localStorage.getItem("echoflow-album-info-font-scale") || 1),
  artists: [],
  genres: [],
  years: [],
  settingsLoaded: false,
  settingsStatus: "",
  settings: {
    musicDirectory: "/mnt/music",
    audioOutput: "auto",
    alsaDevice: "default",
    mixer: "software",
    visible: "0",
    albumArt: "folder-first"
  },
  audioDevices: [],
  services: {},
  playing: false,
  volume: 60,
  duration: 0,
  elapsed: 0,
  seekDragging: false,
  currentSong: null,
  suppressCoverTapUntil: 0
};

const el = {
  app: document.getElementById("app"),
  container: document.getElementById("coverflow-container"),
  playbackStrip: document.getElementById("playback-strip"),
  infoPanel: document.getElementById("info-panel"),
  trackTitle: document.getElementById("track-title"),
  trackArtist: document.getElementById("track-artist"),
  btnInfoMenu: document.getElementById("btn-info-menu"),
  infoContextMenu: document.getElementById("info-context-menu"),
  btnDrawer: document.getElementById("btn-drawer"),
  btnPrev: document.getElementById("btn-prev"),
  btnPlay: document.getElementById("btn-play"),
  btnBrowsePrev: document.getElementById("btn-browse-prev"),
  browseStrip: document.getElementById("browse-strip"),
  btnNext: document.getElementById("btn-next"),
  btnBrowseNext: document.getElementById("btn-browse-next"),
  btnDrawerClose: document.getElementById("btn-drawer-close"),
  songsDrawer: document.getElementById("songs-drawer"),
  songsDrawerBackdrop: document.getElementById("songs-drawer-backdrop"),
  songsDrawerCount: document.getElementById("songs-drawer-count"),
  songsDrawerEyebrow: document.getElementById("songs-drawer-eyebrow"),
  songsDrawerTitle: document.getElementById("songs-drawer-title"),
  songsDrawerSubtitle: document.getElementById("songs-drawer-subtitle"),
  btnDrawerFavourite: document.getElementById("btn-drawer-favourite"),
  drawerFavouriteIconPath: document.getElementById("drawer-favourite-icon-path"),
  songsTableBody: document.getElementById("songs-table-body"),
  songInfoModal: document.getElementById("song-info-modal"),
  songInfoCard: document.querySelector("#song-info-modal .song-info-card"),
  songInfoContent: document.getElementById("song-info-content"),
  songInfoEyebrow: document.getElementById("song-info-eyebrow"),
  songInfoTitle: document.getElementById("song-info-title"),
  btnSongInfoClose: document.getElementById("btn-song-info-close"),
  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  seekTime: document.getElementById("seek-time"),
  seekTrack: document.getElementById("seek-track"),
  seekFill: document.getElementById("seek-fill"),
  seekHandle: document.getElementById("seek-handle"),
  btnSearch: document.getElementById("btn-search"),
  btnPlayerFullscreen: document.getElementById("btn-player-fullscreen"),
  searchPanel: document.getElementById("search-panel"),
  searchInput: document.getElementById("search-input"),
  btnSearchClear: document.getElementById("btn-search-clear"),
  btnSearchClose: document.getElementById("btn-search-close"),
  searchMeta: document.getElementById("search-meta"),
  searchResults: document.getElementById("search-results"),
  btnVolume: document.getElementById("btn-volume"),
  volumePopover: document.getElementById("volume-popover"),
  volumeIconPath: document.getElementById("volume-icon-path"),
  volumeSlider: document.getElementById("volume-slider"),
  controls: document.getElementById("controls"),
  controlsMain: document.getElementById("controls-main"),
  transport: document.getElementById("transport"),
  browseBarShell: document.getElementById("browse-bar-shell"),
  browseBar: document.getElementById("browse-bar"),
  statusOverlay: document.getElementById("status-overlay"),
  statusText: document.getElementById("status-text"),
  browseAlbum: document.getElementById("browse-album"),
  browseSongs: document.getElementById("browse-songs"),
  songsDropdown: document.getElementById("songs-dropdown"),
  browseArtist: document.getElementById("browse-artist"),
  artistDropdown: document.getElementById("artist-dropdown"),
  browsePlaylist: document.getElementById("browse-playlist"),
  playlistDropdown: document.getElementById("playlist-dropdown"),
  browseMore: document.getElementById("browse-more"),
  moreDropdown: document.getElementById("more-dropdown"),
  browseSettings: document.getElementById("browse-settings"),
  settingsDropdown: document.getElementById("settings-dropdown")
};

const browseButtons = [
  el.browseAlbum,
  el.browseSongs,
  el.browseArtist,
  el.browsePlaylist,
  el.browseMore,
  el.browseSettings
].filter(Boolean);

initScene(el.container);
onSnap(handleSnap);
portalBrowseDropdowns();
bindEvents();
renderBrowseMenus();
renderSongsDrawer();
updatePlaybackUi();
loadAlbums({ resetIndex: true }).catch(showError);
refreshPlayer();
setInterval(refreshPlayer, 1500);

window.addEventListener("resize", () => {
  window.clearTimeout(window.__echoflowResizeTimer);
  window.__echoflowResizeTimer = window.setTimeout(positionChrome, 80);
  positionActiveDropdown();
});
document.addEventListener("fullscreenchange", syncFullscreenButton);
document.addEventListener("webkitfullscreenchange", syncFullscreenButton);

function apiGet(path) {
  return fetch(path).then((res) => {
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  });
}

function apiPost(path, body = {}) {
  return fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((res) => (res.ok ? res.json().catch(() => ({})) : Promise.reject(new Error(`${res.status} ${res.statusText}`))));
}

function albumArtUrl(entry, size = 420) {
  if (!entry) return "";
  if (entry.artUrl) return entry.artUrl.replace(/size=\d+/, `size=${size}`);
  if (entry.album) return `/api/art?album=${encodeURIComponent(entry.album)}&size=${size}`;
  return `/api/art?album=${encodeURIComponent(entry.title || entry.id || "")}&size=${size}`;
}

function normalizeAlbum(item) {
  const title = item.title || item.album || "Unknown Album";
  const artist = item.albumArtist || item.artist || item.album_artist || "Unknown Artist";
  return {
    kind: "album",
    id: item.id || item.albumId || title,
    title,
    album: title,
    artist,
    albumArtist: artist,
    subtitle: [artist, item.year].filter(Boolean).join(" - "),
    year: item.year || "",
    songCount: item.songCount || item.song_count || 0,
    artUrl: item.artUrl || item.art_url || `/api/art?album=${encodeURIComponent(title)}&size=420`
  };
}

function normalizeTrack(item, index = 0) {
  const title = item.title || item.Title || "Unknown Title";
  const album = item.album || item.Album || "";
  const artist = item.artist || item.Artist || "";
  return {
    kind: "song",
    id: item.id || item.file || item.path || `${album}-${index}-${title}`,
    file: item.file || item.path || "",
    title,
    album,
    artist,
    albumArtist: item.albumArtist || artist,
    trackNo: Number(item.trackNo || item.trackNumber || item.track || item.Track || index + 1),
    duration: Number(item.duration || item.Time || 0),
    year: item.year || "",
    genre: item.genre || "",
    bitRate: item.bitRate || item.bitrate || "",
    suffix: item.suffix || (item.file ? String(item.file).split(".").pop() : ""),
    artUrl: item.artUrl || item.art_url || (album ? `/api/art?album=${encodeURIComponent(album)}&size=420` : "")
  };
}

async function fetchAlbums(offset = 0, filter = "") {
  const query = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
  if (filter) query.set("filter", filter);
  const data = await apiGet(`/api/library/albums?${query}`);
  const albums = (data.albums || []).map(normalizeAlbum);
  return { albums, total: Number(data.total || albums.length) };
}

async function fetchAlbumTracks(album) {
  if (!album) return [];
  const candidates = [
    album.album,
    album.title,
    album.id,
    (() => {
      try {
        return decodeURIComponent(album.id || "");
      } catch (_error) {
        return "";
      }
    })()
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  const attempts = uniqueCandidates.flatMap((value) => [
    `/api/library/album/${encodeURIComponent(value)}/tracks`,
    `/api/tracks?album=${encodeURIComponent(value)}`
  ]);
  for (const url of attempts) {
    try {
      const data = await apiGet(url);
      const tracks = (data.tracks || []).map(normalizeTrack);
      if (tracks.length) return tracks;
    } catch (_error) {
      // Try the next compatible endpoint.
    }
  }
  return [];
}

async function fetchAllTracks() {
  const data = await apiGet("/api/tracks");
  return (data.tracks || []).map(normalizeTrack);
}

async function loadAlbums({ resetIndex = false, filter = "" } = {}) {
  setStatus("Loading albums...");
  const data = await fetchAlbums(0, filter);
  state.mode = BROWSE_MODE.ALBUM;
  state.entries = data.albums;
  state.total = data.total;
  state.textures = [];
  state.texturePromises.clear();
  if (resetIndex) state.browseIndex = 0;
  syncAlbumSlides({ jump: true });
  updateBrowseSummary(true);
  renderBrowseMenus();
  clearStatus();
}

async function loadArtistAlbums(artistName) {
  state.selectedArtist = artistName;
  const filter = artistName ? `artist:${artistName}` : "";
  await loadAlbums({ resetIndex: true, filter });
  state.mode = BROWSE_MODE.ARTIST;
  renderBrowseMenus();
}

async function loadSongBrowse() {
  setStatus("Loading songs...");
  const tracks = await fetchAllTracks();
  state.mode = BROWSE_MODE.SONGS;
  state.entries = tracks.map((track) => ({
    ...track,
    title: track.title,
    subtitle: [track.artist, track.album].filter(Boolean).join(" - ")
  }));
  state.total = state.entries.length;
  state.textures = [];
  state.texturePromises.clear();
  state.browseIndex = 0;
  syncAlbumSlides({ jump: true });
  state.drawerTitle = "Songs";
  state.drawerSubtitle = "All songs";
  state.drawerTracks = tracks;
  updateBrowseSummary(true);
  renderBrowseMenus();
  clearStatus();
}

async function maybeLoadMoreAlbums() {
  if (state.mode !== BROWSE_MODE.ALBUM || state.loadingMore) return;
  if (state.entries.length >= state.total) return;
  if (state.browseIndex < state.entries.length - 24) return;
  state.loadingMore = true;
  try {
    const data = await fetchAlbums(state.entries.length);
    state.entries.push(...data.albums);
    state.total = data.total;
    syncAlbumSlides();
    updateBrowseSummary();
  } finally {
    state.loadingMore = false;
  }
}

function ensureTexture(index) {
  const entry = state.entries[index];
  if (!entry || state.textures[index]) return;
  const url = albumArtUrl(entry, 420);
  if (!state.texturePromises.has(url)) {
    state.texturePromises.set(url, loadTexture(url));
  }
  state.texturePromises.get(url).then((texture) => {
    if (state.entries[index] !== entry) return;
    state.textures[index] = texture || getDefaultTexture();
    setAlbumData(state.entries.map((_entry, i) => state.textures[i] || getDefaultTexture()));
  });
}

function ensureTextures(anchor = state.browseIndex) {
  const start = Math.max(0, anchor - 8);
  const end = Math.min(state.entries.length, anchor + 9);
  for (let index = start; index < end; index += 1) ensureTexture(index);
}

function syncAlbumSlides({ jump = false } = {}) {
  while (state.textures.length < state.entries.length) state.textures.push(null);
  if (state.textures.length > state.entries.length) state.textures.length = state.entries.length;
  ensureTextures();
  setAlbumData(state.entries.map((_entry, index) => state.textures[index] || getDefaultTexture()));
  if (jump && state.entries.length) jumpTo(state.browseIndex);
  updateBrowseStrip();
  positionChrome();
}

function handleSnap(index) {
  state.browseIndex = clamp(index, 0, Math.max(0, state.entries.length - 1));
  ensureTextures();
  updateBrowseSummary(true);
  maybeLoadMoreAlbums();
}

function navigateBrowseBy(delta) {
  navigateBrowseTo(state.browseIndex + delta);
}

function navigateBrowseTo(index) {
  if (!state.entries.length) return;
  const nextIndex = clamp(Math.round(index), 0, state.entries.length - 1);
  state.browseIndex = nextIndex;
  ensureTextures(nextIndex);
  updateBrowseSummary(true);
  navigateTo(nextIndex);
}

function getCurrentEntry() {
  return state.entries[state.browseIndex] || null;
}

function updateBrowseSummary(force = false) {
  const entry = getCurrentEntry();
  if (!entry) {
    el.trackTitle.textContent = "No Albums";
    el.trackArtist.textContent = "Add music to your EchoFlow library";
    updateBrowseStrip();
    positionChrome();
    return;
  }
  state.currentEntry = entry;
  if (state.playing && state.currentSong?.title) {
    el.trackTitle.textContent = state.currentSong.title || "Unknown";
    el.trackArtist.textContent = state.currentSong.album || "\u00A0";
  } else if (entry.kind === "song") {
    el.trackTitle.textContent = entry.title || "Unknown";
    el.trackArtist.textContent = [entry.artist, entry.album].filter(Boolean).join(" - ") || "\u00A0";
  } else {
    el.trackTitle.textContent = entry.title || "Unknown";
    el.trackArtist.textContent = entry.subtitle || entry.artist || entry.album || "\u00A0";
  }
  if (force && state.drawerOpen) prepareDrawerContext();
  updateBrowseStrip();
  updatePlaybackUi();
  renderInfoActionMenu();
  positionChrome();
}

function updateBrowseStrip() {
  const max = Math.max(0, state.entries.length - 1);
  el.browseStrip.max = String(max);
  el.browseStrip.value = String(clamp(state.browseIndex, 0, max));
  el.browseStrip.disabled = max <= 0;
  el.btnBrowsePrev.disabled = state.browseIndex <= 0;
  el.btnBrowseNext.disabled = state.browseIndex >= max;
  el.btnDrawer.disabled = !state.entries.length;
}

async function prepareDrawerContext() {
  const entry = getCurrentEntry();
  state.activeSongMenuIndex = null;
  hideSongInfo();
  state.drawerLoading = true;
  renderSongsDrawer();
  try {
    if (state.mode === BROWSE_MODE.SONGS) {
      state.drawerTitle = "Songs";
      state.drawerSubtitle = "All songs";
      if (!state.drawerTracks.length) state.drawerTracks = await fetchAllTracks();
    } else if (entry?.kind === "song") {
      state.drawerTitle = entry.album || "Songs";
      state.drawerSubtitle = entry.artist || "";
      state.drawerTracks = entry.album ? await fetchAlbumTracks({ id: entry.album, album: entry.album, title: entry.album }) : [entry];
    } else {
      state.drawerTitle = entry?.title || "Songs";
      state.drawerSubtitle = entry?.artist || entry?.subtitle || "";
      state.drawerTracks = await fetchAlbumTracks(entry);
    }
  } finally {
    state.drawerLoading = false;
    renderSongsDrawer();
  }
}

async function setDrawerOpen(open) {
  state.drawerOpen = open;
  el.songsDrawer.classList.toggle("is-open", open);
  el.songsDrawerBackdrop.classList.toggle("is-open", open);
  el.songsDrawer.setAttribute("aria-hidden", String(!open));
  el.btnDrawer.setAttribute("aria-expanded", String(open));
  if (open) {
    closeDropdowns();
    await prepareDrawerContext();
  } else {
    state.activeSongMenuIndex = null;
    hideSongInfo();
    renderSongsDrawer();
  }
}

function renderSongsDrawer() {
  el.songsDrawerEyebrow.textContent = state.drawerLoading ? "Loading..." : "Tracks";
  el.songsDrawerTitle.textContent = state.drawerTitle || "Songs";
  el.songsDrawerSubtitle.textContent = state.drawerSubtitle || "\u00A0";
  el.songsDrawerCount.textContent = state.drawerLoading ? "..." : `${state.drawerTracks.length} ${state.drawerTracks.length === 1 ? "song" : "songs"}`;
  const drawerEntry = getCurrentEntry();
  const hasAlbumContext = Boolean(drawerEntry?.kind === "album" || drawerEntry?.album);
  const albumStarred = Boolean(drawerEntry?.starred || drawerEntry?.albumStarred);
  el.btnDrawerFavourite.classList.toggle("hidden", !hasAlbumContext);
  el.btnDrawerFavourite.classList.toggle("is-active", hasAlbumContext && albumStarred);
  el.btnDrawerFavourite.setAttribute("aria-label", albumStarred ? "Remove album favourite" : "Favourite album");
  el.btnDrawerFavourite.setAttribute("title", albumStarred ? "Remove album favourite" : "Favourite album");
  el.drawerFavouriteIconPath.setAttribute("d", albumStarred ? HEART_ICON_FILLED_PATH : HEART_ICON_OUTLINE_PATH);

  if (state.drawerLoading) {
    el.songsTableBody.innerHTML = `<tr class="songs-empty-row"><td colspan="4">Loading songs...</td></tr>`;
    return;
  }
  if (!state.drawerTracks.length) {
    el.songsTableBody.innerHTML = `<tr class="songs-empty-row"><td colspan="4">No songs available.</td></tr>`;
    return;
  }

  el.songsTableBody.innerHTML = state.drawerTracks.map((track, index) => {
    const isCurrent = state.currentSong && (state.currentSong.id === track.id || state.currentSong.file === track.file);
    const menuOpen = state.activeSongMenuIndex === index;
    const rowNumber = isCurrent
      ? `<span class="song-current-marker ${state.playing ? "is-playing" : "is-paused"}"><span></span><span></span><span></span></span>`
      : escapeHtml(String(track.trackNo || index + 1));
    return `
      <tr class="${[isCurrent ? "is-current" : "", menuOpen ? "is-menu-open" : ""].filter(Boolean).join(" ")}">
        <td class="song-row-nr">${rowNumber}</td>
        <td class="song-row-title-cell">
          <button class="song-row-title-wrap" data-action="play-song" data-index="${index}">
            <span class="song-row-title">${escapeHtml(track.title)}</span>
            <span class="song-row-subtitle">${escapeHtml([track.artist, track.album].filter(Boolean).join(" - ")) || "&nbsp;"}</span>
          </button>
        </td>
        <td class="song-row-duration">${track.duration ? formatClock(track.duration) : "--:--"}</td>
        <td class="song-row-actions ${menuOpen ? "is-menu-open" : ""}">
          <button class="song-menu-btn" data-action="toggle-song-menu" data-index="${index}" aria-label="Song actions">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
            </svg>
          </button>
          ${menuOpen ? renderSongMenu(index) : ""}
        </td>
      </tr>
    `;
  }).join("");
}

function renderSongMenu(index) {
  const track = state.drawerTracks[index];
  return `
    <div class="song-context-menu">
      ${renderSharedActionMenuContent({ type: "song", track }, { actionAttr: "data-action", rowIndex: index })}
    </div>
  `;
}

function renderActionButton({ action, actionAttr, label, rowIndex = null, className = "" }) {
  const rowAttr = Number.isInteger(rowIndex) ? ` data-index="${rowIndex}"` : "";
  const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
  return `<button${classAttr} ${actionAttr}="${escapeHtml(action)}"${rowAttr}>${escapeHtml(label)}</button>`;
}

function renderSharedActionMenuContent(subject, options) {
  const isAlbum = subject?.type === "album";
  return `
    ${renderActionButton({
      action: isAlbum ? "play-album" : "play-song",
      actionAttr: options.actionAttr,
      label: isAlbum ? "Play album" : "Play",
      rowIndex: options.rowIndex
    })}
    ${renderActionButton({
      action: "add-to-playlist",
      actionAttr: options.actionAttr,
      label: isAlbum ? "Add album to playlist" : "Add to playlist",
      rowIndex: options.rowIndex
    })}
    ${renderActionButton({
      action: "toggle-favourite",
      actionAttr: options.actionAttr,
      label: "Favourite",
      rowIndex: options.rowIndex
    })}
    ${renderActionButton({
      action: "more-info",
      actionAttr: options.actionAttr,
      label: "More info",
      rowIndex: options.rowIndex
    })}
  `;
}

function getInfoActionSubject() {
  if (state.playing && state.currentSong?.title) return { type: "song", track: state.currentSong };
  const entry = getCurrentEntry();
  if (entry?.kind === "album") return { type: "album", entry };
  if (entry?.kind === "song") return { type: "song", track: entry };
  if (state.currentSong?.title) return { type: "song", track: state.currentSong };
  return null;
}

function renderInfoActionMenu() {
  const subject = getInfoActionSubject();
  const menuOpen = Boolean(subject) && state.activeInfoMenuMode !== "closed";
  el.infoPanel.classList.toggle("has-actions", Boolean(subject));
  el.btnInfoMenu.classList.toggle("hidden", !subject);
  el.btnInfoMenu.classList.toggle("is-menu-open", menuOpen);
  el.btnInfoMenu.setAttribute("aria-expanded", String(menuOpen));
  if (!subject || !menuOpen) {
    el.infoContextMenu.classList.add("hidden");
    el.infoContextMenu.innerHTML = "";
    return;
  }
  el.infoContextMenu.innerHTML = renderSharedActionMenuContent(subject, { actionAttr: "data-info-action" });
  el.infoContextMenu.classList.remove("hidden");
}

function showSongInfo(index) {
  const track = state.drawerTracks[index];
  showSongInfoForTrack(track, index);
}

async function handleInfoAction(event) {
  const button = event.target.closest("button[data-info-action]");
  if (!button) return;
  const action = button.dataset.infoAction;
  const subject = getInfoActionSubject();
  state.activeInfoMenuMode = "closed";
  renderInfoActionMenu();
  if (!subject) return;

  if (action === "play-album" && subject.type === "album") {
    await playAlbum(subject.entry);
  } else if (action === "play-song" && subject.type === "song") {
    await playTrack(subject.track);
  } else if (action === "more-info") {
    if (subject.type === "song") {
      showSongInfoForTrack(subject.track, 0);
    } else {
      showAlbumInfo(subject.entry);
    }
  } else if (action === "add-to-playlist") {
    setStatus("Playlist support is not available in EchoFlow yet.");
    window.setTimeout(clearStatus, 1400);
  } else if (action === "toggle-favourite") {
    setStatus("Favourites are not available in EchoFlow yet.");
    window.setTimeout(clearStatus, 1400);
  }
}

function showSongInfoForTrack(track, index = 0) {
  if (!track) return;
  state.infoTrackIndex = index;
  state.activeSongMenuIndex = null;
  el.songInfoEyebrow.textContent = "Track Details";
  el.songInfoTitle.textContent = track.title || "More Info";
  el.songInfoContent.innerHTML = `<div class="song-info-grid">${buildSongInfoRows(track, index)}</div>`;
  el.songInfoModal.classList.remove("hidden");
  el.songInfoModal.setAttribute("aria-hidden", "false");
  renderSongsDrawer();
}

function showAlbumInfo(entry) {
  if (!entry) return;
  state.infoTrackIndex = null;
  el.songInfoEyebrow.textContent = "Album Details";
  el.songInfoTitle.textContent = entry.title || "Album Info";
  el.songInfoContent.innerHTML = `<div class="song-info-grid">${[
    ["Title", entry.title || "Untitled Album"],
    ["Artist", entry.artist || "Unknown Artist"],
    ["Songs", entry.songCount || state.drawerTracks.length || "Unknown"],
    ["Date", entry.year || "Unknown"]
  ].map(([label, value]) => `
    <div class="song-info-label">${escapeHtml(label)}</div>
    <div class="song-info-value">${escapeHtml(String(value || "Unknown"))}</div>
  `).join("")}</div>`;
  el.songInfoModal.classList.remove("hidden");
  el.songInfoModal.setAttribute("aria-hidden", "false");
}

function buildSongInfoRows(track, index = 0) {
  return [
    ["Nr", track.trackNo || index + 1],
    ["Title", track.title],
    ["Artist", track.artist || "Unknown"],
    ["Album", track.album || "Unknown"],
    ["Duration", track.duration ? formatClock(track.duration) : "Unknown"],
    ["Codec", track.suffix ? String(track.suffix).toUpperCase() : "Unknown"],
    ["Bitrate", track.bitRate || "Unknown"],
    ["Genre", track.genre || "Unknown"],
    ["Date", track.year || "Unknown"],
    ["Path", track.file || "Unavailable"]
  ].map(([label, value]) => `
    <div class="song-info-label">${escapeHtml(label)}</div>
    <div class="song-info-value">${escapeHtml(String(value || "Unknown"))}</div>
  `).join("");
}

function hideSongInfo() {
  state.infoTrackIndex = null;
  el.songInfoModal.classList.add("hidden");
  el.songInfoModal.setAttribute("aria-hidden", "true");
}

async function playAlbum(entry = getCurrentEntry()) {
  if (!entry) return;
  await apiPost("/api/player/queue", { albumId: entry.id || entry.album || entry.title, clear: true, play: true })
    .catch(() => apiPost("/api/play-album", { album: entry.album || entry.title }));
  await refreshPlayer();
}

async function playTrack(track) {
  if (!track) return;
  await apiPost("/api/player/play", { trackId: track.id, file: track.file })
    .catch(() => apiPost("/api/play-track", { file: track.file, title: track.title }));
  state.currentSong = track;
  await refreshPlayer();
}

function toggleDrawerAlbumFavourite(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const entry = getCurrentEntry();
  if (!entry) return;
  const nextStarred = !Boolean(entry.starred || entry.albumStarred);
  entry.starred = nextStarred;
  entry.albumStarred = nextStarred;
  renderSongsDrawer();
  setStatus(nextStarred ? `Favourited album ${entry.title || entry.album || ""}` : `Removed favourite from album ${entry.title || entry.album || ""}`);
  window.setTimeout(clearStatus, 1200);
}

async function refreshPlayer() {
  try {
    const data = await apiGet("/api/player/state").catch(() => apiGet("/api/status"));
    const status = data.status || data || {};
    const song = data.song || {};
    state.playing = status.state === "play";
    state.volume = Number(status.volume ?? state.volume ?? 0);
    state.duration = Number(status.duration || song.Time || song.duration || 0);
    state.elapsed = Number(status.elapsed || 0);
    if (song.Title || song.title) {
      state.currentSong = normalizeTrack({
        id: song.id || song.file,
        file: song.file,
        title: song.Title || song.title,
        artist: song.Artist || song.artist,
        album: song.Album || song.album,
        duration: song.Time || song.duration
      });
    }
    updateBrowseSummary();
  } catch (_error) {
    updatePlaybackUi();
  }
}

function getDisplayedTimeline() {
  if (!state.playing || !state.elapsed) return { elapsed: state.elapsed, duration: state.duration };
  const elapsed = Math.min(state.duration || Infinity, state.elapsed + 0);
  return { elapsed, duration: state.duration };
}

function updatePlaybackUi() {
  const { elapsed, duration } = getDisplayedTimeline();
  const progress = duration > 0 ? clamp((elapsed / duration) * 100, 0, 100) : 0;
  el.seekTime.textContent = `${formatClock(elapsed)} / ${duration > 0 ? formatClock(duration) : "--:--"}`;
  el.seekFill.style.width = `${progress}%`;
  el.seekHandle.style.left = `${progress}%`;
  el.seekTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  el.iconPlay.classList.toggle("hidden", state.playing);
  el.iconPause.classList.toggle("hidden", !state.playing);
  const volume = clamp(Math.round(state.volume || 0), 0, 100);
  el.volumeSlider.value = String(volume);
  el.volumeSlider.style.setProperty("--volume-progress", `${volume}%`);
  el.volumeIconPath.setAttribute("d", getVolumeIconPath(volume));
  renderSongsDrawer();
}

function seekFromClientX(clientX) {
  const rect = el.seekTrack.getBoundingClientRect();
  if (!rect.width || !state.duration) return 0;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  state.elapsed = Math.floor(state.duration * ratio);
  updatePlaybackUi();
  return state.elapsed;
}

async function commitSeek(seconds) {
  await apiPost("/api/player/seek", { seconds }).catch(() => apiPost("/api/seek", { seconds }));
  await refreshPlayer();
}

async function setVolume(volume) {
  state.volume = clamp(Number(volume), 0, 100);
  updatePlaybackUi();
  await apiPost("/api/player/volume", { volume: state.volume }).catch(() => apiPost("/api/volume", { volume: state.volume }));
}

function renderBrowseMenus() {
  for (const button of browseButtons) {
    const menu = button.dataset.browseMenu;
    const moreActive = [BROWSE_MODE.YEAR, BROWSE_MODE.GENRE, BROWSE_MODE.RATING, BROWSE_MODE.STARRED, BROWSE_MODE.RADIO].includes(state.mode) && menu === "more";
    button.classList.toggle("is-active", menu === state.mode || moreActive || (state.mode === BROWSE_MODE.SEARCH && button === el.browseAlbum));
  }
  renderDropdown(el.songsDropdown, [
    { label: "Group by album", meta: "One cover per album", action: "songs-display", value: "album", selected: state.songsDisplayMode === "album" },
    { label: "Show songs", meta: "One cover per song", action: "songs-display", value: "song", selected: state.songsDisplayMode === "song" },
    { label: "All Songs", meta: "Browse every track", action: "songs-all", selected: state.mode === BROWSE_MODE.SONGS },
    { label: "Current Album", meta: "Open album drawer", action: "songs-current", selected: state.drawerOpen }
  ]);
  renderDropdown(el.artistDropdown, state.artists.map((artist) => ({
    label: artist.name,
    meta: `${artist.album_count || artist.albumCount || 0} albums`,
    action: "artist",
    value: artist.name,
    selected: state.selectedArtist === artist.name
  })));
  renderPlaylistDropdown();
  renderMoreDropdown();
  renderSettingsDropdown();
  for (const dropdown of [el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown, el.settingsDropdown]) {
    dropdown.classList.toggle("is-open", dropdown.id === state.activeDropdown);
    dropdown.setAttribute("aria-hidden", String(dropdown.id !== state.activeDropdown));
  }
  positionActiveDropdown();
}

function renderTrackDisplayModeOptions(mode, action) {
  return `
    <button class="browse-dropdown-item ${mode === "album" ? "is-selected" : ""}" data-action="${action}" data-value="album">
      <span class="browse-dropdown-label">Group by album</span>
      <span class="browse-dropdown-meta">One cover per album</span>
    </button>
    <button class="browse-dropdown-item ${mode === "song" ? "is-selected" : ""}" data-action="${action}" data-value="song">
      <span class="browse-dropdown-label">Show songs</span>
      <span class="browse-dropdown-meta">One cover per song</span>
    </button>
  `;
}

function renderPlaylistDropdown() {
  el.playlistDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      ${renderTrackDisplayModeOptions(state.playlistDisplayMode, "playlist-display")}
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item" data-action="play-current-album">
        <span class="browse-dropdown-label">Play Current Album</span>
        <span class="browse-dropdown-meta">Queue the selected cover</span>
      </button>
      <button class="browse-dropdown-item" data-action="songs-current">
        <span class="browse-dropdown-label">Open Song Drawer</span>
        <span class="browse-dropdown-meta">Use the album track list</span>
      </button>
      <button class="browse-dropdown-item" disabled>
        <span class="browse-dropdown-label">No playlists</span>
        <span class="browse-dropdown-meta">Playlist API is not available yet</span>
      </button>
    </div>
  `;
}

function renderMoreDropdown() {
  const selectedYearTitle = state.selectedYear || "Select year";
  const selectedGenreTitle = state.selectedGenre || "Select genre";
  const yearItems = state.years.map((year) => {
    const value = String(year.year ?? year.value ?? year.name ?? year);
    const count = year.album_count || year.albumCount || 0;
    return `
      <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.YEAR && state.selectedYear === value ? "is-selected" : ""}" data-action="year" data-value="${escapeHtml(value)}">
        <span class="browse-dropdown-label">${escapeHtml(value)}</span>
        <span class="browse-dropdown-meta">${count ? `${count} albums` : state.selectedYear === value ? "Selected" : "\u00A0"}</span>
      </button>
    `;
  }).join("");
  const genreItems = state.genres.map((genre) => {
    const value = String(genre.name ?? genre.value ?? genre);
    const count = genre.album_count || genre.albumCount || 0;
    return `
      <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.GENRE && state.selectedGenre === value ? "is-selected" : ""}" data-action="genre" data-value="${escapeHtml(value)}">
        <span class="browse-dropdown-label">${escapeHtml(value)}</span>
        <span class="browse-dropdown-meta">${count ? `${count} albums` : "\u00A0"}</span>
      </button>
    `;
  }).join("");

  el.moreDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.RATING ? "is-selected" : ""}" data-action="more-mode" data-value="${BROWSE_MODE.RATING}">
        <span class="browse-dropdown-label">Top Rated</span>
        <span class="browse-dropdown-meta">Browse highest-rated albums</span>
      </button>
      <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.STARRED ? "is-selected" : ""}" data-action="more-mode" data-value="${BROWSE_MODE.STARRED}">
        <span class="browse-dropdown-label">Favourite</span>
        <span class="browse-dropdown-meta">Browse your favourite songs</span>
      </button>
      <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.RADIO ? "is-selected" : ""}" data-action="more-mode" data-value="${BROWSE_MODE.RADIO}">
        <span class="browse-dropdown-label">Radio</span>
        <span class="browse-dropdown-meta">Browse internet radio stations</span>
      </button>
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${state.activeMorePanel === "year" ? "is-selected" : ""}" data-action="more-panel" data-value="year">
        <span class="browse-dropdown-label">Years</span>
        <span class="browse-dropdown-meta">${escapeHtml(selectedYearTitle)}</span>
      </button>
      ${state.activeMorePanel === "year" ? `<div class="browse-dropdown-sublist">${yearItems || `<button class="browse-dropdown-item" disabled><span class="browse-dropdown-label">No years</span></button>`}</div>` : ""}
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${state.activeMorePanel === "genre" ? "is-selected" : ""}" data-action="more-panel" data-value="genre">
        <span class="browse-dropdown-label">Genres</span>
        <span class="browse-dropdown-meta">${escapeHtml(selectedGenreTitle)}</span>
      </button>
      ${state.activeMorePanel === "genre" ? `<div class="browse-dropdown-sublist">${genreItems || `<button class="browse-dropdown-item" disabled><span class="browse-dropdown-label">No genres</span></button>`}</div>` : ""}
    </div>
  `;
}

function renderDropdown(dropdown, items) {
  if (!dropdown) return;
  if (!items.length) {
    dropdown.innerHTML = `<button class="browse-dropdown-item" disabled><span class="browse-dropdown-label">No items yet</span></button>`;
    return;
  }
  dropdown.innerHTML = items.map((item) => `
    <button class="browse-dropdown-item ${item.selected ? "is-selected" : ""}" data-action="${escapeHtml(item.action)}" data-value="${escapeHtml(item.value || "")}">
      <span class="browse-dropdown-label-row">
        <span class="browse-dropdown-label">${escapeHtml(item.label)}</span>
      </span>
      ${item.meta ? `<span class="browse-dropdown-meta">${escapeHtml(item.meta)}</span>` : ""}
    </button>
  `).join("");
}

function portalBrowseDropdowns() {
  for (const dropdown of [el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown, el.settingsDropdown]) {
    if (!dropdown || dropdown.parentElement === document.body) continue;
    dropdown.classList.add("browse-dropdown-floating");
    document.body.appendChild(dropdown);
  }
}

function getDropdownAnchor(dropdownId = state.activeDropdown) {
  return {
    "songs-dropdown": el.browseSongs,
    "artist-dropdown": el.browseArtist,
    "playlist-dropdown": el.browsePlaylist,
    "more-dropdown": el.browseMore,
    "settings-dropdown": el.browseSettings
  }[dropdownId] || null;
}

function positionActiveDropdown() {
  const dropdown = document.getElementById(state.activeDropdown || "");
  const anchor = getDropdownAnchor();
  if (!dropdown || !anchor || !dropdown.classList.contains("is-open")) return;
  const anchorRect = anchor.getBoundingClientRect();
  const dropdownRect = dropdown.getBoundingClientRect();
  const gap = 10;
  const viewportPadding = 8;
  const top = Math.max(viewportPadding, anchorRect.top - dropdownRect.height - gap);
  let left = anchorRect.left;
  if (state.activeDropdown === "settings-dropdown") {
    left = anchorRect.right - dropdownRect.width;
  }
  left = clamp(left, viewportPadding, Math.max(viewportPadding, window.innerWidth - dropdownRect.width - viewportPadding));
  dropdown.style.left = `${Math.round(left)}px`;
  dropdown.style.top = `${Math.round(top)}px`;
  dropdown.style.right = "auto";
  dropdown.style.bottom = "auto";
}

function renderSettingsDropdown() {
  const fontPercent = Math.round(state.albumInfoFontScale * 100);
  const audioOptions = state.audioDevices.length
    ? state.audioDevices
    : [{ alsa: state.settings.audioOutput || "default", label: "default - ALSA default output" }];
  const routeOptions = [
    ["auto", "Auto"],
    ["usb-dac", "USB DAC"],
    ["dac-hat", "DAC HAT"],
    ["hdmi", "HDMI"],
    ["headphones", "Headphones"]
  ];
  el.settingsDropdown.innerHTML = `
    <form id="echoflow-settings-form" class="echoflow-settings-form">
      <div class="browse-dropdown-section">
        <div class="settings-stack">
          <div class="settings-stepper">
            <button class="settings-step-btn" type="button" data-action="font-down" ${state.albumInfoFontScale <= 0.5 ? "disabled" : ""}>A-</button>
            <button class="settings-step-btn" type="button" data-action="font-reset" ${Math.abs(state.albumInfoFontScale - 1) < 0.01 ? "disabled" : ""}>${fontPercent}%</button>
            <button class="settings-step-btn" type="button" data-action="font-up" ${state.albumInfoFontScale >= 1.6 ? "disabled" : ""}>A+</button>
          </div>
          <div class="settings-summary">
            <span class="browse-dropdown-label">Album Info Font</span>
            <span class="browse-dropdown-meta">${fontPercent}%</span>
          </div>
        </div>
      </div>

      <div class="browse-dropdown-section echoflow-settings-grid">
        <label>
          <span>Music folder</span>
          <input id="setting-music-path" name="music_directory" value="${escapeHtml(state.settings.musicDirectory)}">
        </label>
        <label>
          <span>Output route</span>
          <select id="audio-output-route" name="audio_output">
            ${routeOptions.map(([value, label]) => `<option value="${value}" ${value === state.settings.audioOutput ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>ALSA device</span>
          <select id="audio-output-device" name="alsa_device">
            ${audioOptions.map((device) => `
              <option value="${escapeHtml(device.alsa)}" ${device.alsa === state.settings.alsaDevice ? "selected" : ""}>${escapeHtml(device.label || device.alsa)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>Mixer type</span>
          <select id="audio-output-mixer" name="mixer">
            ${[
              ["software", "Software volume"],
              ["none", "Bit-perfect/no mixer"],
              ["hardware", "Hardware mixer"]
            ].map(([value, label]) => `<option value="${value}" ${value === state.settings.mixer ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Album art</span>
          <select id="setting-album-art" name="album_art">
            <option value="folder-first" ${state.settings.albumArt === "folder-first" ? "selected" : ""}>Folder artwork first</option>
            <option value="embedded-first" ${state.settings.albumArt === "embedded-first" ? "selected" : ""}>Embedded artwork first</option>
          </select>
        </label>
        <label>
          <span>Visible covers</span>
          <input id="setting-visible" name="visible" type="number" min="0" max="240" step="2" value="${escapeHtml(state.settings.visible)}" title="0 = auto by screen width">
        </label>
      </div>

      <div class="browse-dropdown-section">
        <div class="settings-summary">
          <span class="browse-dropdown-label">Audio Inputs</span>
          <span class="browse-dropdown-meta">Bluetooth / AirPlay / Kiosk</span>
        </div>
        <div class="echoflow-service-grid">
          ${renderServiceControl("bluetooth", "Bluetooth")}
          ${renderServiceControl("airplay", "AirPlay")}
          ${renderServiceControl("kiosk", "Kiosk")}
        </div>
      </div>

      <div class="browse-dropdown-section echoflow-settings-actions">
        <button class="settings-step-btn" type="submit">Save</button>
        <button class="settings-step-btn" type="button" data-action="rescan-library">Rescan</button>
        <button class="settings-step-btn" type="button" data-action="rebuild-artwork">Rebuild Art</button>
        <button class="settings-step-btn" type="button" data-action="refresh-audio">Refresh Audio</button>
      </div>
      <div id="settings-status" class="echoflow-settings-status">${escapeHtml(state.settingsStatus)}</div>
    </form>
  `;
}

function renderServiceControl(key, label) {
  const service = normalizeServiceState(state.services[key]);
  return `
    <div class="echoflow-service-row">
      <div>
        <span class="browse-dropdown-label">${escapeHtml(label)}</span>
        <span class="browse-dropdown-meta">${escapeHtml(service.label)}</span>
      </div>
      <button class="settings-step-btn" type="button" data-action="service-toggle" data-service="${escapeHtml(key)}">
        ${service.active ? "Stop" : "Start"}
      </button>
    </div>
  `;
}

function normalizeServiceState(value) {
  const first = Array.isArray(value) ? value[0] : value || {};
  const active = first.active === true || first.active === "active" || first.state === "active";
  const enabled = first.enabled === true || first.enabled === "enabled";
  const installed = first.name !== "not installed";
  return {
    active,
    enabled,
    installed,
    label: installed
      ? `${active ? "active" : "inactive"} / ${enabled ? "enabled" : "disabled"}`
      : "not installed"
  };
}

async function warmMenus() {
  if (!state.artists.length) {
    apiGet("/api/library/artists").then((data) => {
      state.artists = data.artists || [];
      renderBrowseMenus();
    }).catch(() => {});
  }
  if (!state.genres.length) {
    apiGet("/api/library/genres").then((data) => {
      state.genres = data.genres || [];
      renderBrowseMenus();
    }).catch(() => {});
  }
  if (!state.years.length) {
    apiGet("/api/library/years").then((data) => {
      state.years = data.years || [];
      renderBrowseMenus();
    }).catch(() => {});
  }
}

async function toggleDropdown(dropdownId) {
  state.activeDropdown = state.activeDropdown === dropdownId ? null : dropdownId;
  if (state.activeDropdown) {
    warmMenus();
    if (dropdownId === "settings-dropdown") {
      await refreshSettingsData();
    }
  }
  renderBrowseMenus();
}

function closeDropdowns() {
  state.activeDropdown = null;
  renderBrowseMenus();
}

function closeVolumePopover() {
  el.volumePopover.classList.remove("is-open");
  el.volumePopover.setAttribute("aria-hidden", "true");
  el.btnVolume.setAttribute("aria-expanded", "false");
}

function closeTransientMenus() {
  let changed = false;
  if (state.activeDropdown) {
    state.activeDropdown = null;
    changed = true;
  }
  if (state.activeSongMenuIndex != null) {
    state.activeSongMenuIndex = null;
    changed = true;
  }
  if (state.activeInfoMenuMode !== "closed") {
    state.activeInfoMenuMode = "closed";
    changed = true;
  }
  if (changed) {
    renderBrowseMenus();
    renderSongsDrawer();
    renderInfoActionMenu();
  }
  closeVolumePopover();
}

function setSearchOpen(open) {
  state.searchOpen = open;
  el.searchPanel.classList.toggle("hidden", !open);
  el.searchPanel.setAttribute("aria-hidden", String(!open));
  el.btnSearch.classList.toggle("is-active", open);
  el.btnSearch.setAttribute("aria-expanded", String(open));
  if (open) {
    closeDropdowns();
    el.searchInput.focus();
  }
  renderSearchPanel();
}

function renderSearchPanel() {
  const query = state.searchQuery.trim();
  el.btnSearchClear.classList.toggle("hidden", !query);
  if (!query) {
    el.searchMeta.classList.add("hidden");
    el.searchResults.innerHTML = `<div class="search-empty">Search albums and songs.</div>`;
    return;
  }
  el.searchMeta.textContent = state.searchLoading ? "Searching..." : `${state.entries.length} ${state.entries.length === 1 ? "result" : "results"} for "${query}"`;
  el.searchMeta.classList.remove("hidden");
  el.searchResults.innerHTML = state.entries.slice(0, 80).map((entry, index) => `
    <button class="search-result" data-index="${index}">
      <img src="${escapeHtml(albumArtUrl(entry, 128))}" alt="">
      <span>
        <strong>${escapeHtml(entry.title)}</strong>
        <small>${escapeHtml(entry.subtitle || entry.artist || entry.album || entry.kind)}</small>
      </span>
      <em>${entry.kind === "song" ? "Song" : "Album"}</em>
    </button>
  `).join("") || `<div class="search-empty">No results.</div>`;
}

let searchTimer = 0;
function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, SEARCH_DELAY_MS);
}

async function runSearch() {
  const query = state.searchQuery.trim();
  if (!query) {
    await loadAlbums({ resetIndex: true });
    renderSearchPanel();
    return;
  }
  state.searchLoading = true;
  renderSearchPanel();
  try {
    const data = await apiGet(`/api/search?q=${encodeURIComponent(query)}&limit=200`);
    const albums = (data.albums || []).map(normalizeAlbum);
    const tracks = (data.tracks || []).map(normalizeTrack);
    state.mode = BROWSE_MODE.SEARCH;
    state.entries = [...albums, ...tracks];
    state.total = state.entries.length;
    state.textures = [];
    state.texturePromises.clear();
    state.browseIndex = 0;
    syncAlbumSlides({ jump: true });
    updateBrowseSummary(true);
  } finally {
    state.searchLoading = false;
    renderSearchPanel();
  }
}

function fitInfoPanelTypography(coverWidthPx, availableHeightPx) {
  const safeWidth = Math.max(120, coverWidthPx || 0);
  const safeHeight = Math.max(10, Math.floor(availableHeightPx || 0));
  const fontScale = state.albumInfoFontScale;
  let lineHeight = safeHeight < 18 ? 0.98 : safeHeight < 26 ? 1.04 : 1.15;
  const minTitleSize = safeHeight < 18 ? 11 : 12;
  const minArtistSize = safeHeight < 18 ? 9 : 10;
  let titleSize = clamp(Math.round(safeWidth * 0.115 * fontScale), minTitleSize, 54);
  let artistSize = Math.min(clamp(Math.round(safeWidth * 0.07 * fontScale), minArtistSize, 34), Math.round(titleSize * 0.74));
  let gap = safeHeight < 18 ? 0 : clamp(Math.round(titleSize * 0.08), 1, 4);
  const padTop = safeHeight < 18 ? 0 : clamp(Math.round(safeHeight * 0.01), 0, 2);
  const padX = clamp(Math.round(safeWidth * 0.02), 4, 12);
  const contentHeight = () => Math.ceil(titleSize * lineHeight) + Math.ceil(artistSize * lineHeight) + gap + padTop;

  for (let step = 0; step < 48 && contentHeight() > safeHeight; step += 1) {
    let changed = false;
    if (titleSize > minTitleSize) {
      titleSize -= 1;
      changed = true;
    }
    if (artistSize > minArtistSize && contentHeight() > safeHeight) {
      artistSize -= 1;
      changed = true;
    }
    if (gap > 0 && contentHeight() > safeHeight) {
      gap -= 1;
      changed = true;
    }
    if (!changed && lineHeight > 0.94 && contentHeight() > safeHeight) {
      lineHeight = Math.max(0.94, lineHeight - 0.02);
      changed = true;
    }
    if (!changed) break;
  }

  el.infoPanel.style.setProperty("--info-title-size", `${titleSize}px`);
  el.infoPanel.style.setProperty("--info-artist-size", `${artistSize}px`);
  el.infoPanel.style.setProperty("--info-gap", `${gap}px`);
  el.infoPanel.style.padding = `${padTop}px ${padX}px 0`;
  el.trackTitle.style.lineHeight = String(lineHeight);
  el.trackArtist.style.lineHeight = String(lineHeight);
  return { height: contentHeight() };
}

function getControlsSurfaceTop() {
  return [el.transport, el.browseBarShell, el.browseBar, el.controlsMain, el.controls]
    .map((node) => node?.getBoundingClientRect().top)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] || window.innerHeight;
}

function fitControlsLayout() {
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 480;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 800;
  const heightT = clamp((viewportHeight - 360) / 140, 0, 1);
  const widthT = clamp((viewportWidth - 620) / 420, 0, 1);
  const controlsT = (heightT + widthT) / 2;
  const browseT = (clamp((viewportHeight - 300) / 220, 0, 1) + clamp((viewportWidth - 420) / 320, 0, 1)) / 2;
  const mix = (min, max) => min + (max - min) * controlsT;
  const mixBrowse = (min, max) => min + (max - min) * browseT;
  const style = el.controls.style;

  style.setProperty("--controls-shell-width", `${Math.round(mix(320, 560))}px`);
  style.setProperty("--controls-gap", `${Math.round(mix(0, 2))}px`);
  style.setProperty("--controls-padding-top", `${Math.round(mix(0, 2))}px`);
  style.setProperty("--controls-padding-side", `${Math.round(mix(4, 12))}px`);
  style.setProperty("--controls-padding-bottom", `${Math.round(mix(0, 2))}px`);
  style.setProperty("--transport-gap", `${Math.round(mix(1, 8))}px`);
  style.setProperty("--ctrl-btn-size", `${Math.round(mix(22, 32))}px`);
  style.setProperty("--ctrl-btn-icon-size", `${Math.round(mix(12, 18))}px`);
  style.setProperty("--ctrl-play-size", `${Math.round(mix(26, 36))}px`);
  style.setProperty("--ctrl-play-icon-size", `${Math.round(mix(16, 24))}px`);
  style.setProperty("--transport-cluster-height", `${Math.round(mix(30, 42))}px`);
  style.setProperty("--transport-cluster-gap", `${Math.round(mix(1, 6))}px`);
  style.setProperty("--browse-strip-shell-height", `${Math.round(mix(16, 24))}px`);
  style.setProperty("--browse-strip-track-height", `${Math.round(mix(10, 16))}px`);
  style.setProperty("--browse-strip-thumb-height", `${Math.round(mix(10, 16))}px`);
  style.setProperty("--browse-strip-thumb-width", `${Math.round(mix(16, 30))}px`);
  style.setProperty("--browse-strip-cap-width", `${Math.round(mix(18, 26))}px`);
  style.setProperty("--browse-btn-min-height", `${Math.round(mixBrowse(18, 34))}px`);
  style.setProperty("--browse-btn-padding-y", `${Math.round(mixBrowse(0, 3))}px`);
  style.setProperty("--browse-btn-padding-x", `${Math.round(mixBrowse(1, 4))}px`);
  style.setProperty("--browse-btn-gap", `${Math.round(mixBrowse(0, 1))}px`);
  style.setProperty("--browse-bar-gap", `${Math.round(mixBrowse(1, 3))}px`);
  style.setProperty("--browse-btn-font-size", `${mixBrowse(5.8, 8.8).toFixed(1)}px`);
  style.setProperty("--browse-btn-icon-size", `${Math.round(mixBrowse(8, 16))}px`);
}

function positionChrome() {
  fitControlsLayout();
  const metrics = getCenterCoverMetrics();
  if (Math.abs(metrics.offsetY - metrics.defaultOffsetY) > 0.01) {
    setCoverflowOffsetY(metrics.defaultOffsetY);
  }

  let coverBounds = getProjectedCenterCoverBounds() || getActiveCoverBounds();
  if (!coverBounds) return;

  const containerRect = el.container.getBoundingClientRect();
  const controlsTopLocal = getControlsSurfaceTop() - containerRect.top;

  let coverWidthPx = Math.min(el.container.clientWidth * 0.9, Math.max(0, Math.round(coverBounds.width)));
  let coverHeightPx = Math.max(0, Math.round(coverBounds.height));

  const syncCoverChrome = () => {
    coverWidthPx = Math.min(el.container.clientWidth * 0.9, Math.max(0, Math.round(coverBounds.width)));
    coverHeightPx = Math.max(0, Math.round(coverBounds.height));
    const playbackInsetX = clamp(Math.round(coverWidthPx * 0.04), 8, 18);
    const playbackWidthPx = Math.max(0, coverWidthPx - playbackInsetX * 2);
    el.playbackStrip.style.left = `${Math.round(coverBounds.centerX)}px`;
    el.playbackStrip.style.width = `${playbackWidthPx}px`;
    el.playbackStrip.style.maxWidth = `${playbackWidthPx}px`;
    el.searchPanel.style.left = `${Math.round(coverBounds.centerX)}px`;
    el.searchPanel.style.width = `${coverWidthPx}px`;
    el.searchPanel.style.maxWidth = `${coverWidthPx}px`;
    const playbackGap = clamp(Math.round(coverHeightPx * 0.015), 2, 6);
    const playbackHeightPx = Math.round(el.playbackStrip.getBoundingClientRect().height || 0);
    const playbackTop = Math.max(6, Math.round(coverBounds.top - playbackHeightPx - playbackGap));
    el.playbackStrip.style.top = `${playbackTop}px`;
    el.infoPanel.style.bottom = "auto";
    el.infoPanel.style.width = `${coverWidthPx}px`;
    el.infoPanel.style.maxWidth = `${coverWidthPx}px`;
    return playbackTop;
  };

  let playbackTop = syncCoverChrome();
  const desiredTopMargin = clamp(Math.round(coverHeightPx * 0.015), 4, 10);
  for (let pass = 0; pass < 3; pass += 1) {
    const excess = playbackTop - desiredTopMargin;
    if (excess <= 3) break;
    const curOffset = getCenterCoverMetrics().offsetY;
    const y1 = worldToScreenY(curOffset);
    const y2 = worldToScreenY(curOffset + 10);
    if (y1 == null || y2 == null || Math.abs(y1 - y2) < 0.1) break;
    const worldShift = excess / (Math.abs(y1 - y2) / 10);
    if (!setCoverflowOffsetY(curOffset + worldShift)) break;
    coverBounds = getProjectedCenterCoverBounds() || getActiveCoverBounds() || coverBounds;
    playbackTop = syncCoverChrome();
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
    const preferredInfoTop = Math.floor(controlsTopLocal - infoBottomMargin - infoLayout.height - desiredBottomGap);
    el.infoPanel.style.top = `${Math.max(minInfoTop, preferredInfoTop)}px`;
  }

  const drawerLeft = Math.round(coverBounds.left);
  const drawerTop = Math.round(coverBounds.top);
  const drawerWidth = Math.max(0, Math.round(coverBounds.right - coverBounds.left));
  const drawerHeight = Math.max(0, Math.round(coverBounds.bottom - coverBounds.top));
  for (const node of [el.songsDrawer, el.songsDrawerBackdrop, el.songInfoModal]) {
    node.style.left = `${drawerLeft}px`;
    node.style.top = `${drawerTop}px`;
    node.style.width = `${drawerWidth}px`;
    node.style.height = `${drawerHeight}px`;
    node.style.maxWidth = `${drawerWidth}px`;
    node.style.maxHeight = `${drawerHeight}px`;
  }
  el.songInfoCard.style.width = `${drawerWidth}px`;
  el.songInfoCard.style.height = `${drawerHeight}px`;
}

function bindEvents() {
  el.btnPlay.addEventListener("click", async () => {
    await apiPost(state.playing ? "/api/player/pause" : "/api/player/play").catch(() =>
      apiPost(state.playing ? "/api/pause" : "/api/resume")
    );
    await refreshPlayer();
  });
  el.btnPrev.addEventListener("click", () => apiPost("/api/player/previous").catch(() => apiPost("/api/previous")).then(refreshPlayer));
  el.btnNext.addEventListener("click", () => apiPost("/api/player/next").catch(() => apiPost("/api/next")).then(refreshPlayer));
  el.btnBrowsePrev.addEventListener("click", () => navigateBrowseBy(-1));
  el.btnBrowseNext.addEventListener("click", () => navigateBrowseBy(1));
  el.browseStrip.addEventListener("input", () => navigateBrowseTo(Number(el.browseStrip.value)));
  el.btnDrawer.addEventListener("click", () => setDrawerOpen(!state.drawerOpen));
  el.btnDrawerClose.addEventListener("click", () => setDrawerOpen(false));
  el.songsDrawerBackdrop.addEventListener("click", () => setDrawerOpen(false));
  el.btnDrawerFavourite.addEventListener("click", toggleDrawerAlbumFavourite);
  el.btnSongInfoClose.addEventListener("click", hideSongInfo);

  el.songsTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(button.dataset.index || 0);
    const action = button.dataset.action;
    if (action === "toggle-song-menu") {
      state.activeSongMenuIndex = state.activeSongMenuIndex === index ? null : index;
      renderSongsDrawer();
    } else if (action === "play-song") {
      await playTrack(state.drawerTracks[index]);
    } else if (action === "show-info" || action === "more-info") {
      showSongInfo(index);
    } else if (action === "play-album") {
      await playAlbum(getCurrentEntry());
    } else if (action === "add-to-playlist") {
      state.settingsStatus = "Playlist support is not available in EchoFlow yet.";
      setStatus(state.settingsStatus);
      window.setTimeout(clearStatus, 1400);
    } else if (action === "toggle-favourite") {
      state.settingsStatus = "Favourites are not available in EchoFlow yet.";
      setStatus(state.settingsStatus);
      window.setTimeout(clearStatus, 1400);
    }
  });
  el.btnInfoMenu.addEventListener("click", () => {
    state.activeInfoMenuMode = state.activeInfoMenuMode === "closed" ? "actions" : "closed";
    renderInfoActionMenu();
  });
  el.infoContextMenu.addEventListener("click", handleInfoAction);

  el.seekTrack.addEventListener("pointerdown", (event) => {
    state.seekDragging = true;
    el.seekTrack.setPointerCapture(event.pointerId);
    seekFromClientX(event.clientX);
  });
  el.seekTrack.addEventListener("pointermove", (event) => {
    if (state.seekDragging) seekFromClientX(event.clientX);
  });
  el.seekTrack.addEventListener("pointerup", () => {
    if (!state.seekDragging) return;
    state.seekDragging = false;
    commitSeek(state.elapsed);
  });

  el.btnVolume.addEventListener("click", () => {
    const open = !el.volumePopover.classList.contains("is-open");
    el.volumePopover.classList.toggle("is-open", open);
    el.volumePopover.setAttribute("aria-hidden", String(!open));
    el.btnVolume.setAttribute("aria-expanded", String(open));
  });
  el.volumeSlider.addEventListener("input", () => setVolume(el.volumeSlider.value));

  el.btnSearch.addEventListener("click", () => setSearchOpen(!state.searchOpen));
  el.btnSearchClose.addEventListener("click", () => setSearchOpen(false));
  el.btnSearchClear.addEventListener("click", async () => {
    el.searchInput.value = "";
    state.searchQuery = "";
    await loadAlbums({ resetIndex: true });
    renderSearchPanel();
  });
  el.searchInput.addEventListener("input", () => {
    state.searchQuery = el.searchInput.value;
    scheduleSearch();
    renderSearchPanel();
  });
  el.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest(".search-result");
    if (!button) return;
    navigateBrowseTo(Number(button.dataset.index || 0));
    setSearchOpen(false);
  });

  el.btnPlayerFullscreen.addEventListener("click", toggleFullscreen);
  let wheelAccum = 0;
  let wheelTimer = 0;
  el.container.addEventListener("wheel", (event) => {
    if (event.target.closest(".song-info-modal, .search-panel, .browse-dropdown")) return;
    const insideDrawer = Boolean(event.target.closest("#songs-drawer"));
    const drawerScrollHost = event.target.closest(".songs-table-wrap");
    const horizontalIntent = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (state.drawerOpen && insideDrawer) {
      if (!horizontalIntent && drawerScrollHost && canWheelScrollElement(drawerScrollHost, event.deltaY)) return;
      if (horizontalIntent && drawerScrollHost && canWheelScrollElementX(drawerScrollHost, event.deltaX)) return;
      event.preventDefault();
      return;
    }

    event.preventDefault();
    wheelAccum += normalizedWheelStep(event);
    const wholeSteps = wheelAccum > 0 ? Math.floor(wheelAccum) : Math.ceil(wheelAccum);
    if (wholeSteps !== 0) {
      navigateBrowseBy(wholeSteps);
      wheelAccum -= wholeSteps;
    }
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => {
      wheelAccum = 0;
    }, 140);
  }, { passive: false });
  el.container.addEventListener("click", (event) => {
    if (handleCoverSurfaceTap(event.target, event.clientX, event.clientY)) {
      event.stopPropagation();
    }
  });
  el.container.addEventListener("dblclick", (event) => {
    if (isCoverCanvasTarget(event.target)) {
      setDrawerOpen(true);
      event.stopPropagation();
    }
  });

  el.browseAlbum.addEventListener("click", () => loadAlbums({ resetIndex: true }).catch(showError));
  el.browseSongs.addEventListener("click", () => toggleDropdown("songs-dropdown"));
  el.browseArtist.addEventListener("click", () => toggleDropdown("artist-dropdown"));
  el.browsePlaylist.addEventListener("click", () => toggleDropdown("playlist-dropdown"));
  el.browseMore.addEventListener("click", () => toggleDropdown("more-dropdown"));
  el.browseSettings.addEventListener("click", () => toggleDropdown("settings-dropdown"));
  for (const dropdown of [el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown]) {
    dropdown.addEventListener("click", handleBrowseMenuAction);
  }
  el.settingsDropdown.addEventListener("click", handleSettingsDropdownClick);
  el.settingsDropdown.addEventListener("submit", handleSettingsSubmit);
  el.settingsDropdown.addEventListener("input", handleSettingsInput);
  el.settingsDropdown.addEventListener("change", handleSettingsInput);

  document.addEventListener("pointerdown", handleOutsideInteraction, true);
  document.addEventListener("click", handleOutsideInteraction);

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") navigateBrowseBy(-1);
    if (event.key === "ArrowRight") navigateBrowseBy(1);
    if (event.key === "Enter") setDrawerOpen(true);
    if (event.key === "Escape") {
      setSearchOpen(false);
      setDrawerOpen(false);
      closeDropdowns();
      hideSongInfo();
    }
  });
}

function handleOutsideInteraction(event) {
  const target = event.target;
  const clickedActiveCover = isCoverCanvasTarget(target) && isPointInsideActiveCover(event.clientX, event.clientY);
  const insideDropdown = Boolean(target.closest?.(".browse-dropdown, .browse-btn"));
  const insideVolume = Boolean(target.closest?.("#volume-wrap, #volume-popover"));
  const insideInfoMenu = Boolean(target.closest?.("#info-panel, #info-context-menu"));
  const insideSongMenu = Boolean(target.closest?.(".song-row-actions"));
  const insideDrawer = Boolean(target.closest?.("#songs-drawer, #btn-drawer"));
  const insideSongInfo = Boolean(target.closest?.("#song-info-modal"));
  const insideSearch = Boolean(target.closest?.("#search-panel, #btn-search"));

  if (!insideDropdown && !insideVolume && !insideInfoMenu && !insideSongMenu) {
    closeTransientMenus();
  }
  if (state.drawerOpen && !insideDrawer && !insideSongInfo && !insideSearch && !insideDropdown && !clickedActiveCover) {
    if (isCoverCanvasTarget(target)) {
      state.suppressCoverTapUntil = Date.now() + 350;
    }
    setDrawerOpen(false);
  }
  if (!insideSongInfo && !insideSongMenu && !insideInfoMenu) {
    hideSongInfo();
  }
  if (state.searchOpen && !insideSearch) {
    setSearchOpen(false);
  }
}

async function handleBrowseMenuAction(event) {
  const item = event.target.closest(".browse-dropdown-item[data-action]");
  if (!item) return;
  const action = item.dataset.action;
  const value = item.dataset.value || "";
  closeDropdowns();
  if (action === "songs-display") {
    state.songsDisplayMode = value === "song" ? "song" : "album";
    if (state.songsDisplayMode === "song") await loadSongBrowse();
    else await loadAlbums({ resetIndex: true });
    return;
  }
  if (action === "playlist-display") {
    state.playlistDisplayMode = value === "song" ? "song" : "album";
    renderBrowseMenus();
    return;
  }
  if (action === "more-panel") {
    state.activeMorePanel = state.activeMorePanel === value ? "" : value;
    renderBrowseMenus();
    return;
  }
  if (action === "more-mode") {
    await loadUnsupportedMode(value);
    return;
  }
  if (action === "songs-all") await loadSongBrowse();
  if (action === "songs-current") await setDrawerOpen(true);
  if (action === "artist") await loadArtistAlbums(value);
  if (action === "play-current-album") await playAlbum(getCurrentEntry());
  if (action === "refresh-library") await loadAlbums({ resetIndex: false });
  if (action === "rescan-library") {
    setStatus("Starting library scan...");
    await apiPost("/api/library/rescan").catch(() => apiPost("/api/rescan"));
    window.setTimeout(() => loadAlbums({ resetIndex: false }).catch(showError), 1000);
  }
  if (action === "refresh-audio") {
    await refreshAudioDevices();
    state.settingsStatus = "Audio devices refreshed.";
    renderBrowseMenus();
  }
  if (action === "genre") {
    state.selectedGenre = value;
    await loadAlbums({ resetIndex: true, filter: `genre:${value}` });
    state.mode = BROWSE_MODE.GENRE;
    renderBrowseMenus();
  }
  if (action === "year") {
    state.selectedYear = value;
    await loadAlbums({ resetIndex: true, filter: `year:${value}` });
    state.mode = BROWSE_MODE.YEAR;
    renderBrowseMenus();
  }
}

async function loadUnsupportedMode(mode) {
  state.mode = mode;
  state.entries = [];
  state.total = 0;
  state.browseIndex = 0;
  state.textures = [];
  state.texturePromises.clear();
  setAlbumData([]);
  state.currentEntry = null;
  const label = {
    [BROWSE_MODE.RATING]: "Top Rated",
    [BROWSE_MODE.STARRED]: "Favourite",
    [BROWSE_MODE.RADIO]: "Radio"
  }[mode] || "Browse";
  el.trackTitle.textContent = label;
  el.trackArtist.textContent = "EchoFlow API support is not available yet";
  updateBrowseStrip();
  renderBrowseMenus();
  positionChrome();
}

async function handleSettingsDropdownClick(event) {
  const actionButton = event.target.closest("button[data-action]");
  if (!actionButton) return;
  event.preventDefault();
  const action = actionButton.dataset.action;
  if (action === "font-down") setAlbumInfoFontScale(state.albumInfoFontScale - 0.1);
  if (action === "font-reset") setAlbumInfoFontScale(1);
  if (action === "font-up") setAlbumInfoFontScale(state.albumInfoFontScale + 0.1);
  if (action === "refresh-audio") {
    await refreshAudioDevices();
    state.settingsStatus = "Audio devices refreshed.";
    renderBrowseMenus();
  }
  if (action === "service-toggle") {
    await toggleService(actionButton.dataset.service);
  }
  if (action === "rescan-library") await rescanLibrary();
  if (action === "rebuild-artwork") await rebuildArtwork();
}

function handleSettingsInput(event) {
  const target = event.target;
  if (!target?.matches?.("#setting-visible, #setting-music-path, #audio-output-route, #audio-output-device, #audio-output-mixer, #setting-album-art")) return;
  if (target.id === "setting-music-path") state.settings.musicDirectory = target.value;
  if (target.id === "audio-output-route") state.settings.audioOutput = target.value;
  if (target.id === "audio-output-device") state.settings.alsaDevice = target.value;
  if (target.id === "audio-output-mixer") state.settings.mixer = target.value;
  if (target.id === "setting-album-art") state.settings.albumArt = target.value;
  if (target.id === "setting-visible") state.settings.visible = target.value;
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  await saveSettings(event.target);
}

async function refreshSettingsData() {
  const [settingsData] = await Promise.all([
    apiGet("/api/settings").catch(() => ({})),
    refreshAudioDevices(),
    refreshServices()
  ]);
  state.settings.musicDirectory =
    settingsData.config?.musicDir ||
    settingsData.settings?.music_directory ||
    state.settings.musicDirectory ||
    "/mnt/music";
  state.settings.audioOutput = settingsData.settings?.audio_output || state.settings.audioOutput || "auto";
  state.settings.albumArt = settingsData.settings?.album_art || state.settings.albumArt || "folder-first";
  state.settings.visible = String(
    settingsData.settings?.visibleCoverCount ||
    settingsData.config?.ui?.visibleCoverCount ||
    state.settings.visible ||
    "0"
  );
  const scan = settingsData.scan || {};
  state.settingsStatus = scan.running
    ? `Library scan: ${scan.message || "running"}`
    : `Library: ${settingsData.counts?.albums ?? state.total ?? 0} albums, ${settingsData.counts?.tracks ?? 0} tracks`;
  state.settingsLoaded = true;
}

async function refreshAudioDevices() {
  const data = await apiGet("/api/audio/devices").catch(() => ({ devices: [] }));
  state.audioDevices = data.devices || [];
  if (data.current?.device) state.settings.alsaDevice = data.current.device;
  if (data.current?.mixer) state.settings.mixer = data.current.mixer;
}

async function refreshServices() {
  const data = await apiGet("/api/services").catch(() => ({ services: {} }));
  state.services = data.services || {};
}

async function saveSettings(form) {
  const formData = new FormData(form);
  state.settings.musicDirectory = String(formData.get("music_directory") || "/mnt/music");
  state.settings.audioOutput = String(formData.get("audio_output") || "default");
  state.settings.alsaDevice = String(formData.get("alsa_device") || "default");
  state.settings.mixer = String(formData.get("mixer") || "software");
  state.settings.albumArt = String(formData.get("album_art") || "folder-first");
  state.settings.visible = String(formData.get("visible") || "0");
  await apiPost("/api/settings", {
    music_directory: state.settings.musicDirectory,
    audio_output: state.settings.audioOutput,
    alsa_device: state.settings.alsaDevice,
    mixer: state.settings.mixer,
    album_art: state.settings.albumArt,
    visibleCoverCount: Number(state.settings.visible)
  });
  await apiPost("/api/audio/output", {
    output: state.settings.audioOutput,
    alsa: state.settings.alsaDevice,
    mixer: state.settings.mixer
  }).catch(() => {});
  state.settingsStatus = "Settings saved.";
  renderBrowseMenus();
}

async function toggleService(service) {
  if (!service) return;
  const current = normalizeServiceState(state.services[service]);
  state.settingsStatus = `${current.active ? "Stopping" : "Starting"} ${service}...`;
  renderBrowseMenus();
  const data = await apiPost("/api/services/control", {
    service,
    action: current.active ? "stop" : "start"
  }).catch((error) => ({ message: error.message || "Service command failed." }));
  await refreshServices();
  state.settingsStatus = data.message || `${service} command sent.`;
  renderBrowseMenus();
}

async function rescanLibrary() {
  state.settingsStatus = "Starting library scan...";
  renderBrowseMenus();
  await apiPost("/api/library/rescan").catch(() => apiPost("/api/rescan"));
  window.setTimeout(() => loadAlbums({ resetIndex: false }).catch(showError), 1000);
}

async function rebuildArtwork() {
  state.settingsStatus = "Rebuilding artwork...";
  renderBrowseMenus();
  const data = await apiPost("/api/library/rebuild-cache").catch(() => ({ message: "Artwork cache rebuild requested." }));
  state.settingsStatus = data.message || "Artwork cache rebuilt.";
  renderBrowseMenus();
}

function setAlbumInfoFontScale(nextScale) {
  state.albumInfoFontScale = clamp(Number(nextScale) || 1, 0.5, 1.6);
  window.localStorage.setItem("echoflow-album-info-font-scale", String(state.albumInfoFontScale));
  renderBrowseMenus();
  positionChrome();
}

function toggleFullscreen() {
  const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenElement) {
    document.exitFullscreen?.();
    document.webkitExitFullscreen?.();
  } else {
    el.app.requestFullscreen?.();
    el.app.webkitRequestFullscreen?.();
  }
}

function syncFullscreenButton() {
  const open = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  document.body.classList.toggle("is-player-fullscreen", open);
  el.btnPlayerFullscreen.setAttribute("aria-pressed", String(open));
  el.btnPlayerFullscreen.querySelector(".icon-fullscreen-enter")?.classList.toggle("hidden", open);
  el.btnPlayerFullscreen.querySelector(".icon-fullscreen-exit")?.classList.toggle("hidden", !open);
  positionChrome();
}

function isCoverCanvasTarget(target) {
  return target?.tagName === "CANVAS";
}

function getActiveCoverHitBox() {
  return getProjectedCenterCoverBounds() || getActiveCoverBounds();
}

function isPointInsideActiveCover(clientX, clientY) {
  const bounds = getActiveCoverHitBox();
  if (!bounds) return false;
  const rect = el.container.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return (
    localX >= bounds.left &&
    localX <= bounds.right &&
    localY >= bounds.top &&
    localY <= bounds.bottom
  );
}

function handleCoverSurfaceTap(target, clientX, clientY) {
  if (!isCoverCanvasTarget(target)) return false;
  const bounds = getActiveCoverHitBox();
  if (!bounds) return false;
  if (Date.now() < state.suppressCoverTapUntil) return true;

  const rect = el.container.getBoundingClientRect();
  const localX = clientX - rect.left;

  if (isPointInsideActiveCover(clientX, clientY)) {
    setDrawerOpen(!state.drawerOpen);
    return true;
  }

  if (state.drawerOpen) return true;

  navigateBrowseBy(localX < bounds.centerX ? -1 : 1);
  return true;
}

function getVolumeIconPath(volume) {
  if (volume <= 0) return "M16.5 12 21 7.5 19.5 6 15 10.5 10.5 6H7v12h3.5l4.5-4.5 4.5 4.5L21 16.5 16.5 12z";
  if (volume < 45) return "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z";
  return "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z";
}

function normalizedWheelStep(event) {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!Number.isFinite(dominantDelta) || dominantDelta === 0) return 0;

  let scale = 0.018;
  if (event.deltaMode === 1) scale = 0.12;
  else if (event.deltaMode === 2) scale = 1.2;

  return clamp(dominantDelta * scale, -1.2, 1.2);
}

function canWheelScrollElement(element, deltaY) {
  if (!element || Math.abs(deltaY) < 0.5) return false;
  const maxScrollTop = element.scrollHeight - element.clientHeight;
  if (maxScrollTop <= 1) return false;
  if (deltaY < 0) return element.scrollTop > 1;
  return element.scrollTop < maxScrollTop - 1;
}

function canWheelScrollElementX(element, deltaX) {
  if (!element || Math.abs(deltaX) < 0.5) return false;
  const maxScrollLeft = element.scrollWidth - element.clientWidth;
  if (maxScrollLeft <= 1) return false;
  if (deltaX < 0) return element.scrollLeft > 1;
  return element.scrollLeft < maxScrollLeft - 1;
}

function formatClock(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setStatus(message) {
  el.statusText.textContent = message;
  el.statusOverlay.classList.remove("hidden");
}

function clearStatus() {
  el.statusOverlay.classList.add("hidden");
}

function showError(error) {
  console.error(error);
  setStatus(error.message || "EchoFlow could not load.");
}

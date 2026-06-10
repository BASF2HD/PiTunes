import {
  initScene,
  onSceneFirstFrame,
  setAlbumData,
  setTextureAtIndex,
  navigateTo,
  jumpTo,
  renderOnce,
  onSnap,
  loadTexture,
  loadRadioTexture,
  createRadioPlaceholderTexture,
  invalidateTexture,
  invalidateRadioTextures,
  getDefaultTexture,
  getSideCount,
  getActiveCoverBounds,
  getTargetIndex,
  setCoverLayoutProfile,
  refitStage,
  getCenterCoverMetrics,
  setCoverflowOffsetY,
  worldToScreenY,
  isSlideAnimating
} from "./renderer.js?v=35";

const RENDERER_COVER_REV = 6;
const RADIO_NO_LOGO_ASSET = "/assets/radio-no-logo.svg?v=2";

function hasRadioFavicon(entry) {
  const raw = String(entry?.artUrl || entry?.favicon || "").trim();
  return Boolean(raw && /^https?:\/\//i.test(raw));
}

const PAGE_SIZE = 200;
const SONGS_BROWSE_LOAD_LIMIT = 5000;
const SEARCH_DELAY_MS = 180;
const RADIO_SEARCH_PAGE_SIZE = 20;

const BROWSE_MODE = Object.freeze({
  ALBUM: "album",
  SONGS: "songs",
  ARTIST: "artist",
  COMPOSER: "composer",
  PLAYLIST: "playlist",
  MORE: "more",
  SETTINGS: "settings",
  SEARCH: "search",
  YEAR: "year",
  GENRE: "genre",
  RATING: "rating",
  STARRED: "starred",
  RADIO: "radio",
  SMART_PLAYLIST: "smart-playlist"
});

const ALBUM_BROWSE_MODES = [
  BROWSE_MODE.ALBUM,
  BROWSE_MODE.ARTIST,
  BROWSE_MODE.COMPOSER,
  BROWSE_MODE.YEAR,
  BROWSE_MODE.GENRE,
  BROWSE_MODE.RATING
];

const SMART_PLAYLIST_STORAGE_KEY = "pitunes-smart-playlists";
const OUTPUT_ROUTE_STORAGE_KEY = "pitunes-output-route";
const MUSIC_FOLDER_STORAGE_KEY = "pitunes-music-folder";
const BROWSE_STATE_STORAGE_KEY = "pitunes-browse-state";
const BROWSER_OUTPUT_ROUTE = "browser";
const HEART_ICON_OUTLINE_PATH =
  "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5 18.5 5 20 6.5 20 8.5c0 2.89-3.14 5.74-7.9 10.05z";
const HEART_ICON_FILLED_PATH =
  "m12 21.35-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54z";
const WHEEL_PIXEL_SCALE = 0.018;
const WHEEL_LINE_SCALE = 0.12;
const WHEEL_PAGE_SCALE = 1.2;
const WHEEL_MAX_STEP = 1.2;
const SMART_RULE_FIELDS = [
  ["album", "Album"],
  ["albumArtist", "Album Artist"],
  ["artist", "Artist"],
  ["bitRate", "Bit Rate"],
  ["bpm", "BPM"],
  ["category", "Category"],
  ["comments", "Comments"],
  ["compilation", "Compilation"],
  ["composer", "Composer"],
  ["dateAdded", "Date Added"],
  ["dateModified", "Date Modified"],
  ["description", "Description"],
  ["discNumber", "Disc Number"],
  ["genre", "Genre"],
  ["grouping", "Grouping"],
  ["kind", "Kind"],
  ["lastPlayed", "Last Played"],
  ["lastSkipped", "Last Skipped"],
  ["location", "Location"],
  ["mediaKind", "Media Kind"],
  ["movementName", "Movement Name"],
  ["movementNumber", "Movement Number"],
  ["playlist", "Playlist"],
  ["plays", "Plays"],
  ["purchased", "Purchased"],
  ["rating", "Rating"],
  ["sampleRate", "Sample Rate"],
  ["size", "Size"],
  ["skips", "Skips"],
  ["sortAlbum", "Sort Album"],
  ["sortAlbumArtist", "Sort Album Artist"],
  ["sortArtist", "Sort Artist"],
  ["sortComposer", "Sort Composer"],
  ["sortShow", "Sort Show"],
  ["sortTitle", "Sort Title"],
  ["ticked", "Ticked"],
  ["time", "Time"],
  ["title", "Title"],
  ["year", "Year"]
];
const SMART_RULE_OPERATORS = [
  ["is", "is"],
  ["is-not", "is not"],
  ["contains", "contains"],
  ["does-not-contain", "does not contain"],
  ["greater-than", "is greater than"],
  ["less-than", "is less than"],
  ["in-range", "is in the range"]
];
const SMART_LIMIT_SORTS = [
  ["random", "random"],
  ["album", "album"],
  ["artist", "artist"],
  ["genre", "genre"],
  ["title", "title"],
  ["highest-rating", "highest rating"],
  ["lowest-rating", "lowest rating"],
  ["most-recently-played", "most recently played"],
  ["least-recently-played", "least recently played"],
  ["most-often-played", "most often played"],
  ["least-often-played", "least often played"],
  ["most-recently-added", "most recently added"],
  ["least-recently-added", "least recently added"]
];
const TEXT_INPUT_SELECTOR = [
  "input[type='text']",
  "input[type='search']",
  "input[type='password']",
  "input[type='url']",
  "input[type='email']",
  "input:not([type])",
  "textarea"
].join(",");
const TOUCH_KEYBOARD_ROWS = {
  letters: [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["shift", "z", "x", "c", "v", "b", "n", "m", "backspace"],
    ["symbols", ".", "-", "_", "space", "done"]
  ],
  symbols: [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["!", "@", "#", "$", "%", "^", "&", "*", "(", ")"],
    ["-", "_", "+", "=", "/", "\\", ":", ";", "?", "backspace"],
    [".", ",", "'", "\"", "`", "~", "|", "[", "]"],
    ["abc", ".", "-", "_", "space", "done"]
  ]
};

const state = {
  mode: BROWSE_MODE.ALBUM,
  entries: [],
  total: 0,
  browseIndex: 0,
  currentEntry: null,
  textures: [],
  texturePromises: new Map(),
  artCacheVersion: 0,
  albumMeta: new Map(),
  loadingMore: false,
  drawerOpen: false,
  drawerLoading: false,
  drawerTitle: "Songs",
  drawerSubtitle: "",
  drawerTracks: [],
  activeSongMenuIndex: null,
  activeRadioSearchMenuIndex: null,
  infoTrackIndex: null,
  searchOpen: false,
  searchQuery: "",
  searchLoading: false,
  activeDropdown: null,
  browseMenuSuppressOpen: { dropdownId: "", until: 0 },
  activeMorePanel: "",
  activeArtistPanel: "",
  activeInfoMenuMode: "closed",
  coverDrag: {
    active: false,
    pointerId: null,
    source: "",
    startX: 0,
    startY: 0,
    lastX: 0,
    accumulatedX: 0,
    moved: false
  },
  smartPlaylists: loadSmartPlaylists(),
  smartPlaylistDraft: null,
  activeSmartPlaylistId: "",
  smartPlaylistTracks: [],
  selectedArtist: "",
  selectedComposer: "",
  selectedGenre: "",
  selectedYear: "",
  albumFilter: "",
  albumBrowseScope: "all",
  albumBrowseSort: "title",
  favouriteTracks: new Set(),
  favouriteAlbums: new Set(),
  favouriteAlbumIdsFromTracks: new Set(),
  starredTracksCache: [],
  playlists: [],
  activePlaylistId: "",
  playlistCreateSubject: null,
  songsDisplayMode: "album",
  songsBrowseScope: "all",
  songsBrowseSort: "title",
  playlistDisplayMode: "album",
  albumInfoFontScale: Number(window.localStorage.getItem("pitunes-album-info-font-scale") || 1),
  artists: [],
  composers: [],
  genres: [],
  years: [],
  settingsLoaded: false,
  settingsStatus: "",
  settingsOpenPicker: "",
  audioSettingsApplied: null,
  libraryScan: {
    running: false,
    progress: 0,
    message: "",
    lastError: "",
    albumCount: 0
  },
  deviceAudioOutput: "hdmi",
  dacHats: [],
  settings: {
    musicDirectory: window.localStorage.getItem(MUSIC_FOLDER_STORAGE_KEY) || "/mnt/music",
    storageSource: "local",
    audioOutput: window.localStorage.getItem(OUTPUT_ROUTE_STORAGE_KEY) || "hdmi",
    dacHat: "",
    alsaDevice: "default",
    mixer: "software",
    visible: "0"
  },
  folderBrowser: {
    currentPath: "/mnt/music",
    roots: [],
    entries: [],
    loading: false,
    error: "",
    mode: "browse",
    selectedSource: "local",
    selectedDevice: ""
  },
  radioScope: "favourites",
  radioInternetSearch: false,
  radioSearchLoading: false,
  radioSearchLoadingMore: false,
  radioSearchHasMore: false,
  radioSearchError: "",
  searchResults: [],
  lastRemoteUiRevision: 0,
  lastRemotePlaybackKey: "",
  activeRemoteSessionKey: "",
  pendingRemoteBrowseCtx: null,
  localUiLockUntil: 0,
  applyingRemoteUi: false,
  system: {
    info: null,
    update: {
      checking: false,
      applying: false,
      supported: true,
      available: false,
      current: "",
      latest: "",
      currentVersion: "",
      message: ""
    }
  },
  wifi: {
    status: null,
    networks: [],
    selectedSsid: "",
    password: "",
    country: "GB",
    credentialsSaved: false,
    loading: false,
    message: "",
    showPassword: false,
    configureOpen: false
  },
  touchKeyboard: {
    open: false,
    targetId: "",
    shift: false,
    symbols: false,
    caretPosition: 0,
    openDelayTimer: 0
  },
  confirmDialog: {
    resolve: null
  },
  audioDevices: [],
  services: {},
  playing: false,
  volume: 60,
  duration: 0,
  elapsed: 0,
  timelineUpdatedAt: Date.now(),
  seekDragging: false,
  currentSong: null,
  inputSource: "local",
  externalSourceActive: false,
  externalArtUrl: "",
  externalCoverIndex: -1,
  externalCoverAppliedIndex: -1,
  externalPollutedIndices: new Set(),
  externalTransportLockUntil: 0,
  localTransportLockUntil: 0,
  browserQueue: [],
  browserQueueIndex: -1,
  playlistLength: 0,
  suppressCoverTapUntil: 0,
};

applyStoredBrowsePrefsToState(readBrowseState());

function readBrowseState() {
  try {
    const raw = window.localStorage.getItem(BROWSE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved && typeof saved === "object" ? saved : null;
  } catch (_error) {
    return null;
  }
}

function getBrowseStateSnapshot() {
  const entry = state.entries[state.browseIndex];
  return {
    mode: state.mode,
    albumBrowseScope: state.albumBrowseScope,
    albumBrowseSort: state.albumBrowseSort,
    songsBrowseScope: state.songsBrowseScope,
    songsDisplayMode: state.songsDisplayMode,
    songsBrowseSort: state.songsBrowseSort,
    playlistDisplayMode: state.playlistDisplayMode,
    albumFilter: state.albumFilter,
    selectedArtist: state.selectedArtist,
    selectedComposer: state.selectedComposer,
    selectedGenre: state.selectedGenre,
    selectedYear: state.selectedYear,
    activePlaylistId: state.activePlaylistId,
    activeSmartPlaylistId: state.activeSmartPlaylistId,
    browseIndex: state.browseIndex,
    entryId: entry?.id ? String(entry.id) : ""
  };
}

function saveBrowseState() {
  try {
    window.localStorage.setItem(BROWSE_STATE_STORAGE_KEY, JSON.stringify(getBrowseStateSnapshot()));
  } catch (_error) {
    // Ignore storage failures in kiosk/private mode.
  }
}

function resolvePlaybackUiMode() {
  if (!state.playing || !state.currentSong) return state.mode;
  if (isRadioPlaybackTrack(state.currentSong)) return BROWSE_MODE.RADIO;
  if (state.mode === BROWSE_MODE.SONGS) return BROWSE_MODE.SONGS;
  if (state.mode === BROWSE_MODE.PLAYLIST) return BROWSE_MODE.PLAYLIST;
  return BROWSE_MODE.ALBUM;
}

function resolvePlaybackInputSource() {
  if (!state.playing || !state.currentSong) return state.inputSource || "local";
  return isRadioPlaybackTrack(state.currentSong) ? "radio" : "local";
}

function resolveRemoteBrowseMode(ctx) {
  if (!ctx) return BROWSE_MODE.ALBUM;
  const playbackKey = String(ctx.playbackKey || "");
  const keyIsRadioStream = ctx.playing && /^https?:\/\//i.test(playbackKey);

  // Published mode is the source of truth for cross-device playback sync.
  if (ctx.playing && ctx.mode) {
    if (ctx.mode === BROWSE_MODE.RADIO || ctx.playbackKind === "radio") return BROWSE_MODE.RADIO;
    if (ctx.mode === BROWSE_MODE.SONGS || ctx.playbackKind === "songs") return BROWSE_MODE.SONGS;
    if (ctx.mode === BROWSE_MODE.PLAYLIST || ctx.playbackKind === "playlist") return BROWSE_MODE.PLAYLIST;
    if (ctx.mode === BROWSE_MODE.ALBUM || ctx.playbackKind === "album") return BROWSE_MODE.ALBUM;
  }

  if (keyIsRadioStream || ctx.playbackKind === "radio") return BROWSE_MODE.RADIO;
  if (ctx.mode === BROWSE_MODE.SONGS) return BROWSE_MODE.SONGS;
  if (ctx.mode === BROWSE_MODE.PLAYLIST) return BROWSE_MODE.PLAYLIST;
  return ctx.mode || BROWSE_MODE.ALBUM;
}

function remoteSessionOverridesLocalMpd() {
  if (!state.activeRemoteSessionKey) return false;
  const mpdKey = localPlaybackKey();
  if (!mpdKey) return true;
  return mpdKey !== state.activeRemoteSessionKey;
}

function markLocalPlaybackOwner() {
  state.activeRemoteSessionKey = "";
}

function remotePlaybackKey(ctx) {
  return String(ctx?.playbackKey || "").trim();
}

function localPlaybackKey() {
  if (!state.playing || !state.currentSong) return "";
  return radioPlaybackKey(state.currentSong) || String(state.currentSong?.file || state.currentSong?.id || "").trim();
}

function buildUiContextPayload() {
  const entry = state.entries[state.browseIndex];
  const mode = resolvePlaybackUiMode();
  const playbackKind = mode === BROWSE_MODE.RADIO ? "radio" : mode === BROWSE_MODE.SONGS ? "songs" : "album";
  return {
    revision: Date.now(),
    mode,
    playbackKind,
    albumBrowseScope: state.albumBrowseScope,
    albumBrowseSort: state.albumBrowseSort,
    songsBrowseScope: state.songsBrowseScope,
    songsDisplayMode: state.songsDisplayMode,
    songsBrowseSort: state.songsBrowseSort,
    radioScope: state.radioScope,
    playlistDisplayMode: state.playlistDisplayMode,
    albumFilter: state.albumFilter || "",
    selectedArtist: state.selectedArtist || "",
    selectedComposer: state.selectedComposer || "",
    selectedGenre: state.selectedGenre || "",
    selectedYear: state.selectedYear || "",
    activePlaylistId: state.activePlaylistId || "",
    activeSmartPlaylistId: state.activeSmartPlaylistId || "",
    browseIndex: state.browseIndex,
    entryId: entry?.id ? String(entry.id) : "",
    entryTitle: entry?.title || entry?.album || state.currentSong?.album || state.currentSong?.title || "",
    inputSource: resolvePlaybackInputSource(),
    playbackKey: radioPlaybackKey(state.currentSong) || state.currentSong?.file || state.currentSong?.id || "",
    playing: Boolean(state.playing)
  };
}

function lockLocalUiSync(ms = 5000) {
  state.localUiLockUntil = Date.now() + ms;
}

function publishUiContextNow() {
  if (state.applyingRemoteUi || !state.playing) return Promise.resolve();
  markLocalPlaybackOwner();
  lockLocalUiSync(8000);
  const payload = buildUiContextPayload();
  state.lastRemotePlaybackKey = remotePlaybackKey(payload);
  return apiPost("/api/ui/context", payload).catch(() => {});
}

function resolveBrowseIndexFromContext(ctx) {
  if (!ctx || !state.entries.length) return -1;

  if (ctx.entryId) {
    const byId = state.entries.findIndex((entry) => String(entry.id) === String(ctx.entryId));
    if (byId >= 0) return byId;
  }

  const labels = [ctx.entryTitle, ctx.playbackKey].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  for (const label of labels) {
    if (!label) continue;
    const byLabel = state.entries.findIndex((entry) => {
      const candidates = [entry.id, entry.title, entry.album, entry.albumId, entry.streamUrl, entry.file]
        .filter(Boolean)
        .map((value) => String(value).trim().toLowerCase());
      return candidates.includes(label);
    });
    if (byLabel >= 0) return byLabel;
  }

  if (ctx.playing && state.currentSong) {
    const fromSong = currentPlayingBrowseIndex();
    if (fromSong >= 0) return fromSong;
  }

  if (Number.isFinite(ctx.browseIndex)) {
    return clamp(ctx.browseIndex, 0, state.entries.length - 1);
  }

  return -1;
}

function focusBrowseEntryFromContext(ctx, { immediate = false } = {}) {
  const index = resolveBrowseIndexFromContext(ctx);
  if (index < 0) return false;
  navigateBrowseTo(index, { immediate, suppressSnapBack: true });
  return true;
}

async function finalizeBrowseSyncAfterPlayer() {
  if (!state.pendingRemoteBrowseCtx) return;
  const ctx = state.pendingRemoteBrowseCtx;
  state.pendingRemoteBrowseCtx = null;
  if (!focusBrowseEntryFromContext(ctx, { immediate: true })) {
    syncBrowseToPlayingSong({ immediate: true });
  }
}

async function syncBrowseFromRemoteContext(ctx) {
  const mode = resolveRemoteBrowseMode(ctx);

  if (mode === BROWSE_MODE.RADIO) {
    const scope = ctx.radioScope === "all" ? "all" : "favourites";
    if (state.mode !== BROWSE_MODE.RADIO || state.radioScope !== scope) {
      await loadRadioBrowse(scope);
    }
    if (ctx.playing) syncBrowseToPlayingSong({ immediate: true });
    else focusBrowseEntryFromContext(ctx, { immediate: true });
    renderBrowseMenus();
    return;
  }

  if (mode === BROWSE_MODE.SONGS) {
    if (ctx.songsDisplayMode === "album" || ctx.songsDisplayMode === "song") {
      state.songsDisplayMode = ctx.songsDisplayMode;
    }
    if (["title", "year-asc", "year-desc"].includes(ctx.songsBrowseSort)) {
      state.songsBrowseSort = ctx.songsBrowseSort;
    }
    const scope = ctx.songsBrowseScope === "favourite" ? "favourite" : "all";
    if (state.mode !== BROWSE_MODE.SONGS || state.songsBrowseScope !== scope) {
      await loadSongBrowse(scope);
    } else {
      applySongsBrowseSort({ jump: false, preserveFocus: false });
    }
    focusBrowseEntryFromContext(ctx, { immediate: true });
    renderBrowseMenus();
    return;
  }

  if (mode === BROWSE_MODE.ALBUM) {
    const scope = ctx.albumBrowseScope === "favourite" ? "favourite" : "all";
    if (["title", "year-asc", "year-desc"].includes(ctx.albumBrowseSort)) {
      state.albumBrowseSort = ctx.albumBrowseSort;
    }
    if (state.mode !== BROWSE_MODE.ALBUM || state.albumBrowseScope !== scope) {
      await loadAlbumBrowse(scope);
    } else {
      applyAlbumBrowseSort({ jump: false, preserveFocus: false });
    }
    focusBrowseEntryFromContext(ctx, { immediate: true });
    renderBrowseMenus();
    return;
  }

  if (mode === BROWSE_MODE.PLAYLIST && ctx.activePlaylistId) {
    if (state.mode !== BROWSE_MODE.PLAYLIST || state.activePlaylistId !== ctx.activePlaylistId) {
      await loadRegularPlaylist(ctx.activePlaylistId);
    }
    focusBrowseEntryFromContext(ctx, { immediate: true });
    renderBrowseMenus();
    return;
  }

  if (ctx?.playing) {
    syncBrowseToPlayingSong({ immediate: true });
  }
}

function shouldApplyRemotePlayback(ctx) {
  if (!ctx?.playing) return false;
  const remoteKey = remotePlaybackKey(ctx);
  if (!remoteKey || remoteKey === state.lastRemotePlaybackKey) return false;
  if (Date.now() < state.localUiLockUntil) return false;

  const localKey = localPlaybackKey();
  if (localKey && localKey === remoteKey) return false;

  // Browser output plays locally on this device — ignore conflicting shared/remote state.
  if (isBrowserPlayback() && state.playing && localKey && localKey !== remoteKey) {
    return false;
  }

  return true;
}

async function applyRemoteUiContext(ctx) {
  if (!ctx || !Number(ctx.revision)) return;
  if (!shouldApplyRemotePlayback(ctx)) return;
  if (state.applyingRemoteUi) return;

  state.applyingRemoteUi = true;
  state.lastRemoteUiRevision = Number(ctx.revision);
  state.lastRemotePlaybackKey = remotePlaybackKey(ctx);
  state.activeRemoteSessionKey = remotePlaybackKey(ctx);
  state.pendingRemoteBrowseCtx = ctx;
  try {
    await syncBrowseFromRemoteContext(ctx);
  } finally {
    state.applyingRemoteUi = false;
  }
}

async function followLocalPlaybackBrowse(previousSongKey, currentSongKey) {
  if (state.applyingRemoteUi) return;
  if (!state.playing || !state.currentSong) return;
  if (previousSongKey && currentSongKey && previousSongKey === currentSongKey) return;

  if (isRadioInputActive() || isRadioPlaybackTrack(state.currentSong)) {
    if (state.mode !== BROWSE_MODE.RADIO) {
      await loadRadioBrowse(state.radioScope || "all");
      syncBrowseToPlayingSong({ immediate: true });
      renderBrowseMenus();
    }
    return;
  }

  if (isExternalInputActive()) return;

  if (state.mode !== BROWSE_MODE.ALBUM && state.mode !== BROWSE_MODE.SONGS) {
    await loadAlbumBrowse(state.albumBrowseScope || "all");
    syncBrowseToPlayingSong({ immediate: true });
    renderBrowseMenus();
  }
}

function applyStoredBrowsePrefsToState(saved) {
  if (!saved) return;
  const allowedModes = new Set(Object.values(BROWSE_MODE));
  if (allowedModes.has(saved.mode)) state.mode = saved.mode;
  if (saved.albumBrowseScope === "favourite" || saved.albumBrowseScope === "all") {
    state.albumBrowseScope = saved.albumBrowseScope;
  }
  if (["title", "year-asc", "year-desc"].includes(saved.albumBrowseSort)) {
    state.albumBrowseSort = saved.albumBrowseSort;
  }
  if (saved.songsBrowseScope === "favourite" || saved.songsBrowseScope === "all") {
    state.songsBrowseScope = saved.songsBrowseScope;
  }
  if (saved.songsDisplayMode === "album" || saved.songsDisplayMode === "song") {
    state.songsDisplayMode = saved.songsDisplayMode;
  }
  if (["title", "year-asc", "year-desc"].includes(saved.songsBrowseSort)) {
    state.songsBrowseSort = saved.songsBrowseSort;
  } else if (["title", "year-asc", "year-desc"].includes(saved.songsFavouriteSort)) {
    state.songsBrowseSort = saved.songsFavouriteSort;
  }
  if (saved.playlistDisplayMode === "album" || saved.playlistDisplayMode === "song") {
    state.playlistDisplayMode = saved.playlistDisplayMode;
  }
  if (typeof saved.albumFilter === "string") state.albumFilter = saved.albumFilter;
  if (typeof saved.selectedArtist === "string") state.selectedArtist = saved.selectedArtist;
  if (typeof saved.selectedComposer === "string") state.selectedComposer = saved.selectedComposer;
  if (typeof saved.selectedGenre === "string") state.selectedGenre = saved.selectedGenre;
  if (typeof saved.selectedYear === "string") state.selectedYear = saved.selectedYear;
  if (typeof saved.activePlaylistId === "string") state.activePlaylistId = saved.activePlaylistId;
  if (typeof saved.activeSmartPlaylistId === "string") state.activeSmartPlaylistId = saved.activeSmartPlaylistId;
}

function restoreBrowseIndex(saved) {
  if (!saved) return;
  const entryId = String(saved.entryId || "");
  let restored = false;
  if (entryId) {
    const index = state.entries.findIndex((entry) => String(entry.id) === entryId);
    if (index >= 0) {
      state.browseIndex = index;
      restored = true;
    }
  }
  if (!restored && Number.isFinite(saved.browseIndex)) {
    state.browseIndex = clamp(saved.browseIndex, 0, Math.max(0, state.entries.length - 1));
    restored = state.entries.length > 0;
  }
  if (restored) {
    presentLibraryEntries({ jump: true });
    saveBrowseState();
  }
}

async function restorePersistedBrowse(quiet = false) {
  const saved = readBrowseState();
  if (!saved?.mode) {
    await loadAlbums({ resetIndex: true, quiet });
    return;
  }

  applyStoredBrowsePrefsToState(saved);

  try {
    switch (saved.mode) {
      case BROWSE_MODE.SONGS:
        await loadSongBrowse(saved.songsBrowseScope || "all");
        break;
      case BROWSE_MODE.ALBUM:
        await loadAlbumBrowse(saved.albumBrowseScope || "all");
        break;
      case BROWSE_MODE.ARTIST:
        if (saved.selectedArtist) await loadArtistAlbums(saved.selectedArtist);
        else await loadAlbumBrowse("all");
        break;
      case BROWSE_MODE.COMPOSER:
        if (saved.selectedComposer) await loadComposerAlbums(saved.selectedComposer);
        else await loadAlbumBrowse("all");
        break;
      case BROWSE_MODE.YEAR:
        if (saved.selectedYear) {
          state.selectedYear = saved.selectedYear;
          await loadAlbums({ resetIndex: true, filter: `year:${saved.selectedYear}`, mode: BROWSE_MODE.YEAR, quiet });
        } else {
          await loadAlbumBrowse("all");
        }
        break;
      case BROWSE_MODE.GENRE:
        if (saved.selectedGenre) {
          state.selectedGenre = saved.selectedGenre;
          await loadAlbums({ resetIndex: true, filter: `genre:${saved.selectedGenre}`, mode: BROWSE_MODE.GENRE, quiet });
        } else {
          await loadAlbumBrowse("all");
        }
        break;
      case BROWSE_MODE.RATING:
        await loadAlbums({ resetIndex: true, filter: "toprated", mode: BROWSE_MODE.RATING, quiet });
        break;
      case BROWSE_MODE.STARRED:
        await loadStarredBrowse();
        break;
      case BROWSE_MODE.RADIO:
        await loadRadioBrowse();
        break;
      case BROWSE_MODE.PLAYLIST:
        if (saved.activePlaylistId && state.playlists.some((item) => item.id === saved.activePlaylistId)) {
          await loadRegularPlaylist(saved.activePlaylistId);
        } else {
          await loadAlbumBrowse("all");
        }
        break;
      case BROWSE_MODE.SMART_PLAYLIST:
        if (saved.activeSmartPlaylistId && state.smartPlaylists.some((item) => item.id === saved.activeSmartPlaylistId)) {
          await loadSmartPlaylist(saved.activeSmartPlaylistId);
        } else {
          await loadAlbumBrowse("all");
        }
        break;
      default:
        await loadAlbumBrowse(saved.albumBrowseScope || "all");
    }
    restoreBrowseIndex(saved);
  } catch (_error) {
    await loadAlbums({ resetIndex: true, quiet });
  }
}

const albumDrawerTrackCache = new Map();
let lastDrawerEntryKey = "";
let drawerPrepareToken = 0;

let snapBackTimerId = 0;
let scanPollTimerId = 0;
let scanPollGeneration = 0;
let lastProgressiveAlbumTotal = -1;
let lastProgressiveAlbumRefreshAt = 0;
let settingsAutosaveTimerId = 0;

const el = {
  app: document.getElementById("app"),
  chromeTop: document.getElementById("player-chrome-top"),
  stage: document.getElementById("player-stage"),
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
  btnFsPrev: document.getElementById("btn-fs-prev"),
  btnFsPlay: document.getElementById("btn-fs-play"),
  btnFsNext: document.getElementById("btn-fs-next"),
  fullscreenTransport: document.getElementById("fullscreen-transport"),
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
  songDrawerContextMenu: document.getElementById("song-drawer-context-menu"),
  radioSearchContextMenu: document.getElementById("radio-search-context-menu"),
  songInfoModal: document.getElementById("song-info-modal"),
  songInfoCard: document.querySelector("#song-info-modal .song-info-card"),
  songInfoContent: document.getElementById("song-info-content"),
  songInfoEyebrow: document.getElementById("song-info-eyebrow"),
  songInfoTitle: document.getElementById("song-info-title"),
  btnSongInfoClose: document.getElementById("btn-song-info-close"),
  systemInfoModal: document.getElementById("system-info-modal"),
  systemInfoContent: document.getElementById("system-info-content"),
  systemInfoEyebrow: document.getElementById("system-info-eyebrow"),
  systemInfoTitle: document.getElementById("system-info-title"),
  btnSystemInfoClose: document.getElementById("btn-system-info-close"),
  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  iconFsPlay: document.getElementById("icon-fs-play"),
  iconFsPause: document.getElementById("icon-fs-pause"),
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
  searchResults: document.getElementById("search-results"),
  btnRadioSearchMore: document.getElementById("btn-radio-search-more"),
  btnVolume: document.getElementById("btn-volume"),
  volumePopover: document.getElementById("volume-popover"),
  volumeIconPath: document.getElementById("volume-icon-path"),
  volumeSlider: document.getElementById("volume-slider"),
  audioPlayer: document.getElementById("audio-player"),
  controls: document.getElementById("controls"),
  controlsMain: document.getElementById("controls-main"),
  transport: document.getElementById("transport"),
  browseBarShell: document.getElementById("browse-bar-shell"),
  browseBar: document.getElementById("browse-bar"),
  statusOverlay: document.getElementById("status-overlay"),
  statusText: document.getElementById("status-text"),
  touchKeyboard: document.getElementById("touch-keyboard"),
  browseAlbum: document.getElementById("browse-album"),
  albumDropdown: document.getElementById("album-dropdown"),
  browseSongs: document.getElementById("browse-songs"),
  songsDropdown: document.getElementById("songs-dropdown"),
  browseArtist: document.getElementById("browse-artist"),
  artistDropdown: document.getElementById("artist-dropdown"),
  browsePlaylist: document.getElementById("browse-playlist"),
  playlistDropdown: document.getElementById("playlist-dropdown"),
  browseMore: document.getElementById("browse-more"),
  moreDropdown: document.getElementById("more-dropdown"),
  browseSettings: document.getElementById("browse-settings"),
  settingsDropdown: document.getElementById("settings-dropdown"),
  folderBrowserModal: document.getElementById("folder-browser-modal"),
  folderBrowserPathForm: document.getElementById("folder-browser-path-form"),
  folderBrowserPath: document.getElementById("folder-browser-path"),
  folderBrowserRoots: document.getElementById("folder-browser-roots"),
  folderBrowserList: document.getElementById("folder-browser-list"),
  folderBrowserStatus: document.getElementById("folder-browser-status"),
  btnFolderBrowserClose: document.getElementById("btn-folder-browser-close"),
  folderBrowserCancel: document.getElementById("folder-browser-cancel"),
  folderBrowserUse: document.getElementById("folder-browser-use"),
  playlistModal: document.getElementById("playlist-modal"),
  playlistForm: document.getElementById("playlist-form"),
  playlistNameInput: document.getElementById("playlist-name-input"),
  playlistCreatePreview: document.getElementById("playlist-create-preview"),
  playlistCancel: document.getElementById("playlist-cancel"),
  smartPlaylistModal: document.getElementById("smart-playlist-modal"),
  smartPlaylistForm: document.getElementById("smart-playlist-form"),
  smartPlaylistName: document.getElementById("smart-playlist-name"),
  smartMatchEnabled: document.getElementById("smart-match-enabled"),
  smartMatchMode: document.getElementById("smart-match-mode"),
  smartRuleList: document.getElementById("smart-rule-list"),
  smartAddRule: document.getElementById("smart-add-rule"),
  smartLimitEnabled: document.getElementById("smart-limit-enabled"),
  smartLimitCount: document.getElementById("smart-limit-count"),
  smartLimitSort: document.getElementById("smart-limit-sort"),
  smartLiveUpdating: document.getElementById("smart-live-updating"),
  smartPlaylistPreview: document.getElementById("smart-playlist-preview"),
  smartPlaylistCancel: document.getElementById("smart-playlist-cancel"),
  confirmModal: document.getElementById("confirm-modal"),
  confirmDialogTitle: document.getElementById("confirm-dialog-title"),
  confirmDialogMessage: document.getElementById("confirm-dialog-message"),
  confirmDialogCancel: document.getElementById("confirm-dialog-cancel"),
  confirmDialogConfirm: document.getElementById("confirm-dialog-confirm")
};

const browseButtons = [
  el.browseAlbum,
  el.browseSongs,
  el.browseArtist,
  el.browsePlaylist,
  el.browseMore,
  el.browseSettings
].filter(Boolean);

const PITUNES_VERSION_FALLBACK = "1.2.0";

function normalizePiTunesVersion(version) {
  const raw = String(version || "").trim();
  if (!raw || raw === "dev" || raw === "unknown") return PITUNES_VERSION_FALLBACK;
  return raw.replace(/^v/i, "");
}

function formatPiTunesVersionLabel(pitunes = {}) {
  const version = normalizePiTunesVersion(pitunes.version);
  const build = String(pitunes.commit || "").trim();
  if (build && build !== "unknown") return `${version} (${build})`;
  return version;
}

function buildSystemInfoRows(info = {}) {
  const disk = info.rootDisk || {};
  const mem = info.memory || {};
  const os = info.os || {};
  const pitunes = info.pitunes || {};
  const diskLabel = disk.usePercent ? `${disk.used} / ${disk.size} (${disk.usePercent})` : "Unknown";
  const memLabel = mem.used ? `${mem.used} / ${mem.total}` : "Unknown";
  return renderInfoGrid([
    ["PiTunes", formatPiTunesVersionLabel(pitunes)],
    ["Channel", pitunes.channel || "stable"],
    ["Hostname", info.hostname || "Unknown"],
    ["Uptime", info.uptime || "Unknown"],
    ["Operating System", os.name || "Unknown"],
    ["Kernel", info.kernel || "Unknown"],
    ["Architecture", info.architecture || "Unknown"],
    ["Board", info.board || "Unknown"],
    ["CPU Temperature", info.temperature || "Unknown"],
    ["Root Disk", diskLabel],
    ["Memory", memLabel],
    ["Python", info.python || "Unknown"],
    ["API Version", info.apiVersion || "Unknown"]
  ]);
}

async function refreshSystemInfo() {
  const data = await apiGet("/api/system/info").catch(() => null);
  if (data) state.system.info = data;
  return data;
}

function applySystemUpdateStatus(data = {}) {
  state.system.update = {
    ...state.system.update,
    checking: false,
    supported: data.supported !== false,
    available: Boolean(data.available),
    current: data.current || "",
    latest: data.latest || "",
    currentVersion: data.currentVersion || "",
    message: data.message || ""
  };
}

function systemInstalledVersionLabel() {
  const pitunes = state.system.info?.pitunes || {};
  const version = pitunes.version || state.system.update.currentVersion || "";
  const commit = pitunes.commit || state.system.update.current || "";
  return formatPiTunesVersionLabel({ version, commit });
}

function systemUpdateStatusText() {
  const update = state.system.update;
  if (update.applying) return "Installing update…";
  if (update.checking) return "Checking for updates…";
  return update.message || (update.supported ? "Tap Check Update." : "Software updates are not available for this installation.");
}

async function refreshSystemUpdateStatus() {
  const data = await apiGet("/api/system/update/status").catch(() => null);
  if (data) applySystemUpdateStatus(data);
  return data;
}

async function checkSystemUpdate() {
  state.system.update.checking = true;
  state.system.update.message = "Checking for updates…";
  if (state.activeDropdown === "settings-dropdown" && !shouldDeferSettingsRerender()) {
    renderBrowseMenus();
  }
  const data = await apiPost("/api/system/update/check", {}).catch((error) => ({
    supported: false,
    available: false,
    message: error.message || "Update check failed."
  }));
  applySystemUpdateStatus(data);
  if (state.activeDropdown === "settings-dropdown" && !shouldDeferSettingsRerender()) {
    renderBrowseMenus();
  }
}

function showSystemInfoModal() {
  const info = state.system.info;
  if (!info) {
    refreshSystemInfo().then((data) => {
      if (data) showSystemInfoModal();
    });
    return;
  }
  if (el.systemInfoTitle) el.systemInfoTitle.textContent = "About This System";
  if (el.systemInfoContent) {
    el.systemInfoContent.innerHTML = `<div class="song-info-grid system-info-grid">${buildSystemInfoRows(info)}</div>`;
  }
  el.systemInfoModal?.classList.remove("hidden");
  el.systemInfoModal?.setAttribute("aria-hidden", "false");
}

function hideSystemInfoModal() {
  el.systemInfoModal?.classList.add("hidden");
  el.systemInfoModal?.setAttribute("aria-hidden", "true");
}

let layoutPlayerFrame = 0;
let layoutObserver = null;
// Stage size cache — refitStage() kills coverflow GSAP tweens; only refit on resize.
// See renderer.js "COVERFLOW ANIMATION — DO NOT MODIFY" block before changing this.
let lastStageLayoutWidth = 0;
let lastStageLayoutHeight = 0;
let lastLayoutCoverBounds = null;
let kioskFullscreenSuppressed = false;

function rememberLayoutCoverBounds(bounds) {
  if (bounds && bounds.width > 0 && bounds.height > 0) {
    lastLayoutCoverBounds = { ...bounds };
  }
}

function synthesizeLayoutCoverBounds() {
  if (!el.container) return null;
  const containerWidth = el.container.clientWidth || 0;
  const containerHeight = el.container.clientHeight || 0;
  if (containerWidth < 8 || containerHeight < 8) return null;
  const metrics = getCenterCoverMetrics();
  const width = Math.round(metrics.width);
  const height = Math.round(metrics.height);
  const centerX = containerWidth / 2;
  const centerY = containerHeight / 2 + (metrics.offsetY || 0);
  const left = centerX - width / 2;
  const top = centerY - height / 2;
  return {
    left,
    right: left + width,
    top,
    bottom: top + height,
    width,
    height,
    centerX,
    centerY,
    stackBottom: top + height + Math.round(height * 0.35)
  };
}

function getLayoutCoverBounds() {
  const active = getActiveCoverBounds();
  if (active) return active;
  if (lastLayoutCoverBounds) return lastLayoutCoverBounds;
  return synthesizeLayoutCoverBounds();
}

function getNominalCoverWidth() {
  return Math.round(getCenterCoverMetrics().width);
}

function readCssPx(name, fallback = 0) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readScopedCssPx(node, name, fallback = 0) {
  if (!node) return fallback;
  const raw = getComputedStyle(node).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

function getEstimatedBrowseBarHeight() {
  const source = el.browseBarShell || document.documentElement;
  const btnMin = readScopedCssPx(source, "--browse-btn-min-height", 42);
  const padY = readScopedCssPx(source, "--browse-btn-padding-y", 8);
  return Math.ceil(btnMin + padY * 2);
}

function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash || splash.classList.contains("is-dismissed")) return;
  document.body.classList.add("is-app-ready");
  const removeSplash = () => splash.classList.add("is-dismissed");
  splash.addEventListener("transitionend", removeSplash, { once: true });
  window.setTimeout(removeSplash, 500);
}

function markLayoutReadyIfStable() {
  const stageHeight = el.container?.clientHeight || 0;
  const bounds = getLayoutCoverBounds();
  if (stageHeight >= 8 && bounds) {
    dismissBootSplash();
  }
}

function scheduleLayoutPlayer() {
  window.cancelAnimationFrame(layoutPlayerFrame);
  layoutPlayerFrame = window.requestAnimationFrame(() => {
    layoutPlayerFrame = 0;
    layoutPlayer();
  });
}

function bindLayoutObserver() {
  if (layoutObserver || typeof ResizeObserver === "undefined") return;
  layoutObserver = new ResizeObserver(() => scheduleLayoutPlayer());
  for (const node of [el.app, el.stage, el.infoPanel, el.chromeTop, el.controls, el.browseBarShell]) {
    if (node) layoutObserver.observe(node);
  }
}

el.audioPlayer.volume = state.volume / 100;
if (isKioskLaunch() || window.matchMedia?.("(pointer: coarse)")?.matches) {
  document.body.classList.add("is-touch-kiosk");
}
if (window.matchMedia?.("(pointer: fine)")?.matches) {
  document.body.classList.add("has-mouse-pointer");
}
function syncCoverCanvasCursor() {
  const canvas = el.container?.querySelector("canvas");
  if (!canvas) return;
  const hide = document.body.classList.contains("is-touch-active") && !document.body.classList.contains("has-mouse-pointer");
  canvas.style.cursor = hide ? "none" : "grab";
}
document.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse") return;
  document.body.classList.add("has-mouse-pointer");
  document.body.classList.remove("is-touch-active");
  syncCoverCanvasCursor();
}, { passive: true });
document.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "touch") return;
  document.body.classList.add("is-touch-active");
  if (!document.body.classList.contains("has-mouse-pointer")) syncCoverCanvasCursor();
}, { passive: true });
try {
  initScene(el.container);
} catch (error) {
  console.error("Scene init failed", error);
}
onSnap(handleSnap);
portalBrowseDropdowns();
portalSongDrawerContextMenu();
portalRadioSearchContextMenu();
bindEvents();
bindLayoutObserver();
ensureTouchKeyboardMounted();
enableKioskPlayerFullscreen();
renderBrowseMenus();
renderSongsDrawer();
updatePlaybackUi();
scheduleLayoutPlayer();
document.fonts?.ready?.then(() => scheduleLayoutPlayer()).catch(() => {});
window.setTimeout(() => dismissBootSplash(), 12000);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted || !el.container) return;
  try {
    initScene(el.container);
  } catch (error) {
    console.error("Scene init failed", error);
  }
  enableKioskPlayerFullscreen();
  if (state.entries.length) presentLibraryEntries({ jump: true });
  else bootstrapLibrary().catch(showError);
});

bootstrapLibrary().catch(showError);
refreshPlayer();
refreshWifiStatus().catch(() => {});
setInterval(refreshPlayer, 1500);
setInterval(() => updatePlaybackUi({ renderRows: false }), 500);
setInterval(async () => {
  if (state.activeDropdown !== "settings-dropdown") return;
  const wifiBefore = wifiUiSnapshot();
  await refreshWifiStatus();
  if (state.activeDropdown !== "settings-dropdown" || shouldDeferSettingsRerender()) return;
  if (wifiUiSnapshot() !== wifiBefore) renderBrowseMenus();
}, 10000);

window.addEventListener("resize", () => {
  scheduleLayoutPlayer();
  positionActiveDropdown();
  positionSongContextMenu();
  positionRadioSearchContextMenu();
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

function withArtCacheVersion(url) {
  if (!url) return "";
  if (!state.artCacheVersion) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${state.artCacheVersion}`;
}

/** Same-origin icon URL for remote favicons; static asset when none (matches search list). */
function radioIconProxyUrl(entry, size = 420) {
  if (!entry) return RADIO_NO_LOGO_ASSET;
  if (!hasRadioFavicon(entry)) return RADIO_NO_LOGO_ASSET;
  const raw = String(entry.artUrl || entry.favicon || "").trim();
  const params = new URLSearchParams({
    size: String(size),
    title: entry.title || entry.name || "Radio",
    url: raw
  });
  if (entry.id) params.set("stationId", String(entry.id));
  return withArtCacheVersion(`/api/library/radio/icon?${params.toString()}`);
}

function radioCoverUrl(entry, size = 420) {
  return radioIconProxyUrl(entry, size);
}

function resolveCoverTexture(entry, index, loadedTexture) {
  if (loadedTexture && loadedTexture !== getDefaultTexture()) return loadedTexture;
  if (entry?.kind === "radio") return createRadioPlaceholderTexture();
  return getDefaultTexture();
}

function loadCoverTexture(entry, url) {
  if (entry?.kind === "radio") {
    return loadRadioTexture(url, entry.title || "Radio");
  }
  return loadTexture(url);
}

function coverTextureForEntry(entry, index) {
  if (state.textures[index]) return state.textures[index];
  if (entry?.kind === "radio") return createRadioPlaceholderTexture();
  return getDefaultTexture();
}

function albumArtUrl(entry, size = 420) {
  if (!entry) return "";
  if (entry.kind === "radio") return radioCoverUrl(entry, size);
  if (entry.artUrl) return withArtCacheVersion(entry.artUrl.replace(/size=\d+/, `size=${size}`));
  if (entry.album) return withArtCacheVersion(`/api/art?album=${encodeURIComponent(entry.album)}&size=${size}`);
  return withArtCacheVersion(`/api/art?album=${encodeURIComponent(entry.title || entry.id || "")}&size=${size}`);
}

function normalizeAlbum(item) {
  const title = item.title || item.album || "Unknown Album";
  const artist = item.albumArtist || item.artist || item.album_artist || "Unknown Artist";
  const id = String(item.id || item.albumId || title);
  const starred = Boolean(item.starred) || state.favouriteAlbums.has(id);
  return {
    kind: "album",
    id,
    title,
    album: title,
    artist,
    albumArtist: artist,
    subtitle: [artist, item.year].filter(Boolean).join(" - "),
    year: item.year || "",
    genre: item.genre || "",
    rating: Number(item.rating || 0),
    songCount: item.songCount || item.song_count || 0,
    starred,
    albumStarred: starred,
    artUrl: item.artUrl || item.art_url || `/api/art?album=${encodeURIComponent(title)}&size=420`
  };
}

const COMPILATION_ARTIST_NAMES = new Set(["various artists", "various", "unknown artist"]);

function isCompilationArtistName(value) {
  return COMPILATION_ARTIST_NAMES.has(String(value || "").trim().toLowerCase());
}

function getTrackDisplayArtist(track, albumArtist = "") {
  const candidates = [
    track?.artist,
    track?.singer,
    track?.Singer,
    track?.performer,
    track?.Performer
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const artist = candidates.find((value) => !isCompilationArtistName(value)) || candidates[0] || "";
  if (artist) return artist;
  const fallback = String(albumArtist || track?.albumArtist || "").trim();
  return isCompilationArtistName(fallback) ? "" : fallback;
}

function normalizeRadioStreamUrl(url) {
  return String(url || "").trim().replace(/\/+$/, "");
}

function isRadioPlaybackTrack(track) {
  if (!track) return false;
  if (track.kind === "radio") return true;
  const stream = normalizeRadioStreamUrl(track.streamUrl || track.file);
  return Boolean(stream && /^https?:\/\//i.test(stream) && String(track.album || "").toLowerCase() === "internet radio");
}

function radioPlaybackKey(track) {
  if (!track) return "";
  return normalizeRadioStreamUrl(track.streamUrl || track.file) || String(track.id || "");
}

function normalizeTrack(item, index = 0) {
  const title = item.title || item.Title || "Unknown Title";
  const album = item.album || item.Album || "";
  const singer = item.singer || item.Singer || "";
  const artist = item.artist || item.Artist || singer || "";
  const albumArtist = item.albumArtist || item.AlbumArtist || item.album_artist || "";
  const file = item.file || item.path || item.streamUrl || "";
  const streamUrl = item.streamUrl || ( /^https?:\/\//i.test(file) ? file : "");
  const id = item.id || streamUrl || file || `${album}-${index}-${title}`;
  if (item.kind === "radio" || (streamUrl && String(album).toLowerCase() === "internet radio")) {
    return {
      kind: "radio",
      id,
      file: streamUrl || file,
      streamUrl: streamUrl || file,
      title,
      artist,
      album: album || "Internet radio",
      duration: Number(item.duration || item.Time || 0),
      artUrl: item.artUrl || item.favicon || "",
      starred: false
    };
  }
  const starred = Boolean(item.starred) || state.favouriteTracks.has(file) || state.favouriteTracks.has(id);
  return {
    kind: "song",
    id,
    file,
    albumId: String(item.albumId || item.album_id || ""),
    title,
    album,
    artist: getTrackDisplayArtist({ artist, singer }, albumArtist),
    singer: singer || artist,
    albumArtist,
    trackNo: Number(item.trackNo || item.trackNumber || item.track || item.Track || index + 1),
    duration: Number(item.duration || item.Time || 0),
    year: item.year || "",
    genre: item.genre || "",
    bitRate: item.bitRate || item.bitrate || "",
    suffix: item.suffix || (file ? String(file).split(".").pop() : ""),
    starred,
    artUrl: item.artUrl || item.art_url || (album ? `/api/art?album=${encodeURIComponent(album)}&size=420` : "")
  };
}

function rememberAlbumMeta(album) {
  if (!album) return;
  const keys = [album.id, album.album, album.title].filter(Boolean);
  for (const key of keys) {
    state.albumMeta.set(String(key), album);
    try {
      state.albumMeta.set(decodeURIComponent(String(key)), album);
    } catch (_error) {
      // Keep the original key only.
    }
  }
}

function enrichTrackFromAlbum(track) {
  const album = state.albumMeta.get(String(track.album || "")) || state.albumMeta.get(String(track.id || ""));
  if (!album) return track;
  const albumArtist = track.albumArtist || album.albumArtist || album.artist;
  return {
    ...track,
    albumArtist,
    artist: getTrackDisplayArtist(track, albumArtist),
    year: track.year || album.year || "",
    genre: track.genre || album.genre || "",
    artUrl: track.artUrl || album.artUrl
  };
}

async function loadFavourites() {
  const data = await apiGet("/api/library/favourites");
  state.favouriteTracks = new Set(data.tracks || []);
  state.favouriteAlbums = new Set((data.albums || []).map(String));
  state.favouriteAlbumIdsFromTracks = new Set();
  state.starredTracksCache = [];
  if (state.favouriteTracks.size) {
    const starred = await apiGet("/api/library/starred/tracks").catch(() => ({ tracks: [] }));
    state.starredTracksCache = (starred.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
    for (const track of state.starredTracksCache) {
      const albumId = String(track.albumId || "");
      if (albumId) state.favouriteAlbumIdsFromTracks.add(albumId);
    }
  }
}

async function loadPlaylists() {
  const data = await apiGet("/api/library/playlists");
  state.playlists = data.playlists || [];
}

async function fetchFavouriteAlbumEntries(limit = PAGE_SIZE) {
  await loadFavourites();
  if (!state.favouriteAlbums.size && !state.favouriteTracks.size) {
    return { albums: [], total: 0 };
  }

  const albumsById = new Map();
  if (state.favouriteAlbums.size) {
    const query = new URLSearchParams({ offset: "0", limit: String(limit), filter: "favourite" });
    const data = await apiGet(`/api/library/albums?${query}`);
    for (const album of (data.albums || []).map(normalizeAlbum)) {
      if (!state.favouriteAlbums.has(String(album.id))) continue;
      album.starred = true;
      album.albumStarred = true;
      albumsById.set(String(album.id), album);
    }
  }

  if (state.favouriteTracks.size) {
    let tracks = state.starredTracksCache;
    if (!tracks.length) {
      const data = await apiGet("/api/library/starred/tracks").catch(() => ({ tracks: [] }));
      tracks = (data.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
      state.starredTracksCache = tracks;
    }
    for (const album of buildAlbumEntriesFromTracks(tracks)) {
      const id = String(album.id);
      if (albumsById.has(id)) continue;
      const albumStarred = state.favouriteAlbums.has(id);
      album.starred = albumStarred || true;
      album.albumStarred = albumStarred;
      album.hasFavouriteSongs = true;
      albumsById.set(id, album);
    }
  }

  const albums = [...albumsById.values()].sort((left, right) =>
    String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" })
  );
  albums.forEach(rememberAlbumMeta);
  return { albums, total: albums.length };
}

async function fetchAlbums(offset = 0, filter = state.albumFilter, limit = PAGE_SIZE) {
  if (filter === "favourite") {
    return fetchFavouriteAlbumEntries(limit);
  }
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  if (filter) query.set("filter", filter);
  const data = await apiGet(`/api/library/albums?${query}`);
  const albums = (data.albums || []).map(normalizeAlbum);
  albums.forEach(rememberAlbumMeta);
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
      const albumTitle = album.album || album.title || "";
      const albumArtist = album.albumArtist || album.artist || "";
      const tracks = (data.tracks || []).map(normalizeTrack).map((track) => ({
        ...track,
        album: track.album || albumTitle,
        albumArtist: track.albumArtist || albumArtist,
        artist: getTrackDisplayArtist(track, track.albumArtist || albumArtist),
        artUrl: track.artUrl || albumArtUrl(album)
      }));
      if (tracks.length) return tracks;
    } catch (_error) {
      // Try the next compatible endpoint.
    }
  }
  return [];
}

async function fetchTracksPage(offset = 0, limit = PAGE_SIZE) {
  const query = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  const data = await apiGet(`/api/library/tracks?${query}`);
  const tracks = (data.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
  return { tracks, total: Number(data.total || tracks.length) };
}

async function fetchAllTracks() {
  for (const url of ["/api/library/tracks?limit=10000", "/api/tracks"]) {
    try {
      const data = await apiGet(url);
      const tracks = (data.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
      if (tracks.length) return tracks;
    } catch (_error) {
      // Try the next endpoint.
    }
  }
  return [];
}

function buildAlbumEntriesFromTracks(tracks) {
  const byAlbum = new Map();
  for (const track of tracks) {
    const key = track.albumId || track.album || track.id;
    if (!byAlbum.has(key)) {
      const albumMeta = state.albumMeta.get(String(track.album || "")) || state.albumMeta.get(String(key)) || {};
      byAlbum.set(key, normalizeAlbum({
        id: track.albumId || albumMeta.id || key,
        title: track.album || track.title || "Unknown Album",
        artist: track.artist || albumMeta.artist,
        albumArtist: track.albumArtist || albumMeta.albumArtist,
        year: track.year || albumMeta.year,
        genre: track.genre || albumMeta.genre,
        artUrl: track.artUrl || albumMeta.artUrl
      }));
    }
    const entry = byAlbum.get(key);
    entry.songCount = (entry.songCount || 0) + 1;
    if (!entry.year && track.year) entry.year = track.year;
  }
  return [...byAlbum.values()];
}

function filterTracksForAlbumEntry(tracks, entry) {
  if (!entry || !tracks.length) return tracks;
  const albumId = String(entry.id || entry.albumId || "");
  const albumName = String(entry.album || entry.title || "");
  return tracks.filter((track) => {
    const trackAlbumId = String(track.albumId || "");
    if (albumId && trackAlbumId && albumId === trackAlbumId) return true;
    if (albumName && String(track.album || "") === albumName) return true;
    return false;
  });
}

function isAlbumFavourited(entry) {
  if (!entry) return false;
  if (entry.albumStarred || entry.hasFavouriteSongs) return true;
  const id = String(entry.id || entry.albumId || "");
  if (id && state.favouriteAlbums.has(id)) return true;
  if (id && state.favouriteAlbumIdsFromTracks.has(id)) return true;
  const title = String(entry.title || entry.album || "");
  if (title) {
    const meta = state.albumMeta.get(title);
    const metaId = String(meta?.id || "");
    if (metaId && state.favouriteAlbums.has(metaId)) return true;
    if (metaId && state.favouriteAlbumIdsFromTracks.has(metaId)) return true;
  }
  return Boolean(entry.starred);
}

function getDrawerEntryKey(entry) {
  if (!entry) return "";
  return [
    state.mode,
    state.songsBrowseScope,
    state.albumBrowseScope,
    state.activePlaylistId,
    state.activeSmartPlaylistId,
    entry.kind,
    String(entry.id || entry.file || "")
  ].join("|");
}

function getAlbumDrawerCacheKey(entry) {
  return String(entry?.id || entry?.albumId || entry?.title || entry?.album || "");
}

function applyDrawerPresentation({ title, subtitle, tracks }) {
  state.drawerTitle = title;
  state.drawerSubtitle = subtitle;
  state.drawerTracks = tracks;
}

function tryResolveDrawerTracksSync(entry) {
  if (!entry) return null;
  if (entry.kind === "radio" && state.mode === BROWSE_MODE.RADIO) {
    return getRadioDrawerTracksPresentation(entry);
  }
  if (entry.kind === "song") {
    return {
      title: entry.album || "Songs",
      subtitle: entry.artist || "",
      tracks: [entry]
    };
  }

  const favouriteScope =
    (state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "favourite") ||
    state.mode === BROWSE_MODE.STARRED;
  if (favouriteScope) {
    if (state.starredTracksCache.length) {
      const tracks = entry.kind === "album"
        ? filterTracksForAlbumEntry(state.starredTracksCache, entry)
        : state.starredTracksCache;
      if (tracks.length) {
        return {
          title: entry.title || "Favourite",
          subtitle: entry.artist || entry.subtitle || "Favourite songs",
          tracks
        };
      }
    }
    if (state.drawerTracks.length) {
      const tracks = filterTracksForAlbumEntry(state.drawerTracks, entry);
      if (tracks.length) {
        return {
          title: entry.title || "Favourite",
          subtitle: entry.artist || entry.subtitle || "Favourite songs",
          tracks
        };
      }
    }
  }

  if (state.mode === BROWSE_MODE.SMART_PLAYLIST) {
    const playlist = state.smartPlaylists.find((item) => item.id === state.activeSmartPlaylistId);
    if (entry.kind === "album") {
      const albumName = entry.album || entry.title;
      const tracks = state.smartPlaylistTracks.filter((track) => track.album === albumName);
      if (tracks.length) {
        return {
          title: entry.title || playlist?.name || "Smart Playlist",
          subtitle: entry.artist || playlist?.name || "Smart Playlist",
          tracks
        };
      }
    }
    if (state.smartPlaylistTracks.length) {
      return {
        title: entry.title || playlist?.name || "Smart Playlist",
        subtitle: playlist?.name || "Smart Playlist",
        tracks: state.smartPlaylistTracks
      };
    }
  }

  if (state.mode === BROWSE_MODE.PLAYLIST && state.drawerTracks.length) {
    let tracks = state.drawerTracks;
    if (entry.kind === "album") {
      const albumName = entry.album || entry.title;
      tracks = tracks.filter((track) => track.album === albumName);
    } else if (entry.kind === "song") {
      tracks = [entry];
    }
    const playlist = state.playlists.find((item) => item.id === state.activePlaylistId);
    if (tracks.length) {
      return {
        title: entry.title || playlist?.name || "Playlist",
        subtitle: playlist?.name || "Playlist",
        tracks
      };
    }
  }

  const cacheKey = getAlbumDrawerCacheKey(entry);
  if (cacheKey && albumDrawerTrackCache.has(cacheKey)) {
    return {
      title: entry.title || "Songs",
      subtitle: entry.artist || entry.subtitle || "",
      tracks: albumDrawerTrackCache.get(cacheKey)
    };
  }

  if (state.drawerTracks.length) {
    const tracks = filterTracksForAlbumEntry(state.drawerTracks, entry);
    if (tracks.length) {
      return {
        title: entry.title || "Songs",
        subtitle: entry.artist || entry.subtitle || "",
        tracks
      };
    }
  }

  return null;
}

async function loadFavouriteTracksForEntry(entry) {
  if (state.starredTracksCache.length) {
    if (!entry || entry.kind === "song") return state.starredTracksCache;
    return filterTracksForAlbumEntry(state.starredTracksCache, entry);
  }
  const data = await apiGet("/api/library/starred/tracks").catch(() => ({ tracks: [] }));
  const tracks = (data.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
  state.starredTracksCache = tracks;
  if (!entry || entry.kind === "song") return tracks;
  return filterTracksForAlbumEntry(tracks, entry);
}

async function fetchAlbumTracksForDrawer(entry) {
  const cacheKey = getAlbumDrawerCacheKey(entry);
  if (cacheKey && albumDrawerTrackCache.has(cacheKey)) {
    return albumDrawerTrackCache.get(cacheKey);
  }
  const tracks = await fetchAlbumTracks(entry);
  if (cacheKey) albumDrawerTrackCache.set(cacheKey, tracks);
  return tracks;
}

async function loadAlbumBrowse(scope = state.albumBrowseScope) {
  state.albumBrowseScope = scope === "favourite" ? "favourite" : "all";
  const filter = state.albumBrowseScope === "favourite" ? "favourite" : "";
  if (state.albumBrowseScope === "favourite") await loadFavourites();
  await loadAlbums({ resetIndex: true, filter, mode: BROWSE_MODE.ALBUM });
  saveBrowseState();
}

function waitForStageReady(maxMs = 5000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      const height = el.container?.clientHeight || 0;
      if (height >= 8 || Date.now() - started >= maxMs) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function presentLibraryEntries({ jump = true } = {}) {
  syncAlbumSlides({ jump });
  refitStage();
  updateBrowseSummary(true);
  scheduleLayoutPlayer();
}

async function bootstrapLibrary() {
  try {
    await waitForStageReady();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        await loadFavourites().catch(() => {});
        await loadPlaylists().catch(() => {});
        await restorePersistedBrowse(attempt > 0);
        if (state.entries.length > 0) {
          presentLibraryEntries({ jump: true });
          clearStatus();
          return;
        }
        const scan = await apiGet("/api/library/scan-status").catch(() => null);
        if (Number(scan?.albumCount || 0) > 0) {
          state.albumBrowseScope = "all";
          state.albumFilter = "";
          await loadAlbumBrowse("all");
          if (state.entries.length > 0) {
            presentLibraryEntries({ jump: true });
            clearStatus();
            return;
          }
          continue;
        }
        clearStatus();
        return;
      } catch (error) {
        if (attempt >= 5) showError(error);
      }
      await delay(700 * (attempt + 1));
    }
  } catch (error) {
    showError(error);
  }
}

function isAlbumBrowseListContext() {
  return state.mode === BROWSE_MODE.ALBUM && (!state.albumFilter || state.albumFilter === "favourite");
}

async function loadAlbums({ resetIndex = false, filter, quiet = false, mode = null } = {}) {
  if (filter !== undefined) state.albumFilter = filter || "";
  if (!quiet) setStatus("Loading albums...");
  const previousId = !resetIndex
    ? (state.entries[state.browseIndex]?.id || state.currentEntry?.id || "")
    : "";
  if (mode) state.mode = mode;
  else if (!state.albumFilter) state.mode = BROWSE_MODE.ALBUM;
  const limit = isAlbumBrowseListContext() ? SONGS_BROWSE_LOAD_LIMIT : PAGE_SIZE;
  const data = await fetchAlbums(0, state.albumFilter, limit);
  state.entries = data.albums;
  state.total = data.total;
  state.textures = [];
  state.texturePromises.clear();
  if (resetIndex) {
    state.browseIndex = 0;
  } else if (previousId) {
    const nextIndex = state.entries.findIndex((entry) => entry.id === previousId);
    if (nextIndex >= 0) state.browseIndex = nextIndex;
    else state.browseIndex = clamp(state.browseIndex, 0, Math.max(0, state.entries.length - 1));
  } else {
    state.browseIndex = clamp(state.browseIndex, 0, Math.max(0, state.entries.length - 1));
  }
  if (isAlbumBrowseListContext()) {
    applyAlbumBrowseSort({ jump: true, preserveFocus: !resetIndex });
  } else {
    presentLibraryEntries({ jump: true });
  }
  renderBrowseMenus();
  if (!quiet) clearStatus();
  saveBrowseState();
}

async function loadArtistAlbums(artistName) {
  state.selectedArtist = artistName;
  state.selectedComposer = "";
  const filter = artistName ? `artist:${artistName}` : "";
  await loadAlbums({ resetIndex: true, filter, mode: BROWSE_MODE.ARTIST });
  renderBrowseMenus();
}

async function loadComposerAlbums(composerName) {
  state.selectedComposer = composerName;
  state.selectedArtist = "";
  const filter = composerName ? `composer:${composerName}` : "";
  await loadAlbums({ resetIndex: true, filter, mode: BROWSE_MODE.COMPOSER });
  renderBrowseMenus();
}

function parseYearForSort(value) {
  const match = String(value || "").match(/\d{4}/);
  return match ? Number(match[0]) : null;
}

function compareSongsYearSort(left, right, direction = 1) {
  const leftYear = parseYearForSort(left.year);
  const rightYear = parseYearForSort(right.year);
  if (leftYear == null && rightYear == null) {
    return String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" });
  }
  if (leftYear == null) return 1;
  if (rightYear == null) return -1;
  if (leftYear !== rightYear) return (leftYear - rightYear) * direction;
  return String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" });
}

function sortSongsBrowseEntries(entries, sortKey = state.songsBrowseSort) {
  const copy = [...entries];
  if (sortKey === "year-asc") {
    return copy.sort((left, right) => compareSongsYearSort(left, right, 1));
  }
  if (sortKey === "year-desc") {
    return copy.sort((left, right) => compareSongsYearSort(left, right, -1));
  }
  return copy.sort((left, right) =>
    String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" })
  );
}

function sortSongsBrowseTracks(tracks, sortKey = state.songsBrowseSort) {
  return sortSongsBrowseEntries(tracks, sortKey);
}

function entryTextureKey(entry, index = 0) {
  return String(entry?.id || entry?.file || entry?.streamUrl || entry?.title || index);
}

function remapTexturesForEntries(entries) {
  const textureByKey = new Map();
  state.entries.forEach((entry, index) => {
    const texture = state.textures[index];
    if (texture) textureByKey.set(entryTextureKey(entry, index), texture);
  });
  return entries.map((entry, index) => textureByKey.get(entryTextureKey(entry, index)) || null);
}

function getBrowseEmptyLabel() {
  if (state.mode === BROWSE_MODE.ALBUM && state.albumBrowseScope === "favourite") {
    return { title: "No Favourite Albums", subtitle: "Star albums to see them here", hidePanel: false };
  }
  if (state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "favourite") {
    return { title: "No Favourite Songs", subtitle: "Star songs to see them here", hidePanel: false };
  }
  return { title: "Not Playing", subtitle: "\u00A0", hidePanel: true };
}

function applyEntryBrowseSort({
  jump = true,
  resetTextures = true,
  preserveFocus = false,
  sortKey = "title"
} = {}) {
  if (!state.entries.length) {
    state.browseIndex = 0;
    state.textures = [];
    state.texturePromises.clear();
    presentLibraryEntries({ jump });
    updateBrowseSummary(true);
    saveBrowseState();
    return;
  }
  const focusedEntry = preserveFocus ? (state.entries[state.browseIndex] || null) : null;
  state.entries = sortSongsBrowseEntries(state.entries, sortKey);
  if (resetTextures) {
    state.textures = remapTexturesForEntries(state.entries);
    state.texturePromises.clear();
  }
  if (focusedEntry) {
    const nextIndex = state.entries.findIndex((entry) => entryTextureKey(entry) === entryTextureKey(focusedEntry));
    state.browseIndex = nextIndex >= 0 ? nextIndex : 0;
  } else {
    state.browseIndex = 0;
  }
  presentLibraryEntries({ jump });
  updateBrowseSummary(true);
  saveBrowseState();
}

function applyAlbumBrowseSort({ jump = true, resetTextures = true, preserveFocus = false } = {}) {
  if (!isAlbumBrowseListContext()) return;
  applyEntryBrowseSort({
    jump,
    resetTextures,
    preserveFocus,
    sortKey: state.albumBrowseSort
  });
}

function applySongsBrowseSort({ jump = true, resetTextures = true, preserveFocus = false } = {}) {
  if (state.mode !== BROWSE_MODE.SONGS) return;
  if (state.songsDisplayMode === "song" && state.drawerTracks.length) {
    state.drawerTracks = sortSongsBrowseTracks(state.drawerTracks, state.songsBrowseSort);
  }
  applyEntryBrowseSort({
    jump,
    resetTextures,
    preserveFocus,
    sortKey: state.songsBrowseSort
  });
}

function buildSongBrowseEntries(tracks) {
  return state.songsDisplayMode === "album"
    ? buildAlbumEntriesFromTracks(tracks)
    : tracks.map((track) => ({
      ...track,
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(" - ")
    }));
}

async function loadSongBrowse(scope = state.songsBrowseScope) {
  state.songsBrowseScope = scope === "favourite" ? "favourite" : "all";
  const favouriteScope = state.songsBrowseScope === "favourite";
  setStatus(favouriteScope ? "Loading favourite songs..." : "Loading songs...");
  state.mode = BROWSE_MODE.SONGS;
  state.albumFilter = "";
  state.textures = [];
  state.texturePromises.clear();
  state.browseIndex = 0;
  state.drawerTracks = [];

  if (favouriteScope) {
    if (state.songsDisplayMode === "album") {
      const data = await fetchFavouriteAlbumEntries(1000);
      state.entries = data.albums;
      state.total = data.total;
      const starred = await apiGet("/api/library/starred/tracks").catch(() => ({ tracks: [] }));
      state.drawerTracks = (starred.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
    } else {
      await loadFavourites();
      const data = await apiGet("/api/library/starred/tracks").catch(() => ({ tracks: [] }));
      const tracks = (data.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
      state.entries = buildSongBrowseEntries(tracks);
      state.total = state.entries.length;
      state.drawerTracks = tracks;
    }
  } else if (state.songsDisplayMode === "album") {
    const data = await fetchAlbums(0, "", SONGS_BROWSE_LOAD_LIMIT);
    state.entries = data.albums;
    state.total = data.total;
  } else {
    const data = await fetchTracksPage(0, SONGS_BROWSE_LOAD_LIMIT);
    const tracks = (data.tracks || []).map(normalizeTrack).map(enrichTrackFromAlbum);
    state.entries = buildSongBrowseEntries(tracks);
    state.total = Number(data.total || state.entries.length);
    state.drawerTracks = tracks;
  }

  applySongsBrowseSort({ jump: true, preserveFocus: false });
  state.drawerTitle = favouriteScope ? "Favourite" : "Songs";
  state.drawerSubtitle = favouriteScope
    ? "Favourite songs"
    : (state.songsDisplayMode === "album" ? "All albums" : "All songs");
  updateBrowseSummary(true);
  renderBrowseMenus();
  clearStatus();
  saveBrowseState();
}

function loadSmartPlaylists() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(SMART_PLAYLIST_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch (_error) {
    return [];
  }
}

function saveSmartPlaylists() {
  window.localStorage.setItem(SMART_PLAYLIST_STORAGE_KEY, JSON.stringify(state.smartPlaylists));
}

function createDefaultSmartPlaylist() {
  const decadeStart = Math.floor(new Date().getFullYear() / 10) * 10 - 40;
  return {
    id: `smart-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: "Smart Playlist",
    matchEnabled: true,
    matchMode: "all",
    rules: [
      { field: "year", operator: "in-range", value: String(decadeStart), value2: String(decadeStart + 9) }
    ],
    limitEnabled: true,
    limitCount: 25,
    limitSort: "album",
    liveUpdating: true
  };
}

function getSmartFieldLabel(field) {
  return SMART_RULE_FIELDS.find(([value]) => value === field)?.[1] || field;
}

function renderSmartOptions(options, selectedValue) {
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderSmartPlaylistModal() {
  const draft = state.smartPlaylistDraft || createDefaultSmartPlaylist();
  el.smartPlaylistName.value = draft.name || "Smart Playlist";
  el.smartMatchEnabled.checked = draft.matchEnabled !== false;
  el.smartMatchMode.value = draft.matchMode === "any" ? "any" : "all";
  el.smartLimitEnabled.checked = draft.limitEnabled !== false;
  el.smartLimitCount.value = String(clamp(Number(draft.limitCount) || 25, 1, 999));
  el.smartLimitSort.value = draft.limitSort || "album";
  el.smartLiveUpdating.checked = draft.liveUpdating !== false;
  el.smartRuleList.innerHTML = (draft.rules?.length ? draft.rules : [createDefaultSmartPlaylist().rules[0]])
    .map(renderSmartRuleRow)
    .join("");
  el.smartPlaylistPreview.textContent = `${draft.rules?.length || 1} ${draft.rules?.length === 1 ? "rule" : "rules"} configured.`;
}

function renderSmartRuleRow(rule, index) {
  const operator = rule.operator || "is";
  const range = operator === "in-range";
  return `
    <div class="smart-rule-row" data-index="${index}">
      <select data-smart-field aria-label="Rule field">
        ${renderSmartOptions(SMART_RULE_FIELDS, rule.field || "artist")}
      </select>
      <select data-smart-operator aria-label="Rule operator">
        ${renderSmartOptions(SMART_RULE_OPERATORS, operator)}
      </select>
      <input data-smart-value type="${getSmartInputType(rule.field)}" value="${escapeHtml(rule.value ?? "")}" aria-label="${escapeHtml(getSmartFieldLabel(rule.field || "artist"))} value">
      <span class="smart-rule-range-label">${range ? "to" : ""}</span>
      <input data-smart-value2 type="${getSmartInputType(rule.field)}" value="${escapeHtml(rule.value2 ?? "")}" aria-label="Range end" ${range ? "" : "disabled"}>
      <button class="smart-rule-btn" type="button" data-smart-action="remove-rule" aria-label="Remove rule">-</button>
    </div>
  `;
}

function getSmartInputType(field) {
  return ["year", "bitRate", "bpm", "discNumber", "movementNumber", "plays", "rating", "sampleRate", "size", "skips", "time"].includes(field)
    ? "number"
    : "text";
}

function collectSmartPlaylistDraft() {
  const current = state.smartPlaylistDraft || createDefaultSmartPlaylist();
  const rules = [...el.smartRuleList.querySelectorAll(".smart-rule-row")].map((row) => ({
    field: row.querySelector("[data-smart-field]")?.value || "artist",
    operator: row.querySelector("[data-smart-operator]")?.value || "is",
    value: row.querySelector("[data-smart-value]")?.value || "",
    value2: row.querySelector("[data-smart-value2]")?.value || ""
  }));
  return {
    ...current,
    name: el.smartPlaylistName.value.trim() || "Smart Playlist",
    matchEnabled: el.smartMatchEnabled.checked,
    matchMode: el.smartMatchMode.value === "any" ? "any" : "all",
    rules: rules.length ? rules : createDefaultSmartPlaylist().rules,
    limitEnabled: el.smartLimitEnabled.checked,
    limitCount: clamp(Number(el.smartLimitCount.value) || 25, 1, 999),
    limitSort: el.smartLimitSort.value || "album",
    liveUpdating: el.smartLiveUpdating.checked
  };
}

function openSmartPlaylistBuilder(playlistId = "") {
  const existing = state.smartPlaylists.find((playlist) => playlist.id === playlistId);
  state.smartPlaylistDraft = existing ? JSON.parse(JSON.stringify(existing)) : createDefaultSmartPlaylist();
  renderSmartPlaylistModal();
  closeDropdowns();
  el.smartPlaylistModal.classList.remove("hidden");
  el.smartPlaylistModal.setAttribute("aria-hidden", "false");
  el.smartPlaylistName.focus();
  el.smartPlaylistName.select();
}

function closeSmartPlaylistBuilder() {
  el.smartPlaylistModal.classList.add("hidden");
  el.smartPlaylistModal.setAttribute("aria-hidden", "true");
  state.smartPlaylistDraft = null;
  closeTouchKeyboard();
  syncModalKeyboardLayout();
}

function isModalDialogOpen() {
  return Boolean(
    (el.playlistModal && !el.playlistModal.classList.contains("hidden")) ||
    (el.smartPlaylistModal && !el.smartPlaylistModal.classList.contains("hidden")) ||
    (el.confirmModal && !el.confirmModal.classList.contains("hidden"))
  );
}

function openConfirmDialog({
  title = "Confirm",
  message = "Are you sure?",
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  danger = false
} = {}) {
  if (state.confirmDialog.resolve) {
    closeConfirmDialog(false);
  }
  closeDropdowns();
  el.confirmDialogTitle.textContent = title;
  el.confirmDialogMessage.textContent = message;
  el.confirmDialogConfirm.textContent = confirmLabel;
  el.confirmDialogCancel.textContent = cancelLabel;
  el.confirmDialogConfirm.classList.toggle("smart-btn-danger", danger);
  el.confirmDialogConfirm.classList.toggle("smart-btn-primary", !danger);
  el.confirmModal.classList.remove("hidden");
  el.confirmModal.setAttribute("aria-hidden", "false");
  syncModalKeyboardLayout();
  scheduleLayoutPlayer();
  window.setTimeout(() => {
    (danger ? el.confirmDialogCancel : el.confirmDialogConfirm)?.focus({ preventScroll: true });
  }, 0);
  return new Promise((resolve) => {
    state.confirmDialog.resolve = resolve;
  });
}

function closeConfirmDialog(confirmed = false) {
  const resolve = state.confirmDialog.resolve;
  state.confirmDialog.resolve = null;
  el.confirmModal.classList.add("hidden");
  el.confirmModal.setAttribute("aria-hidden", "true");
  el.confirmDialogConfirm.classList.remove("smart-btn-danger");
  el.confirmDialogConfirm.classList.add("smart-btn-primary");
  syncModalKeyboardLayout();
  if (resolve) resolve(Boolean(confirmed));
}

function getActiveModalCard() {
  if (el.playlistModal && !el.playlistModal.classList.contains("hidden")) return el.playlistForm;
  if (el.smartPlaylistModal && !el.smartPlaylistModal.classList.contains("hidden")) return el.smartPlaylistForm;
  if (el.confirmModal && !el.confirmModal.classList.contains("hidden")) {
    return el.confirmModal.querySelector(".confirm-dialog-card");
  }
  return null;
}

function resetTouchKeyboardLayout() {
  if (!el.touchKeyboard) return;
  el.touchKeyboard.style.removeProperty("width");
  el.touchKeyboard.style.removeProperty("left");
  el.touchKeyboard.style.removeProperty("transform");
}

function layoutModalAboveKeyboard() {
  const card = getActiveModalCard();
  if (!card || !el.touchKeyboard || el.touchKeyboard.classList.contains("hidden")) return;

  const keyboardRect = el.touchKeyboard.getBoundingClientRect();
  if (keyboardRect.height <= 0) return;

  const gap = 12;
  const padding = 8;
  const keyboardTop = keyboardRect.top;
  el.touchKeyboard.style.removeProperty("width");
  el.touchKeyboard.style.left = "50%";
  el.touchKeyboard.style.transform = "translateX(-50%)";

  if (el.playlistModal && !el.playlistModal.classList.contains("hidden")) {
    const cardHeight = card.offsetHeight;
    const top = clamp(
      keyboardTop - cardHeight - gap,
      padding,
      Math.max(padding, window.innerHeight - cardHeight - padding)
    );
    card.style.position = "fixed";
    card.style.top = `${Math.round(top)}px`;
  }
}

function syncModalKeyboardLayout() {
  const modalOpen = isModalDialogOpen();
  const keyboardOpen = state.touchKeyboard.open;
  const modalKeyboardActive = modalOpen && keyboardOpen;
  document.body.classList.toggle("is-modal-keyboard-open", modalKeyboardActive);

  if (!modalKeyboardActive) {
    document.documentElement.style.removeProperty("--touch-keyboard-height");
    resetTouchKeyboardLayout();
    if (!keyboardOpen && el.playlistModal && !el.playlistModal.classList.contains("hidden")) {
      requestAnimationFrame(centerPlaylistDialog);
    }
    return;
  }

  const measureKeyboard = (attempt = 0) => {
    const keyboardHeight = el.touchKeyboard?.getBoundingClientRect().height || 0;
    if (keyboardHeight > 0) {
      document.documentElement.style.setProperty("--touch-keyboard-height", `${Math.ceil(keyboardHeight + 12)}px`);
      layoutModalAboveKeyboard();
      return;
    }
    if (attempt < 4) {
      window.requestAnimationFrame(() => measureKeyboard(attempt + 1));
    }
  };
  window.requestAnimationFrame(() => measureKeyboard());
}

function bindModalBackdropDismiss(modal, onClose) {
  if (!modal) return;
  let pointerDownTarget = null;
  modal.addEventListener("pointerdown", (event) => {
    pointerDownTarget = event.target;
  });
  modal.addEventListener("click", (event) => {
    if (event.target === modal && pointerDownTarget === modal) {
      onClose();
    }
    pointerDownTarget = null;
  });
}

function centerPlaylistDialog() {
  const card = el.playlistForm;
  if (!card || el.playlistModal?.classList.contains("hidden")) return;
  const width = card.offsetWidth || Math.min(360, window.innerWidth - 32);
  const height = card.offsetHeight || 180;
  const left = clamp(
    Math.round((window.innerWidth - width) / 2),
    8,
    Math.max(8, window.innerWidth - width - 8)
  );
  const top = clamp(
    Math.round((window.innerHeight - height) / 2),
    8,
    Math.max(8, window.innerHeight - height - 8)
  );
  card.style.position = "fixed";
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
  card.style.margin = "0";
  card.style.transform = "none";
}

function bindDraggableDialog(card, handle) {
  if (!card || !handle) return;
  let drag = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    originLeft: 0,
    originTop: 0
  };

  const finishDrag = (event) => {
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    drag.active = false;
    drag.pointerId = null;
    card.classList.remove("is-dragging");
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch (_error) {
      // Pointer may already be released.
    }
  };

  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest("button, input, textarea, select, a")) return;
    const rect = card.getBoundingClientRect();
    drag = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top
    };
    card.style.position = "fixed";
    card.style.left = `${Math.round(rect.left)}px`;
    card.style.top = `${Math.round(rect.top)}px`;
    card.classList.add("is-dragging");
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  handle.addEventListener("pointermove", (event) => {
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const padding = 8;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const left = clamp(
      drag.originLeft + (event.clientX - drag.startX),
      padding,
      Math.max(padding, window.innerWidth - width - padding)
    );
    const top = clamp(
      drag.originTop + (event.clientY - drag.startY),
      padding,
      Math.max(padding, window.innerHeight - height - padding)
    );
    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
    event.preventDefault();
  });

  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
}

function preventModalInputGhostClick(form) {
  if (!form) return;
  form.addEventListener("touchend", (event) => {
    if (event.target?.matches?.("input[type='text'], input[type='search'], input[type='number'], textarea")) {
      event.preventDefault();
    }
  }, { passive: false });
}

function suppressCoverInteraction(ms = 450) {
  state.suppressCoverTapUntil = Date.now() + ms;
}

function bindBrowseMenuInteractionShield() {
  const shieldPointer = (event) => {
    suppressCoverInteraction();
    event.stopPropagation();
  };
  for (const dropdown of [el.albumDropdown, el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown, el.settingsDropdown]) {
    if (!dropdown) continue;
    dropdown.addEventListener("pointerdown", shieldPointer);
    dropdown.addEventListener("pointerup", shieldPointer);
    dropdown.addEventListener("pointercancel", shieldPointer);
  }
}

function addSmartRule() {
  state.smartPlaylistDraft = collectSmartPlaylistDraft();
  state.smartPlaylistDraft.rules.push({ field: "artist", operator: "contains", value: "", value2: "" });
  renderSmartPlaylistModal();
}

function removeSmartRule(index) {
  state.smartPlaylistDraft = collectSmartPlaylistDraft();
  state.smartPlaylistDraft.rules.splice(index, 1);
  if (!state.smartPlaylistDraft.rules.length) {
    state.smartPlaylistDraft.rules.push({ field: "artist", operator: "contains", value: "", value2: "" });
  }
  renderSmartPlaylistModal();
}

function handleSmartPlaylistFormChange(event) {
  if (event.target.closest?.(".smart-rule-row") || event.target === el.smartMatchMode || event.target === el.smartLimitSort) {
    state.smartPlaylistDraft = collectSmartPlaylistDraft();
    renderSmartPlaylistModal();
  }
}

function handleSmartPlaylistRuleClick(event) {
  const button = event.target.closest("[data-smart-action]");
  if (!button) return;
  event.preventDefault();
  const row = button.closest(".smart-rule-row");
  const index = Number(row?.dataset.index || 0);
  if (button.dataset.smartAction === "remove-rule") removeSmartRule(index);
}

async function saveSmartPlaylistFromModal() {
  const draft = collectSmartPlaylistDraft();
  const existingIndex = state.smartPlaylists.findIndex((playlist) => playlist.id === draft.id);
  if (existingIndex >= 0) state.smartPlaylists.splice(existingIndex, 1, draft);
  else state.smartPlaylists.push(draft);
  saveSmartPlaylists();
  closeSmartPlaylistBuilder();
  renderBrowseMenus();
  await loadSmartPlaylist(draft.id);
}

function buildStarredBrowseEntries(albums, tracks) {
  const favouritedAlbumIds = new Set(albums.map((album) => String(album.id)));
  const albumEntries = albums.map((album) => ({
    ...album,
    subtitle: album.subtitle || [album.artist, album.year].filter(Boolean).join(" - ")
  }));
  const trackEntries = tracks
    .filter((track) => !favouritedAlbumIds.has(String(track.albumId || "")))
    .map((track) => ({
      ...track,
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(" - ")
    }));
  return [...albumEntries, ...trackEntries].sort((left, right) =>
    String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" })
  );
}

async function loadStarredBrowse() {
  setStatus("Loading favourites...");
  await loadFavourites();
  const [tracksData, albumsData] = await Promise.all([
    apiGet("/api/library/starred/tracks").catch(() => ({ tracks: [] })),
    fetchAlbums(0, "favourite", 1000).catch(() => ({ albums: [], total: 0 }))
  ]);
  const tracks = (tracksData.tracks || []).map(normalizeTrack);
  const albums = albumsData.albums || [];
  state.mode = BROWSE_MODE.STARRED;
  state.albumFilter = "";
  state.activePlaylistId = "";
  state.entries = buildStarredBrowseEntries(albums, tracks);
  state.total = state.entries.length;
  state.textures = [];
  state.texturePromises.clear();
  state.browseIndex = 0;
  state.drawerTitle = "Favourite";
  state.drawerSubtitle = "Favourite songs and albums";
  state.drawerTracks = tracks;
  syncAlbumSlides({ jump: true });
  updateBrowseSummary(true);
  renderBrowseMenus();
  clearStatus();
  saveBrowseState();
}

function parseBitrateFromTitle(title) {
  const match = String(title || "").match(/\(\s*(\d+)\s*k(?:bps)?\s*\)/i);
  return match ? Number(match[1]) : 0;
}

function inferCodecFromStream(streamUrl) {
  const lower = String(streamUrl || "").toLowerCase();
  if (lower.includes(".m3u8") || lower.includes(".isml") || lower.includes("/hls/")) return "HLS";
  if (lower.includes("aac")) return "AAC";
  if (lower.includes("mp3")) return "MP3";
  if (lower.includes("opus")) return "OPUS";
  if (lower.includes("ogg")) return "OGG";
  return "";
}

function normalizeRadioCodec(streamUrl, codec) {
  const value = String(codec || "").trim();
  if (value && value.toUpperCase() !== "UNKNOWN") {
    return value.toUpperCase();
  }
  return inferCodecFromStream(streamUrl);
}

function normalizeRadioStation(station) {
  const title = station.name || "Radio";
  const streamUrl = station.url || station.streamUrl || "";
  const bitrate = Number(station.bitrate || 0) || parseBitrateFromTitle(title);
  const codec = normalizeRadioCodec(streamUrl, station.codec);
  return {
    kind: "radio",
    id: String(station.id || station.externalUuid || streamUrl || title || ""),
    title,
    subtitle: station.genre || station.tags || "Internet radio",
    streamUrl,
    artUrl: station.artUrl || station.favicon || "",
    bitrate,
    codec,
    favourite: Boolean(station.favourite),
    starred: Boolean(station.favourite),
    externalUuid: station.externalUuid || "",
    homepage: station.homepage || "",
    country: station.country || "",
    source: station.source || "manual"
  };
}

function formatRadioSearchTitle(title) {
  return String(title || "Radio")
    .replace(/\s*\(\s*\d+\s*k(?:bps)?\s*\)\s*$/i, "")
    .replace(/\s*\(\s*\d+\s*kbps\s*\)\s*$/i, "")
    .trim() || "Radio";
}

function formatRadioSearchStreamInfo(entry) {
  const parts = [];
  if (entry.codec) parts.push(entry.codec);
  if (entry.bitrate > 0) parts.push(`${entry.bitrate} kbps`);
  return parts.join(" · ");
}

function renderRadioSearchStreamInfo(entry) {
  const text = formatRadioSearchStreamInfo(entry);
  if (!text) return "";
  return `<span class="search-result-detail">${escapeHtml(text)}</span>`;
}

function renderRadioSearchLogo(entry) {
  const src = radioIconProxyUrl(entry, 128);
  return `
    <span class="search-result-logo-wrap">
      <img class="search-result-logo" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.classList.add('search-result-logo-empty')">
    </span>
  `;
}

async function loadRadioBrowse(scope = state.radioScope || "favourites") {
  const nextScope = scope === "all" ? "all" : "favourites";
  const enteringRadio = state.mode !== BROWSE_MODE.RADIO;
  const scopeChanged = state.radioScope !== nextScope;
  state.radioScope = nextScope;
  setStatus(state.radioScope === "favourites" ? "Loading favourite radio..." : "Loading radio stations...");
  const data = await apiGet(`/api/library/radio?scope=${encodeURIComponent(state.radioScope)}`);
  state.mode = BROWSE_MODE.RADIO;
  state.albumFilter = "";
  state.activePlaylistId = "";
  state.entries = (data.stations || []).map(normalizeRadioStation);
  state.total = state.entries.length;
  if (enteringRadio || scopeChanged) {
    state.textures = [];
    state.texturePromises.clear();
    invalidateRadioTextures();
  }
  state.browseIndex = clamp(state.browseIndex, 0, Math.max(0, state.entries.length - 1));
  presentLibraryEntries({ jump: true });
  renderBrowseMenus();
  clearStatus();
  saveBrowseState();
}

async function toggleRadioFavourite(entry) {
  if (!entry) return;
  const next = !entry.favourite;
  let data;
  const shouldCreate = entry.source === "radio-browser" && !entry.favourite && next && !isRadioStationSaved(entry);
  if (shouldCreate) {
    data = await apiPost("/api/library/radio/stations", {
      name: entry.title,
      url: entry.streamUrl,
      homepage: entry.homepage || "",
      favicon: hasRadioFavicon(entry) ? String(entry.artUrl || entry.favicon || "").trim() : "",
      country: entry.country || "",
      tags: entry.subtitle || "",
      externalUuid: entry.externalUuid || "",
      source: entry.source || "radio-browser",
      favourite: true
    });
    Object.assign(entry, normalizeRadioStation(data.station || entry));
    entry.saved = true;
  } else {
    const stationId = await resolveRadioStationLibraryId(entry);
    if (!stationId) return;
    data = await apiPost("/api/library/radio/favourites", { stationId, starred: next });
    entry.favourite = next;
    entry.starred = next;
    if (data.station) {
      Object.assign(entry, normalizeRadioStation(data.station));
      entry.saved = true;
    }
  }
  if (state.mode === BROWSE_MODE.RADIO) {
    await loadRadioBrowse(state.radioScope);
  } else {
    renderSongsDrawer();
    updateBrowseSummary(true);
  }
  if (state.radioInternetSearch && state.searchOpen) {
    renderSearchPanel();
  }
  setStatus(next ? `Favourited ${entry.title}` : `Removed ${entry.title} from favourites`);
  window.setTimeout(clearStatus, 1400);
}

function isRadioStationSaved(entry) {
  if (!entry) return false;
  if (entry.saved) return true;
  const id = String(entry.id || "");
  const externalUuid = String(entry.externalUuid || "");
  if (!id) return false;
  if (externalUuid && id === externalUuid) return false;
  return true;
}

function getRadioDrawerScopeLabel() {
  return state.radioScope === "favourites" ? "Favourite stations" : "Saved stations";
}

function getRadioDrawerSubtitle(entry) {
  const parts = [];
  if (entry?.country) parts.push(entry.country);
  if (entry?.subtitle && entry.subtitle !== "Internet radio") parts.push(entry.subtitle);
  const streamInfo = formatRadioSearchStreamInfo(entry);
  if (streamInfo) parts.push(streamInfo);
  return parts.join(" · ") || "Internet radio";
}

function getRadioDrawerTracksPresentation(entry) {
  return {
    title: getRadioDrawerScopeLabel(),
    subtitle: entry?.country || entry?.subtitle || "Internet radio",
    tracks: [{ ...entry, kind: "radio" }]
  };
}

function getDrawerTrackSubject(track) {
  if (!track) return null;
  if (track.kind === "radio") return { type: "radio", entry: track };
  return { type: "song", track };
}

async function resolveRadioStationLibraryId(entry) {
  if (!entry) return "";
  const id = String(entry.id || "");
  const externalUuid = String(entry.externalUuid || "");
  if (id && (!externalUuid || id !== externalUuid)) return id;
  const streamUrl = String(entry.streamUrl || "");
  const matchSaved = (stations) => stations.find((station) => {
    if (streamUrl && station.streamUrl === streamUrl) return true;
    if (externalUuid && station.externalUuid === externalUuid) return true;
    return id && station.id === id;
  });
  if (state.mode === BROWSE_MODE.RADIO) {
    const local = matchSaved(state.entries);
    if (local?.id) return local.id;
  }
  const data = await apiGet("/api/library/radio?scope=all").catch(() => ({ stations: [] }));
  const saved = (data.stations || []).map(normalizeRadioStation);
  return matchSaved(saved)?.id || id;
}

function markRadioSearchEntryUnsaved(entry) {
  if (!entry) return;
  entry.saved = false;
  entry.favourite = false;
  entry.starred = false;
  if (entry.externalUuid) entry.id = entry.externalUuid;
  else if (entry.streamUrl) entry.id = entry.streamUrl;
}

async function removeRadioStationFromLibrary(entry) {
  if (!entry) return;
  const stationId = await resolveRadioStationLibraryId(entry);
  if (!stationId && !entry.streamUrl) return;
  const confirmed = await openConfirmDialog({
    title: "Remove station?",
    message: `Remove "${entry.title || "this station"}" from your saved stations?`,
    confirmLabel: "Remove",
    cancelLabel: "Cancel",
    danger: true
  });
  if (!confirmed) return;
  const data = await apiPost("/api/library/radio/remove", {
    stationId,
    streamUrl: entry.streamUrl || ""
  });
  if (!data?.ok) {
    throw new Error(data?.error || "Could not remove station");
  }
  markRadioSearchEntryUnsaved(entry);
  setStatus(`Removed ${entry.title || "station"} from saved stations`);
  window.setTimeout(clearStatus, 1600);
  closeSongContextMenu();
  closeRadioSearchContextMenu();
  setDrawerOpen(false);
  if (state.mode === BROWSE_MODE.RADIO) {
    await loadRadioBrowse(state.radioScope || "all");
  } else if (state.radioInternetSearch && state.searchOpen) {
    renderSearchPanel();
  }
}

async function saveRadioStationFromSearch(entry, favourite = true) {
  if (isRadioStationSaved(entry) && !favourite) {
    setStatus(`${entry.title} is already in your radio stations`);
    window.setTimeout(clearStatus, 1400);
    return;
  }
  const payload = {
    name: entry.title,
    url: entry.streamUrl,
    homepage: entry.homepage || "",
    favicon: hasRadioFavicon(entry) ? String(entry.artUrl || entry.favicon || "").trim() : "",
    country: entry.country || "",
    tags: entry.subtitle || "",
    externalUuid: entry.externalUuid || "",
    source: entry.source || "radio-browser",
    favourite
  };
  const data = await apiPost("/api/library/radio/stations", payload);
  if (data.station) {
    Object.assign(entry, normalizeRadioStation(data.station));
    entry.saved = true;
  }
  if (state.mode === BROWSE_MODE.RADIO) {
    await loadRadioBrowse(state.radioScope);
  }
  if (state.radioInternetSearch && state.searchOpen) {
    renderSearchPanel();
  }
  setStatus(favourite ? `Saved and favourited ${entry.title}` : `Saved ${entry.title} to your radio stations`);
  window.setTimeout(clearStatus, 1400);
}

async function loadRegularPlaylist(playlistId) {
  const playlist = state.playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  setStatus(`Loading ${playlist.name}...`);
  const data = await apiGet(`/api/library/playlists/${encodeURIComponent(playlistId)}/tracks`);
  const tracks = (data.tracks || []).map(normalizeTrack);
  state.mode = BROWSE_MODE.PLAYLIST;
  state.activePlaylistId = playlist.id;
  state.albumFilter = "";
  if (state.playlistDisplayMode === "album") {
    const albums = new Map();
    for (const track of tracks) {
      const key = track.albumId || track.album || track.id;
      if (!albums.has(key)) {
        albums.set(key, normalizeAlbum({
          id: track.albumId || key,
          title: track.album || track.title,
          artist: track.artist,
          albumArtist: track.albumArtist,
          year: track.year,
          genre: track.genre,
          artUrl: track.artUrl
        }));
      }
    }
    state.entries = [...albums.values()];
  } else {
    state.entries = tracks.map((track) => ({
      ...track,
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(" - ")
    }));
  }
  state.total = state.entries.length;
  state.textures = [];
  state.texturePromises.clear();
  state.browseIndex = 0;
  syncAlbumSlides({ jump: true });
  state.drawerTitle = playlist.name;
  state.drawerSubtitle = playlist.name;
  state.drawerTracks = tracks;
  updateBrowseSummary(true);
  renderBrowseMenus();
  clearStatus();
  saveBrowseState();
}

async function loadBrowseMode(mode) {
  if (mode === BROWSE_MODE.RATING) {
    await loadAlbums({ resetIndex: true, filter: "toprated", mode: BROWSE_MODE.RATING });
    renderBrowseMenus();
    return;
  }
  if (mode === BROWSE_MODE.STARRED) {
    await loadStarredBrowse();
    return;
  }
  if (mode === BROWSE_MODE.RADIO) {
    await loadRadioBrowse();
    return;
  }
}

function invalidateDrawerCaches() {
  albumDrawerTrackCache.clear();
  lastDrawerEntryKey = "";
  state.starredTracksCache = [];
}

async function toggleTrackFavourite(track) {
  const file = track?.file || track?.id;
  if (!file) return;
  const next = !state.favouriteTracks.has(file);
  await apiPost("/api/library/favourites", { trackId: file, starred: next });
  invalidateDrawerCaches();
  if (next) state.favouriteTracks.add(file);
  else state.favouriteTracks.delete(file);
  track.starred = next;
  const entry = state.entries.find((item) => sameTrack(item, track));
  if (entry) entry.starred = next;
  if (state.mode === BROWSE_MODE.STARRED) {
    await loadStarredBrowse();
  } else if (state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "favourite") {
    await loadSongBrowse("favourite");
  } else {
    renderSongsDrawer();
  }
  setStatus(next ? `Favourited ${track.title || "song"}` : `Removed favourite from ${track.title || "song"}`);
  window.setTimeout(clearStatus, 1400);
}

async function toggleAlbumFavourite(entry) {
  const albumId = String(entry?.id || entry?.albumId || "");
  if (!albumId) return;
  const next = !state.favouriteAlbums.has(albumId);
  await apiPost("/api/library/favourites", { albumId, starred: next });
  invalidateDrawerCaches();
  if (next) state.favouriteAlbums.add(albumId);
  else state.favouriteAlbums.delete(albumId);
  entry.starred = next;
  entry.albumStarred = next;
  if (state.mode === BROWSE_MODE.STARRED) {
    await loadStarredBrowse();
  } else if (state.mode === BROWSE_MODE.ALBUM && state.albumBrowseScope === "favourite") {
    await loadAlbumBrowse("favourite");
  } else {
    renderSongsDrawer();
  }
  setStatus(next ? `Favourited album ${entry.title || entry.album || ""}` : `Removed favourite from album ${entry.title || entry.album || ""}`);
  window.setTimeout(clearStatus, 1200);
}

function getPlaylistCreateDefaultName(subject) {
  if (!subject) return "";
  if (subject.type === "album") return subject.entry?.title || subject.entry?.album || "";
  return subject.track?.album || "";
}

function getPlaylistCreatePreview(subject) {
  if (!subject) return "Create an empty playlist, then add songs from the song menu.";
  if (subject.type === "song") {
    return `Adds "${subject.track?.title || "song"}" to the new playlist.`;
  }
  if (subject.type === "album") {
    return `Adds all songs from "${subject.entry?.title || subject.entry?.album || "album"}" to the new playlist.`;
  }
  return "Save a new playlist to your library.";
}

function openPlaylistModal(subject = null) {
  closeDropdowns();
  state.playlistCreateSubject = subject;
  el.playlistNameInput.value = getPlaylistCreateDefaultName(subject);
  el.playlistCreatePreview.textContent = getPlaylistCreatePreview(subject);
  el.playlistModal.classList.remove("hidden");
  el.playlistModal.setAttribute("aria-hidden", "false");
  syncModalKeyboardLayout();
  scheduleLayoutPlayer();
  requestAnimationFrame(centerPlaylistDialog);
}

function closePlaylistModal() {
  el.playlistModal.classList.add("hidden");
  el.playlistModal.setAttribute("aria-hidden", "true");
  state.playlistCreateSubject = null;
  closeTouchKeyboard();
  syncModalKeyboardLayout();
}

async function savePlaylistFromModal() {
  const trimmed = el.playlistNameInput.value.trim();
  if (!trimmed) {
    setStatus("Enter a playlist name.");
    window.setTimeout(clearStatus, 1400);
    el.playlistNameInput.focus();
    return;
  }
  const subject = state.playlistCreateSubject;
  closePlaylistModal();
  let trackId = "";
  let extraTracks = [];
  if (subject?.type === "song") {
    trackId = subject.track?.file || subject.track?.id || "";
  } else if (subject?.type === "album") {
    const tracks = await fetchAlbumTracks(subject.entry);
    if (!tracks.length) {
      setStatus("No album songs available to add.");
      window.setTimeout(clearStatus, 1600);
      return;
    }
    trackId = tracks[0]?.file || tracks[0]?.id || "";
    extraTracks = tracks.slice(1);
  }
  const result = await apiPost("/api/library/playlists", { name: trimmed, trackId });
  const playlistId = result.playlist?.id;
  if (playlistId && extraTracks.length) {
    for (const track of extraTracks) {
      await apiPost("/api/library/playlists/tracks", {
        playlistId,
        trackId: track.file || track.id
      });
    }
  }
  await loadPlaylists();
  renderBrowseMenus();
  setStatus(`Created playlist "${trimmed}"`);
  window.setTimeout(clearStatus, 1600);
}

async function promptCreatePlaylist(subject) {
  openPlaylistModal(subject);
}

async function loadSmartPlaylist(playlistId) {
  const playlist = state.smartPlaylists.find((item) => item.id === playlistId);
  if (!playlist) return;
  setStatus(`Loading ${playlist.name}...`);
  if (!state.albumMeta.size) {
    await fetchAlbums(0).catch(() => ({ albums: [] }));
  }
  const tracks = applySmartPlaylist(playlist, await fetchAllTracks());
  state.mode = BROWSE_MODE.SMART_PLAYLIST;
  state.activeSmartPlaylistId = playlist.id;
  state.smartPlaylistTracks = tracks;
  if (state.playlistDisplayMode === "album") {
    state.entries = buildAlbumEntriesFromTracks(tracks);
  } else {
    state.entries = tracks.map((track) => ({
      ...track,
      title: track.title,
      subtitle: [track.artist, track.album].filter(Boolean).join(" - ")
    }));
  }
  state.total = state.entries.length;
  state.textures = [];
  state.texturePromises.clear();
  state.browseIndex = 0;
  state.drawerTitle = playlist.name;
  state.drawerSubtitle = `${tracks.length} matched ${tracks.length === 1 ? "song" : "songs"}`;
  state.drawerTracks = tracks;
  syncAlbumSlides({ jump: true });
  updateBrowseSummary(true);
  renderBrowseMenus();
  clearStatus();
  saveBrowseState();
}

function applySmartPlaylist(playlist, tracks) {
  const matched = tracks.filter((track) => smartPlaylistMatchesTrack(playlist, track));
  const sorted = sortSmartTracks(matched, playlist.limitSort);
  if (!playlist.limitEnabled) return sorted;
  return sorted.slice(0, clamp(Number(playlist.limitCount) || 25, 1, 999));
}

function smartPlaylistMatchesTrack(playlist, track) {
  if (!playlist.matchEnabled || !playlist.rules?.length) return true;
  const checks = playlist.rules.map((rule) => smartRuleMatchesTrack(rule, track));
  return playlist.matchMode === "any" ? checks.some(Boolean) : checks.every(Boolean);
}

function smartRuleMatchesTrack(rule, track) {
  const actual = getSmartTrackValue(track, rule.field);
  const operator = rule.operator || "is";
  const expected = rule.value ?? "";
  const expected2 = rule.value2 ?? "";
  if (operator === "in-range") {
    const n = Number(actual);
    return Number.isFinite(n) && n >= Number(expected) && n <= Number(expected2);
  }
  if (["greater-than", "less-than"].includes(operator)) {
    const n = Number(actual);
    const target = Number(expected);
    if (!Number.isFinite(n) || !Number.isFinite(target)) return false;
    return operator === "greater-than" ? n > target : n < target;
  }
  const a = String(actual ?? "").toLowerCase();
  const b = String(expected ?? "").toLowerCase();
  if (operator === "is") return a === b;
  if (operator === "is-not") return a !== b;
  if (operator === "does-not-contain") return !a.includes(b);
  return a.includes(b);
}

function getSmartTrackValue(track, field) {
  const values = {
    album: track.album,
    albumArtist: track.albumArtist,
    artist: track.artist,
    bitRate: track.bitRate,
    bpm: track.bpm,
    category: track.category,
    comments: track.comments,
    compilation: track.compilation,
    composer: track.composer,
    dateAdded: track.dateAdded,
    dateModified: track.dateModified,
    description: track.description,
    discNumber: track.discNumber,
    genre: track.genre,
    grouping: track.grouping,
    kind: track.suffix || track.kind,
    lastPlayed: track.lastPlayed,
    lastSkipped: track.lastSkipped,
    location: track.file,
    mediaKind: "Music",
    movementName: track.movementName,
    movementNumber: track.movementNumber,
    playlist: "",
    plays: track.plays,
    purchased: track.purchased,
    rating: track.rating,
    sampleRate: track.sampleRate,
    size: track.size,
    skips: track.skips,
    sortAlbum: track.album,
    sortAlbumArtist: track.albumArtist,
    sortArtist: track.artist,
    sortComposer: track.composer,
    sortShow: track.sortShow,
    sortTitle: track.title,
    ticked: "true",
    time: track.duration,
    title: track.title,
    year: track.year
  };
  return values[field] ?? "";
}

function sortSmartTracks(tracks, sortKey = "album") {
  const copy = [...tracks];
  if (sortKey === "random") return copy.sort(() => Math.random() - 0.5);
  const numericSorts = {
    "highest-rating": ["rating", -1],
    "lowest-rating": ["rating", 1],
    "most-often-played": ["plays", -1],
    "least-often-played": ["plays", 1],
    "most-recently-played": ["lastPlayed", -1],
    "least-recently-played": ["lastPlayed", 1],
    "most-recently-added": ["dateAdded", -1],
    "least-recently-added": ["dateAdded", 1]
  };
  if (numericSorts[sortKey]) {
    const [field, direction] = numericSorts[sortKey];
    return copy.sort((a, b) => direction * compareSmartValues(getSmartTrackValue(a, field), getSmartTrackValue(b, field)));
  }
  return copy.sort((a, b) => {
    const primary = compareSmartValues(getSmartTrackValue(a, sortKey), getSmartTrackValue(b, sortKey));
    if (primary) return primary;
    return compareSmartValues(a.trackNo, b.trackNo) || compareSmartValues(a.title, b.title);
  });
}

function compareSmartValues(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

function usesAlbumPagination() {
  return ALBUM_BROWSE_MODES.includes(state.mode)
    || (state.mode === BROWSE_MODE.SONGS && state.songsDisplayMode === "album");
}

async function maybeLoadMoreAlbums() {
  if (!usesAlbumPagination() || state.loadingMore) return;
  if (state.entries.length >= state.total) return;
  if (state.browseIndex < state.entries.length - 24) return;
  state.loadingMore = true;
  try {
    const filter = state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "favourite"
      ? "favourite"
      : state.albumFilter;
    const data = await fetchAlbums(state.entries.length, filter);
    state.entries.push(...data.albums);
    state.total = data.total;
    syncAlbumSlides();
    updateBrowseSummary();
  } finally {
    state.loadingMore = false;
  }
}

async function maybeLoadMoreTracks() {
  if (state.mode !== BROWSE_MODE.SONGS || state.songsDisplayMode !== "song" || state.loadingMore) return;
  if (state.songsBrowseScope === "favourite") return;
  if (state.entries.length >= state.total) return;
  if (state.browseIndex < state.entries.length - 24) return;
  state.loadingMore = true;
  try {
    const data = await fetchTracksPage(state.entries.length, PAGE_SIZE);
    state.entries.push(...buildSongBrowseEntries(data.tracks));
    state.total = data.total;
    syncAlbumSlides();
    updateBrowseSummary();
  } finally {
    state.loadingMore = false;
  }
}

function ensureTexture(index) {
  const entry = state.entries[index];
  if (!entry) return;
  const url = albumArtUrl(entry, 420);
  if (!state.texturePromises.has(url)) {
    state.texturePromises.set(
      url,
      loadCoverTexture(entry, url).then((texture) => {
        for (let slot = 0; slot < state.entries.length; slot += 1) {
          const slotEntry = state.entries[slot];
          if (!slotEntry || albumArtUrl(slotEntry, 420) !== url) continue;
          const resolved = resolveCoverTexture(slotEntry, slot, texture);
          state.textures[slot] = resolved;
          setTextureAtIndex(slot, resolved);
        }
        renderOnce();
        return texture;
      })
    );
  }
  state.texturePromises.get(url).then((texture) => {
    if (state.entries[index] !== entry) return;
    const resolved = resolveCoverTexture(entry, index, texture);
    if (state.textures[index] !== resolved) {
      state.textures[index] = resolved;
      setTextureAtIndex(index, resolved);
      renderOnce();
    }
  });
}

function ensureTextures(anchor = state.browseIndex) {
  const center = clamp(anchor, 0, Math.max(0, state.entries.length - 1));
  const sideCount = getSideCount();
  const start = Math.max(0, center - sideCount);
  const end = Math.min(state.entries.length - 1, center + sideCount);
  for (let index = start; index <= end; index += 1) ensureTexture(index);
}

function syncAlbumSlides({ jump = false } = {}) {
  while (state.textures.length < state.entries.length) state.textures.push(null);
  if (state.textures.length > state.entries.length) state.textures.length = state.entries.length;
  ensureTextures();
  setAlbumData(state.entries.map((entry, index) => coverTextureForEntry(entry, index)));
  if (jump && state.entries.length) jumpTo(state.browseIndex, { suppressSnap: true });
  updateBrowseStrip();
  scheduleLayoutPlayer();
  if (isExternalInputActive()) {
    state.externalCoverAppliedIndex = -1;
    state.externalPollutedIndices.clear();
    syncExternalSourceCover();
  }
}

function handleSnap(index) {
  state.browseIndex = clamp(index, 0, Math.max(0, state.entries.length - 1));
  state.activeInfoMenuMode = "closed";
  ensureTextures();
  updateBrowseSummary(true);
  scheduleLayoutPlayer();
  if (isExternalInputActive()) syncExternalSourceCover();
  else scheduleSnapBackToPlaying({ restart: true });
  maybeLoadMoreAlbums();
  maybeLoadMoreTracks();
}

function previewBrowseEntryLabel() {
  const entry = state.entries[state.browseIndex];
  if (!entry) return;
  state.currentEntry = entry;
  if (isExternalInputActive() && state.currentSong?.title) return;
  if (state.playing && state.currentSong?.title && entryMatchesCurrentSong(entry)) {
    el.trackTitle.textContent = state.currentSong.title || "Unknown";
    el.trackArtist.textContent = state.currentSong.album || "\u00A0";
    scheduleLayoutPlayer();
    return;
  }
  if (entry.kind === "song") {
    el.trackTitle.textContent = entry.title || "Unknown";
    el.trackArtist.textContent = [entry.artist, entry.album].filter(Boolean).join(" - ") || "\u00A0";
  } else if (state.mode === BROWSE_MODE.RADIO && entry.kind === "radio") {
    el.trackTitle.textContent = entry.title || "Radio";
    el.trackArtist.textContent = entry.subtitle || entry.country || "Internet radio";
  } else {
    el.trackTitle.textContent = entry.title || "Unknown";
    el.trackArtist.textContent = entry.subtitle || entry.artist || entry.album || "\u00A0";
  }
  scheduleLayoutPlayer();
}

function navigateBrowseBy(delta) {
  navigateBrowseTo(state.browseIndex + delta);
}

function navigateBrowseTo(index, { immediate = false, suppressSnapBack = false } = {}) {
  if (!state.entries.length) return;
  const nextIndex = clamp(Math.round(index), 0, state.entries.length - 1);
  state.browseIndex = nextIndex;
  ensureTextures(nextIndex);
  updateBrowseStrip();
  previewBrowseEntryLabel();
  if (immediate) {
    jumpTo(nextIndex, { suppressSnap: true });
  } else {
    // navigateTo (animated) — never jumpTo here; jumpTo kills the zoom transition.
    navigateTo(nextIndex);
  }
  if (isExternalInputActive()) syncExternalSourceCover();
  else if (!suppressSnapBack) scheduleSnapBackToPlaying({ restart: true });
  if (state.drawerOpen) refreshDrawerContextIfNeeded();
}

function handleBrowseStripInput() {
  if (!state.entries.length) {
    updateBrowseStrip();
    return;
  }
  const nextIndex = Number(el.browseStrip.value || 0);
  navigateBrowseTo(nextIndex);
}

function getBrowsableIndex() {
  if (!state.entries.length) return 0;
  const rendererIndex = getTargetIndex();
  if (
    Number.isInteger(rendererIndex)
    && rendererIndex >= 0
    && rendererIndex < state.entries.length
    && rendererIndex !== state.browseIndex
  ) {
    state.browseIndex = rendererIndex;
    updateBrowseStrip();
  }
  return clamp(state.browseIndex, 0, state.entries.length - 1);
}

function getCurrentEntry() {
  return state.entries[getBrowsableIndex()] || null;
}

async function startPlaybackForEntry(entry = getCurrentEntry()) {
  if (!entry) return;
  if (isExternalInputActive()) {
    setStatus(`${externalInputLabel()} is active. Disconnect to play from your library.`);
    window.setTimeout(clearStatus, 2200);
    return;
  }
  if (entry.kind === "radio") {
    await playRadio(entry);
    return;
  }
  if (entry.kind === "song") {
    await playTrack(entry);
    return;
  }
  await playAlbum(entry);
}

function shouldUseRadioBrowseTransport() {
  return (
    state.mode === BROWSE_MODE.RADIO ||
    isRadioInputActive() ||
    isRadioPlaybackTrack(state.currentSong)
  );
}

async function handleRadioBrowseOffset(delta) {
  if (!state.entries.length) return;
  let index = getBrowsableIndex();
  if (state.currentSong && (isRadioInputActive() || isRadioPlaybackTrack(state.currentSong))) {
    const playingIndex = currentPlayingBrowseIndex();
    if (playingIndex >= 0) index = playingIndex;
  }
  const nextIndex = clamp(index + delta, 0, state.entries.length - 1);
  if (nextIndex === index) return;
  const entry = state.entries[nextIndex];
  if (!entry || entry.kind !== "radio") return;
  navigateBrowseTo(nextIndex, { suppressSnapBack: true });
  await playRadio(entry);
}

function handlePrevTrack() {
  if (shouldUseRadioBrowseTransport()) {
    return handleRadioBrowseOffset(-1).catch(showError);
  }
  if (isBrowserPlayback()) return playBrowserQueueOffset(-1);
  return apiPost("/api/player/previous").catch(() => apiPost("/api/previous")).then(refreshPlayer);
}

function handleNextTrack() {
  if (shouldUseRadioBrowseTransport()) {
    return handleRadioBrowseOffset(1).catch(showError);
  }
  if (isBrowserPlayback()) return playBrowserQueueOffset(1);
  return apiPost("/api/player/next").catch(() => apiPost("/api/next")).then(refreshPlayer);
}

async function togglePlaybackFromControls() {
  if (isExternalInputActive()) {
    const shouldPlay = !state.playing;
    state.playing = shouldPlay;
    state.externalTransportLockUntil = Date.now() + 2500;
    updatePlaybackUi();
    try {
      await apiPost(shouldPlay ? "/api/player/play" : "/api/player/pause").catch(() =>
        apiPost(shouldPlay ? "/api/resume" : "/api/pause")
      );
    } finally {
      await refreshPlayer();
      state.externalTransportLockUntil = Date.now() + 400;
    }
    return;
  }

  const entry = getCurrentEntry();
  if (!entry) return;

  if (isBrowserPlayback()) {
    const hasActiveSource = Boolean(el.audioPlayer.src);
    const matchesCenter = hasActiveSource && entryMatchesCurrentSong(entry, state.currentSong);
    if (!hasActiveSource || !matchesCenter) {
      await startPlaybackForEntry(entry);
      return;
    }
    if (state.playing) {
      el.audioPlayer.pause();
    } else {
      await el.audioPlayer.play().catch(showError);
    }
    syncBrowserPlayerState();
    return;
  }

  if (
    !state.currentSong ||
    !entryMatchesCurrentSong(entry, state.currentSong) ||
    (!state.playing && shouldRebuildAlbumBrowseQueue(entry))
  ) {
    await startPlaybackForEntry(entry);
    await refreshPlayer();
    return;
  }

  const shouldPlay = !state.playing;
  state.playing = shouldPlay;
  state.localTransportLockUntil = Date.now() + 1200;
  updatePlaybackUi();
  const endpoint = shouldPlay ? "/api/player/play" : "/api/player/pause";
  const fallback = shouldPlay ? "/api/resume" : "/api/pause";
  apiPost(endpoint)
    .catch(() => apiPost(fallback))
    .finally(() => {
      state.localTransportLockUntil = Date.now() + 350;
      refreshPlayer().catch(() => {});
    });
}

function updateBrowseSummary(force = false) {
  const entry = getCurrentEntry();
  if (!entry) {
    const empty = getBrowseEmptyLabel();
    el.trackTitle.textContent = empty.title;
    el.trackArtist.textContent = empty.subtitle;
    if (empty.hidePanel) el.infoPanel?.classList.add("is-empty");
    else el.infoPanel?.classList.remove("is-empty");
    updateBrowseStrip();
    return;
  }
  el.infoPanel?.classList.remove("is-empty");
  state.currentEntry = entry;
  if (isExternalInputActive() && state.currentSong?.title) {
    el.trackTitle.textContent = state.currentSong.title || externalInputLabel();
    el.trackArtist.textContent =
      [state.currentSong.artist, state.currentSong.album].filter(Boolean).join(" \u00b7 ") ||
      externalInputLabel();
  } else if (state.mode === BROWSE_MODE.RADIO && entry.kind === "radio") {
    el.trackTitle.textContent = entry.title || "Radio";
    el.trackArtist.textContent = entry.subtitle || entry.country || "Internet radio";
  } else if (state.playing && state.currentSong?.title && entryMatchesCurrentSong(entry)) {
    el.trackTitle.textContent = state.currentSong.title || "Unknown";
    el.trackArtist.textContent = state.currentSong.album || "\u00A0";
  } else if (entry.kind === "song") {
    el.trackTitle.textContent = entry.title || "Unknown";
    el.trackArtist.textContent = [entry.artist, entry.album].filter(Boolean).join(" - ") || "\u00A0";
  } else {
    el.trackTitle.textContent = entry.title || "Unknown";
    el.trackArtist.textContent = entry.subtitle || entry.artist || entry.album || "\u00A0";
  }
  if (force && state.drawerOpen) refreshDrawerContextIfNeeded();
  updateBrowseStrip();
  updatePlaybackUi();
  renderInfoActionMenu();
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

function refreshDrawerContextIfNeeded() {
  const entry = getCurrentEntry();
  const entryKey = getDrawerEntryKey(entry);
  if (entryKey === lastDrawerEntryKey && state.drawerTracks.length && !state.drawerLoading) {
    renderSongsDrawer();
    return;
  }
  void prepareDrawerContext();
}

async function prepareDrawerContext() {
  const entry = getCurrentEntry();
  const entryKey = getDrawerEntryKey(entry);
  const prepareToken = ++drawerPrepareToken;
  state.activeSongMenuIndex = null;
  hideSongInfo();

  const resolved = tryResolveDrawerTracksSync(entry);
  if (resolved) {
    applyDrawerPresentation(resolved);
    state.drawerLoading = false;
    lastDrawerEntryKey = entryKey;
    if (prepareToken === drawerPrepareToken) renderSongsDrawer();
    return;
  }

  state.drawerLoading = true;
  if (state.drawerOpen) renderSongsDrawer();
  try {
    if (state.mode === BROWSE_MODE.SONGS) {
      const favouriteScope = state.songsBrowseScope === "favourite";
      if (entry?.kind === "song") {
        applyDrawerPresentation({
          title: favouriteScope ? "Favourite" : "Songs",
          subtitle: [entry.artist, entry.album].filter(Boolean).join(" - ") || (favouriteScope ? "Favourite song" : "Song"),
          tracks: [entry]
        });
      } else if (favouriteScope) {
        applyDrawerPresentation({
          title: entry?.title || "Favourite",
          subtitle: entry?.artist || entry?.subtitle || "Favourite songs",
          tracks: await loadFavouriteTracksForEntry(entry)
        });
      } else if (state.songsDisplayMode === "album" && entry) {
        applyDrawerPresentation({
          title: entry.title || "Songs",
          subtitle: entry.artist || entry.subtitle || "Album",
          tracks: await fetchAlbumTracksForDrawer(entry)
        });
      } else if (!state.drawerTracks.length) {
        applyDrawerPresentation({
          title: "Songs",
          subtitle: "All songs",
          tracks: await fetchAllTracks()
        });
      }
    } else if (state.mode === BROWSE_MODE.STARRED) {
      if (entry?.kind === "song") {
        applyDrawerPresentation({
          title: "Favourite",
          subtitle: [entry.artist, entry.album].filter(Boolean).join(" - ") || "Favourite song",
          tracks: [entry]
        });
      } else if (entry?.kind === "album") {
        applyDrawerPresentation({
          title: entry.title || "Favourite",
          subtitle: entry.artist || entry.subtitle || "Favourite album",
          tracks: await loadFavouriteTracksForEntry(entry)
        });
      } else {
        applyDrawerPresentation({
          title: "Favourite",
          subtitle: "Favourite songs and albums",
          tracks: await loadFavouriteTracksForEntry(entry)
        });
      }
    } else if (state.mode === BROWSE_MODE.PLAYLIST) {
      const playlist = state.playlists.find((item) => item.id === state.activePlaylistId);
      let tracks = state.drawerTracks;
      if (!tracks.length && playlist) {
        const data = await apiGet(`/api/library/playlists/${encodeURIComponent(playlist.id)}/tracks`);
        tracks = (data.tracks || []).map(normalizeTrack);
      }
      if (entry?.kind === "album") {
        const albumName = entry.album || entry.title;
        tracks = tracks.filter((track) => track.album === albumName);
      } else if (entry?.kind === "song") {
        tracks = [entry];
      }
      applyDrawerPresentation({
        title: entry?.title || playlist?.name || "Playlist",
        subtitle: playlist?.name || "Playlist",
        tracks
      });
    } else if (state.mode === BROWSE_MODE.SMART_PLAYLIST) {
      const playlist = state.smartPlaylists.find((item) => item.id === state.activeSmartPlaylistId);
      let tracks = state.smartPlaylistTracks;
      if (entry?.kind === "album") {
        const albumName = entry.album || entry.title;
        tracks = tracks.filter((track) => track.album === albumName);
      } else if (entry?.kind === "song") {
        tracks = [entry];
      }
      applyDrawerPresentation({
        title: entry?.title || playlist?.name || "Smart Playlist",
        subtitle: playlist?.name || "Smart Playlist",
        tracks
      });
    } else if (state.mode === BROWSE_MODE.RADIO && entry?.kind === "radio") {
      applyDrawerPresentation(getRadioDrawerTracksPresentation(entry));
    } else if (entry?.kind === "song") {
      applyDrawerPresentation({
        title: entry.album || "Songs",
        subtitle: entry.artist || "",
        tracks: entry.album
          ? await fetchAlbumTracksForDrawer({ id: entry.album, album: entry.album, title: entry.album })
          : [entry]
      });
    } else {
      applyDrawerPresentation({
        title: entry?.title || "Songs",
        subtitle: entry?.artist || entry?.subtitle || "",
        tracks: await fetchAlbumTracksForDrawer(entry)
      });
    }
  } finally {
    if (prepareToken !== drawerPrepareToken) return;
    state.drawerLoading = false;
    lastDrawerEntryKey = entryKey;
    renderSongsDrawer();
  }
}

async function setDrawerOpen(open) {
  if (open) {
    if (state.drawerOpen) return;
    closeDropdowns();
    void loadFavourites().catch(() => {});
    await prepareDrawerContext();
    state.drawerOpen = true;
    el.songsDrawer.setAttribute("aria-hidden", "false");
    el.btnDrawer.setAttribute("aria-expanded", "true");
    window.requestAnimationFrame(() => {
      el.songsDrawer.classList.add("is-open");
      el.songsDrawerBackdrop.classList.add("is-open");
      scheduleLayoutPlayer();
    });
    return;
  }

  state.drawerOpen = false;
  drawerPrepareToken += 1;
  el.songsDrawer.classList.remove("is-open");
  el.songsDrawerBackdrop.classList.remove("is-open");
  el.songsDrawer.setAttribute("aria-hidden", "true");
  el.btnDrawer.setAttribute("aria-expanded", "false");
  state.activeSongMenuIndex = null;
  hideSongInfo();
  renderSongsDrawer();
}

function renderSongsDrawer() {
  const drawerEntry = getCurrentEntry();
  const isRadioDrawer = state.mode === BROWSE_MODE.RADIO && (drawerEntry?.kind === "radio" || state.drawerTracks[0]?.kind === "radio");
  el.songsDrawerEyebrow.textContent = state.drawerLoading ? "Loading..." : (isRadioDrawer ? "Radio station" : "Tracks");
  el.songsDrawerTitle.textContent = state.drawerTitle || (isRadioDrawer ? getRadioDrawerScopeLabel() : "Songs");
  el.songsDrawerSubtitle.textContent = state.drawerSubtitle || "\u00A0";
  el.songsDrawerCount.textContent = state.drawerLoading
    ? "..."
    : isRadioDrawer
      ? `${state.drawerTracks.length} ${state.drawerTracks.length === 1 ? "station" : "stations"}`
      : `${state.drawerTracks.length} ${state.drawerTracks.length === 1 ? "song" : "songs"}`;
  const isRadioEntry = drawerEntry?.kind === "radio";
  const hasAlbumContext = Boolean(drawerEntry?.kind === "album" || drawerEntry?.album);
  const albumStarred = isRadioEntry ? Boolean(drawerEntry?.favourite) : isAlbumFavourited(drawerEntry);
  if (drawerEntry && albumStarred) {
    drawerEntry.starred = true;
    if (!isRadioEntry) drawerEntry.albumStarred = true;
  }
  el.btnDrawerFavourite.classList.toggle("hidden", !hasAlbumContext && !isRadioEntry);
  el.btnDrawerFavourite.classList.toggle("is-active", (hasAlbumContext || isRadioEntry) && albumStarred);
  el.btnDrawerFavourite.setAttribute(
    "aria-label",
    isRadioEntry
      ? (albumStarred ? "Remove station favourite" : "Favourite station")
      : (albumStarred ? "Remove album favourite" : "Favourite album")
  );
  el.btnDrawerFavourite.setAttribute(
    "title",
    isRadioEntry
      ? (albumStarred ? "Remove station favourite" : "Favourite station")
      : (albumStarred ? "Remove album favourite" : "Favourite album")
  );
  el.drawerFavouriteIconPath.setAttribute("d", albumStarred ? HEART_ICON_FILLED_PATH : HEART_ICON_OUTLINE_PATH);

  if (state.drawerLoading) {
    el.songsTableBody.innerHTML = `<tr class="songs-empty-row"><td colspan="4">Loading songs...</td></tr>`;
    renderSongContextMenu();
    return;
  }
  if (!state.drawerTracks.length) {
    const emptyLabel = isRadioDrawer ? "No stations available." : "No songs available.";
    el.songsTableBody.innerHTML = `<tr class="songs-empty-row"><td colspan="4">${emptyLabel}</td></tr>`;
    renderSongContextMenu();
    return;
  }

  el.songsTableBody.innerHTML = state.drawerTracks.map((track, index) => {
    const isRadioTrack = track.kind === "radio";
    const isCurrent = state.currentSong && (
      state.currentSong.id === track.id ||
      state.currentSong.file === track.file ||
      (isRadioTrack && state.currentSong.file === track.streamUrl)
    );
    const menuOpen = state.activeSongMenuIndex === index;
    const rowNumber = isCurrent
      ? `<span class="song-current-marker ${state.playing ? "is-playing" : "is-paused"}"><span></span><span></span><span></span></span>`
      : escapeHtml(String(track.trackNo || index + 1));
    const playAction = isRadioTrack ? "play-radio" : "play-song";
    const rowSubtitle = isRadioTrack
      ? getRadioDrawerSubtitle(track)
      : (getTrackDisplayArtist(track) || "\u00A0");
    const rowDuration = isRadioTrack ? "Live" : (track.duration ? formatClock(track.duration) : "--:--");
    const menuLabel = isRadioTrack ? "Station actions" : "Song actions";
    return `
      <tr class="${[isCurrent ? "is-current" : "", menuOpen ? "is-menu-open" : ""].filter(Boolean).join(" ")}">
        <td class="song-row-nr">${rowNumber}</td>
        <td class="song-row-title-cell">
          <button class="song-row-title-wrap" data-action="${playAction}" data-index="${index}">
            <span class="song-row-title">${escapeHtml(track.title)}</span>
            <span class="song-row-subtitle">${escapeHtml(rowSubtitle)}</span>
          </button>
        </td>
        <td class="song-row-duration">${rowDuration}</td>
        <td class="song-row-actions ${menuOpen ? "is-menu-open" : ""}">
          <button class="song-menu-btn" data-action="toggle-song-menu" data-index="${index}" aria-label="${menuLabel}" aria-expanded="${menuOpen ? "true" : "false"}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path fill="currentColor" d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
            </svg>
          </button>
        </td>
      </tr>
    `;
  }).join("");
  renderSongContextMenu();
}

function renderSongContextMenu() {
  const menu = el.songDrawerContextMenu;
  if (!menu) return;
  const index = state.activeSongMenuIndex;
  if (!state.drawerOpen || !Number.isInteger(index) || index < 0 || index >= state.drawerTracks.length) {
    menu.classList.add("hidden");
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML = "";
    return;
  }
  const track = state.drawerTracks[index];
  menu.innerHTML = renderSharedActionMenuContent(getDrawerTrackSubject(track), { actionAttr: "data-action", rowIndex: index });
  menu.classList.remove("hidden");
  menu.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(positionSongContextMenu);
}

function positionSongContextMenu() {
  const menu = el.songDrawerContextMenu;
  const index = state.activeSongMenuIndex;
  if (!menu || menu.classList.contains("hidden") || !Number.isInteger(index)) return;
  const button = el.songsTableBody?.querySelector(`button.song-menu-btn[data-index="${index}"]`);
  if (!button) return;

  portalSongDrawerContextMenu();
  menu.style.position = "fixed";
  menu.style.zIndex = "500";
  menu.style.pointerEvents = "auto";
  menu.style.visibility = "hidden";
  menu.style.display = "block";
  const menuRect = menu.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  const gap = 6;
  const padding = 8;
  let left = rect.right - menuRect.width;
  let top = rect.top - menuRect.height - gap;
  if (top < padding) {
    top = rect.bottom + gap;
  }
  if (left < padding) {
    left = rect.left - menuRect.width - gap;
  }
  if (left < padding) {
    left = rect.right + gap;
  }
  left = clamp(left, padding, Math.max(padding, window.innerWidth - menuRect.width - padding));
  top = clamp(top, padding, Math.max(padding, window.innerHeight - menuRect.height - padding));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.visibility = "";
}

function closeSongContextMenu() {
  if (state.activeSongMenuIndex == null) return;
  state.activeSongMenuIndex = null;
  renderSongsDrawer();
}

function resolveSongDrawerActionIndex(button) {
  const fromButton = Number(button?.dataset?.index);
  if (Number.isInteger(fromButton) && fromButton >= 0) return fromButton;
  const fromState = state.activeSongMenuIndex;
  return Number.isInteger(fromState) && fromState >= 0 ? fromState : 0;
}

async function handleSongDrawerTableClick(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const index = resolveSongDrawerActionIndex(button);
  const action = button.dataset.action;
  const track = state.drawerTracks[index];
  if (action === "toggle-song-menu") {
    state.activeSongMenuIndex = state.activeSongMenuIndex === index ? null : index;
    renderSongsDrawer();
    window.requestAnimationFrame(positionSongContextMenu);
    return;
  }
  closeSongContextMenu();
  await handleSharedSubjectAction(getDrawerTrackSubject(track), action, { index });
  renderSongsDrawer();
}

function renderActionButton({ action, actionAttr, label, rowIndex = null, className = "" }) {
  const rowAttr = Number.isInteger(rowIndex) ? ` data-index="${rowIndex}"` : "";
  const classAttr = className ? ` class="${escapeHtml(className)}"` : "";
  return `<button${classAttr} ${actionAttr}="${escapeHtml(action)}"${rowAttr}>${escapeHtml(label)}</button>`;
}

function renderSharedActionMenuContent(subject, options) {
  const isAlbum = subject?.type === "album";
  const isRadio = subject?.type === "radio";
  return `
    ${isRadio ? "" : renderActionButton({
      action: isAlbum ? "play-album" : "play-song",
      actionAttr: options.actionAttr,
      label: isAlbum ? "Play album" : "Play",
      rowIndex: options.rowIndex
    })}
    ${isRadio ? "" : renderActionButton({
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
    ${isRadio ? renderActionButton({
      action: "remove-from-saved",
      actionAttr: options.actionAttr,
      label: "Remove",
      rowIndex: options.rowIndex
    }) : ""}
  `;
}

function getInfoActionSubject() {
  const entry = getCurrentEntry();
  if (entry?.kind === "radio") return { type: "radio", entry };
  if (state.playing && state.currentSong?.title) return { type: "song", track: state.currentSong };
  if (entry?.kind === "album") return { type: "album", entry };
  if (entry?.kind === "song") return { type: "song", track: entry };
  if (state.currentSong?.title) return { type: "song", track: state.currentSong };
  return null;
}

function renderInfoActionMenu() {
  const subject = getInfoActionSubject();
  const menuOpen = Boolean(subject) && state.activeInfoMenuMode !== "closed";
  const hadActions = el.infoPanel.classList.contains("has-actions");
  const hasActions = Boolean(subject);
  el.infoPanel.classList.toggle("has-actions", hasActions);
  // Do not scheduleLayoutPlayer() here — it used to call refitStage() every browse
  // and killed the coverflow zoom animation. Only re-sync when the menu button toggles.
  if (hadActions !== hasActions) {
    positionReflectionStack(getLayoutCoverBounds());
  }
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
  event.preventDefault();
  event.stopPropagation();
  const action = button.dataset.infoAction;
  const subject = getInfoActionSubject();
  state.activeInfoMenuMode = "closed";
  renderInfoActionMenu();
  await handleSharedSubjectAction(subject, action);
}

async function handleSharedSubjectAction(subject, action, options = {}) {
  const index = Number.isInteger(options.index) ? options.index : 0;
  if (!subject || action === "toggle-song-menu" || action === "toggle-info-menu") return;

  if (action === "play-album" && subject.type === "album") {
    await playAlbum(subject.entry);
  } else if ((action === "play-radio" || action === "play-song") && subject.type === "radio") {
    await playRadio(subject.entry);
  } else if (action === "play-song" && subject.type === "song") {
    await playTrack(subject.track);
  } else if (action === "show-info" || action === "more-info") {
    await showMoreInfo(subject, index);
  } else if (action === "add-to-playlist") {
    await promptCreatePlaylist(subject);
  } else if (action === "toggle-favourite") {
    if (subject.type === "album") await toggleAlbumFavourite(subject.entry);
    else if (subject.type === "radio") await toggleRadioFavourite(subject.entry);
    else await toggleTrackFavourite(subject.track);
  } else if (action === "remove-from-saved" && subject.type === "radio") {
    await removeRadioStationFromLibrary(subject.entry);
  }
}

async function showMoreInfo(subject, index = 0) {
  if (!subject) return;
  if (subject.type === "song") {
    showSongInfoForTrack(subject.track, index);
    return;
  }
  if (subject.type === "radio") {
    showRadioInfo(subject.entry);
    return;
  }
  let tracks = [];
  const drawerEntry = getCurrentEntry();
  if (state.drawerOpen && drawerEntry && String(drawerEntry.id) === String(subject.entry?.id)) {
    tracks = state.drawerTracks;
  } else {
    tracks = await fetchAlbumTracks(subject.entry).catch(() => []);
  }
  showAlbumInfo(subject.entry, tracks);
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
  scheduleLayoutPlayer();
  renderSongsDrawer();
}

function showAlbumInfo(entry, tracks = []) {
  if (!entry) return;
  state.infoTrackIndex = null;
  el.songInfoEyebrow.textContent = "Album Details";
  el.songInfoTitle.textContent = entry.title || "Album Info";
  el.songInfoContent.innerHTML = `<div class="song-info-grid">${buildAlbumInfoRows(entry, tracks)}</div>`;
  el.songInfoModal.classList.remove("hidden");
  el.songInfoModal.setAttribute("aria-hidden", "false");
  scheduleLayoutPlayer();
}

function buildRadioInfoRows(entry) {
  const bitrate = Number(entry.bitrate) > 0 ? `${entry.bitrate} kbps` : "Unknown";
  const codec = entry.codec || inferCodecFromStream(entry.streamUrl) || "Unknown";
  return renderInfoGrid([
    ["Station", entry.title || "Radio"],
    ["Country", entry.country || "Unknown"],
    ["Tags", entry.subtitle || "Unknown"],
    ["Codec", codec],
    ["Bitrate", bitrate],
    ["Stream URL", entry.streamUrl || "Unknown"],
    ["Homepage", entry.homepage || "Unknown"],
    ["Source", entry.source || "Unknown"]
  ]);
}

function showRadioInfo(entry) {
  if (!entry) return;
  state.infoTrackIndex = null;
  state.activeRadioSearchMenuIndex = null;
  el.songInfoEyebrow.textContent = "Station Details";
  el.songInfoTitle.textContent = entry.title || "Radio";
  el.songInfoContent.innerHTML = `<div class="song-info-grid">${buildRadioInfoRows(entry)}</div>`;
  el.songInfoModal.classList.remove("hidden");
  el.songInfoModal.setAttribute("aria-hidden", "false");
  scheduleLayoutPlayer();
  renderRadioSearchContextMenu();
  if (state.radioInternetSearch) {
    renderSearchPanel();
  }
}

function renderInfoGrid(rows) {
  return rows.map(([label, value]) => `
    <div class="song-info-label">${escapeHtml(label)}</div>
    <div class="song-info-value">${escapeHtml(String(value ?? "Unknown"))}</div>
  `).join("");
}

function summarizeAlbumTracks(tracks = []) {
  if (!tracks.length) {
    return { songCount: 0, totalDuration: 0, codec: "", bitrate: "" };
  }
  const codecs = {};
  const bitrates = new Set();
  let totalDuration = 0;
  for (const track of tracks) {
    totalDuration += Number(track.duration) || 0;
    const codec = track.suffix ? String(track.suffix).toUpperCase() : "";
    if (codec) codecs[codec] = (codecs[codec] || 0) + 1;
    if (track.bitRate) bitrates.add(String(track.bitRate));
  }
  const codec = Object.entries(codecs).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return {
    songCount: tracks.length,
    totalDuration,
    codec,
    bitrate: [...bitrates].join(", ")
  };
}

function buildAlbumInfoRows(entry, tracks = []) {
  const summary = summarizeAlbumTracks(tracks);
  const songCount = entry.songCount || summary.songCount || "Unknown";
  const duration = summary.totalDuration ? formatClock(summary.totalDuration) : "Unknown";
  return renderInfoGrid([
    ["Title", entry.title || entry.album || "Untitled Album"],
    ["Artist", entry.artist || "Unknown"],
    ["Album Artist", entry.albumArtist || entry.artist || "Unknown"],
    ["Songs", songCount],
    ["Duration", duration],
    ["Codec", summary.codec || "Unknown"],
    ["Bitrate", summary.bitrate || "Unknown"],
    ["Genre", entry.genre || "Unknown"],
    ["Date", entry.year || "Unknown"],
    ["Album ID", entry.id || "Unknown"]
  ]);
}

function buildSongInfoRows(track, index = 0) {
  return renderInfoGrid([
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
  ]);
}

function hideSongInfo() {
  state.infoTrackIndex = null;
  el.songInfoModal.classList.add("hidden");
  el.songInfoModal.setAttribute("aria-hidden", "true");
}

async function playAlbum(entry = getCurrentEntry()) {
  if (!entry) return;
  markLocalPlaybackOwner();
  lockLocalUiSync();
  const queue = await resolveBrowsePlaybackQueue(entry);
  if (!queue.length) {
    setStatus("No playable songs found.");
    window.setTimeout(clearStatus, 1800);
    return;
  }
  const firstTrack = normalizeTrack(queue[0]);
  if (isBrowserPlayback()) {
    await playBrowserTrack(firstTrack, queue);
    return;
  }
  state.inputSource = "local";
  await postMpdPlayback(firstTrack, queue, {
    albumKey: entry.album || entry.title || entry.id || ""
  });
  state.currentSong = firstTrack;
  await refreshPlayer();
  publishUiContextNow();
}

async function playRadio(entry) {
  if (!entry?.streamUrl && !entry?.id) return;
  markLocalPlaybackOwner();
  lockLocalUiSync();
  if (isBrowserPlayback()) {
    state.currentSong = normalizeTrack({
      kind: "radio",
      id: entry.id || entry.streamUrl,
      title: entry.title,
      artist: entry.subtitle || "Internet radio",
      album: "Internet radio",
      streamUrl: entry.streamUrl,
      file: entry.streamUrl
    });
    el.audioPlayer.src = entry.streamUrl;
    el.audioPlayer.load();
    try {
      await el.audioPlayer.play();
      state.playing = true;
      state.inputSource = "radio";
      if (state.mode !== BROWSE_MODE.RADIO) {
        await loadRadioBrowse(state.radioScope || "all");
      }
      syncBrowseToPlayingSong();
      updateBrowseSummary();
      publishUiContextNow();
    } catch (error) {
      state.playing = false;
      setStatus(`Could not play radio: ${error.message || "stream unavailable"}`);
      window.setTimeout(clearStatus, 2200);
    }
    return;
  }
  state.localTransportLockUntil = Date.now() + 1200;
  try {
    const data = await apiPost("/api/player/radio/play", {
      stationId: entry.id,
      url: entry.streamUrl,
      name: entry.title
    });
    state.inputSource = data.inputSource || "radio";
    state.externalSourceActive = false;
    const song = data.song || {};
    state.currentSong = normalizeTrack({
      kind: "radio",
      id: entry.id || song.file || entry.streamUrl,
      file: song.file || entry.streamUrl,
      title: song.Title || song.title || entry.title,
      artist: song.Artist || song.artist || entry.subtitle || "Internet radio",
      album: song.Album || song.album || "Internet radio",
      streamUrl: entry.streamUrl,
      artUrl: entry.artUrl || data.radio?.artUrl || ""
    });
    state.playing = (data.status || {}).state === "play";
    state.volume = Number((data.status || {}).volume ?? state.volume ?? 0);
    state.elapsed = Number((data.status || {}).elapsed || 0);
    state.duration = Number((data.status || {}).duration || 0);
    state.timelineUpdatedAt = Date.now();
    syncBrowseToPlayingSong();
    updateBrowseSummary(true);
    updatePlaybackUi();
    publishUiContextNow();
  } catch (error) {
    setStatus(`Could not play radio: ${error.message || "stream unavailable"}`);
    window.setTimeout(clearStatus, 2200);
  } finally {
    state.localTransportLockUntil = Date.now() + 350;
  }
}

function browseUsesAlbumEntries() {
  return (
    ALBUM_BROWSE_MODES.includes(state.mode) ||
    (state.mode === BROWSE_MODE.SONGS && state.songsDisplayMode === "album") ||
    (state.mode === BROWSE_MODE.PLAYLIST && state.playlistDisplayMode === "album") ||
    (state.mode === BROWSE_MODE.SMART_PLAYLIST && state.playlistDisplayMode === "album")
  );
}

function browseUsesSongEntries() {
  return (
    (state.mode === BROWSE_MODE.SONGS && state.songsDisplayMode === "song") ||
    (state.mode === BROWSE_MODE.PLAYLIST && state.playlistDisplayMode === "song") ||
    (state.mode === BROWSE_MODE.SMART_PLAYLIST && state.playlistDisplayMode === "song")
  );
}

function isAlbumLikeBrowseEntry(entry) {
  return Boolean(entry && entry.kind !== "song" && entry.kind !== "radio");
}

function shouldRebuildAlbumBrowseQueue(entry = getCurrentEntry()) {
  if (!entry || !browseUsesAlbumEntries() || !isAlbumLikeBrowseEntry(entry)) return false;
  return !state.playlistLength || state.playlistLength <= 1;
}

function findBrowseEntryIndex(entry) {
  if (!entry) return -1;
  return state.entries.findIndex((item) =>
    String(item.id) === String(entry.id) ||
    (entry.file && sameTrack(item, entry)) ||
    (entry.album && String(item.title || item.album) === String(entry.album))
  );
}

function findBrowseEntryIndexForTrack(track) {
  const bySong = state.entries.findIndex((item) => item.kind === "song" && sameTrack(item, track));
  if (bySong >= 0) return bySong;
  const albumName = String(track.album || "");
  return state.entries.findIndex((item) =>
    String(item.id) === String(track.albumId) ||
    String(item.title || item.album) === albumName
  );
}

function sliceQueueFromMatch(queue, trackOrEntry) {
  if (!queue?.length) return [];
  if (!trackOrEntry) return queue;
  const index = queue.findIndex((item) => sameTrack(item, trackOrEntry));
  return index >= 0 ? queue.slice(index) : [];
}

async function buildForwardBrowseQueue(startIndex, maxTracks = 2000) {
  const tracks = [];
  const start = Math.max(0, Number.isInteger(startIndex) ? startIndex : 0);
  for (let i = start; i < state.entries.length && tracks.length < maxTracks; i += 1) {
    const entry = state.entries[i];
    if (!entry || entry.kind === "radio") continue;
    if (entry.kind === "song" || entry.file) {
      tracks.push(normalizeTrack(entry));
      continue;
    }
    const albumTracks = await fetchAlbumTracks(entry).catch(() => []);
    tracks.push(...albumTracks);
  }
  return tracks.filter((item) => item?.file || item?.id);
}

async function resolveBrowsePlaybackQueue(trackOrEntry) {
  if (!trackOrEntry) return [];
  const track = (trackOrEntry.kind === "song" || trackOrEntry.file) ? normalizeTrack(trackOrEntry) : null;
  const entry = trackOrEntry;

  if (state.mode === BROWSE_MODE.PLAYLIST && state.drawerTracks.length) {
    const queue = sliceQueueFromMatch(state.drawerTracks, track || entry);
    if (queue.length) return queue;
  }
  if (state.mode === BROWSE_MODE.SMART_PLAYLIST && state.smartPlaylistTracks?.length) {
    const queue = sliceQueueFromMatch(state.smartPlaylistTracks, track || entry);
    if (queue.length) return queue;
  }
  if (browseUsesSongEntries() && state.drawerTracks.length) {
    const queue = sliceQueueFromMatch(state.drawerTracks, track || entry);
    if (queue.length) return queue;
  }
  if (
    (state.mode === BROWSE_MODE.STARRED || (state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "favourite"))
    && state.drawerTracks.length
  ) {
    const queue = sliceQueueFromMatch(state.drawerTracks, track || entry);
    if (queue.length) return queue;
  }
  if (track && browseUsesAlbumEntries()) {
    const entryIndex = findBrowseEntryIndexForTrack(track);
    if (entryIndex >= 0) {
      const queue = await buildForwardBrowseQueue(entryIndex);
      const startIndex = queue.findIndex((item) => sameTrack(item, track));
      if (startIndex >= 0) return queue.slice(startIndex);
      if (queue.length) return queue;
    }
    const albumKey = track.album || track.albumId;
    if (albumKey) {
      const albumTracks = await fetchAlbumTracks({ album: albumKey, title: albumKey, id: albumKey }).catch(() => []);
      const queue = sliceQueueFromMatch(albumTracks, track);
      if (queue.length) return queue;
    }
  }
  if (state.drawerTracks.length && track) {
    const queue = sliceQueueFromMatch(state.drawerTracks, track);
    if (queue.length) return queue;
  }
  if (browseUsesSongEntries() && state.entries.length && track) {
    const songEntries = state.entries.filter((item) => item.file || item.id).map(normalizeTrack);
    const queue = sliceQueueFromMatch(songEntries, track);
    if (queue.length) return queue;
  }
  if (track) {
    return [track];
  }
  if (isAlbumLikeBrowseEntry(entry)) {
    const entryIndex = findBrowseEntryIndex(entry);
    let queue = await buildForwardBrowseQueue(entryIndex >= 0 ? entryIndex : state.browseIndex);
    if (state.currentSong && entryMatchesCurrentSong(entry, state.currentSong)) {
      queue = sliceQueueFromMatch(queue, state.currentSong);
    }
    return queue;
  }
  return [];
}

function playbackQueueFiles(queue) {
  return queue
    .map((item) => {
      if (item?.file) return item.file;
      const id = String(item?.id || "");
      return /[\\/]/.test(id) || /^https?:\/\//i.test(id) ? id : "";
    })
    .filter(Boolean);
}

async function postMpdPlayback(track, queue, options = {}) {
  const files = playbackQueueFiles(queue);
  const file = track.file || track.id;
  if (!file) return;
  const albumKey = options.albumKey || track.album || track.albumId || "";
  const payload = {
    trackId: track.id,
    file,
    ...(files.length ? { queue: files } : {}),
    ...(albumKey ? { album: albumKey, albumId: albumKey } : {}),
  };
  await apiPost("/api/player/play", payload)
    .catch(() => apiPost("/api/play-track", {
      file,
      title: track.title,
      ...(files.length ? { queue: files } : {}),
      ...(albumKey ? { album: albumKey } : {}),
    }));
}

async function playTrack(track) {
  if (!track) return;
  if (track.kind === "radio" && track.streamUrl) {
    await playRadio(track);
    return;
  }
  markLocalPlaybackOwner();
  lockLocalUiSync();
  const queue = await resolveBrowsePlaybackQueue(track);
  if (!queue.length) return;
  const normalizedTrack = normalizeTrack(track);
  if (isBrowserPlayback()) {
    await playBrowserTrack(normalizedTrack, queue);
    return;
  }
  state.inputSource = "local";
  const browseEntry = getCurrentEntry();
  await postMpdPlayback(normalizedTrack, queue, {
    albumKey: normalizedTrack.album || normalizedTrack.albumId || browseEntry?.album || browseEntry?.title || browseEntry?.id || ""
  });
  state.currentSong = normalizedTrack;
  await refreshPlayer();
  publishUiContextNow();
}

function isBrowserPlayback() {
  return state.settings.audioOutput === BROWSER_OUTPUT_ROUTE;
}

function isExternalInputActive() {
  return state.externalSourceActive && state.inputSource !== "local" && state.inputSource !== "radio";
}

function isRadioInputActive() {
  return state.inputSource === "radio";
}

function externalInputLabel() {
  return state.inputSource === "airplay" ? "AirPlay" : "Bluetooth";
}

function stopBrowserPlayback() {
  if (!el.audioPlayer) return;
  el.audioPlayer.pause();
  el.audioPlayer.removeAttribute("src");
  el.audioPlayer.load();
  state.playing = false;
  state.browserQueue = [];
  state.browserQueueIndex = -1;
}

function rendererCoverUrl(source = state.inputSource, size = 420) {
  return `/api/art?renderer=${encodeURIComponent(source)}&size=${size}&rev=${RENDERER_COVER_REV}`;
}

function reloadLibraryTextureAtIndex(index) {
  if (index < 0 || index >= state.entries.length) return;
  const entry = state.entries[index];
  if (!entry) return;
  const url = albumArtUrl(entry, 420);
  state.textures[index] = null;
  setTextureAtIndex(index, coverTextureForEntry(entry, index));
  state.texturePromises.delete(url);
  if (!state.texturePromises.has(url)) {
    state.texturePromises.set(url, loadCoverTexture(entry, url));
  }
  state.texturePromises.get(url).then((texture) => {
    if (state.entries[index] !== entry) return;
    if (isExternalInputActive() && state.externalPollutedIndices.has(index)) return;
    state.textures[index] = resolveCoverTexture(entry, index, texture);
    setTextureAtIndex(index, state.textures[index]);
    renderOnce();
  });
}

function restoreLibraryTextureAtIndex(index) {
  if (index < 0 || index >= state.entries.length) return;
  state.externalPollutedIndices.delete(index);
  reloadLibraryTextureAtIndex(index);
}

function restoreAllExternalCovers(exceptIndex = -1) {
  for (const index of [...state.externalPollutedIndices]) {
    if (index !== exceptIndex) restoreLibraryTextureAtIndex(index);
  }
  state.externalPollutedIndices.clear();
  if (exceptIndex >= 0) state.externalPollutedIndices.add(exceptIndex);
}

async function syncExternalSourceCover() {
  if (!isExternalInputActive() || !state.entries.length) return;
  const index = clamp(state.browseIndex, 0, state.entries.length - 1);
  const url = rendererCoverUrl(state.inputSource, 420);
  if (state.externalCoverAppliedIndex === index && state.externalArtUrl === url) return;

  restoreAllExternalCovers(index);

  state.externalCoverIndex = index;
  state.externalCoverAppliedIndex = index;
  state.externalArtUrl = url;
  try {
    const textureUrl = albumArtUrl({ artUrl: url }, 420);
    invalidateTexture(textureUrl);
    const texture = await loadTexture(textureUrl);
    if (!isExternalInputActive() || state.externalCoverAppliedIndex !== index) return;
    state.textures[index] = texture || getDefaultTexture();
    setTextureAtIndex(index, state.textures[index]);
    renderOnce();
  } catch (_error) {
    // Keep library art if renderer cover fails to load.
  }
}

function restoreExternalSourceCover() {
  restoreAllExternalCovers();
  state.externalCoverIndex = -1;
  state.externalCoverAppliedIndex = -1;
  state.externalArtUrl = "";
}

function sameTrack(left, right) {
  if (!left || !right) return false;
  return Boolean((left.file && left.file === right.file) || (left.id && left.id === right.id));
}

function browserTrackUrl(track) {
  return `/api/stream?file=${encodeURIComponent(track?.file || track?.id || "")}`;
}

function setBrowserQueue(track, queue = null) {
  const nextQueue = (queue?.length ? queue : state.browserQueue.length ? state.browserQueue : [track])
    .filter((item) => item?.file || item?.id);
  let nextIndex = nextQueue.findIndex((item) => sameTrack(item, track));
  if (nextIndex < 0) {
    nextQueue.push(track);
    nextIndex = nextQueue.length - 1;
  }
  state.browserQueue = nextQueue;
  state.browserQueueIndex = nextIndex;
}

async function playBrowserTrack(track, queue = null) {
  if (!track?.file && !track?.id) return;
  markLocalPlaybackOwner();
  lockLocalUiSync();
  setBrowserQueue(track, queue);
  state.currentSong = track;
  state.inputSource = "local";
  state.elapsed = 0;
  state.duration = Number(track.duration || 0);
  state.timelineUpdatedAt = Date.now();
  el.audioPlayer.volume = clamp(state.volume / 100, 0, 1);
  el.audioPlayer.src = browserTrackUrl(track);
  el.audioPlayer.load();
  try {
    await el.audioPlayer.play();
    state.playing = true;
    updateBrowseSummary();
    publishUiContextNow();
  } catch (error) {
    state.playing = false;
    updatePlaybackUi();
    setStatus(`Browser playback could not start: ${error.message || "unsupported audio format"}`);
    window.setTimeout(clearStatus, 2400);
  }
}

async function playBrowserQueueOffset(offset) {
  const nextIndex = state.browserQueueIndex + offset;
  if (nextIndex < 0 || nextIndex >= state.browserQueue.length) {
    if (offset < 0 && el.audioPlayer.currentTime > 0) {
      el.audioPlayer.currentTime = 0;
      syncBrowserPlayerState();
    }
    return;
  }
  await playBrowserTrack(state.browserQueue[nextIndex], state.browserQueue);
}

let browserQueueAdvanceLock = false;

async function advanceBrowserQueueIfNeeded() {
  if (!isBrowserPlayback() || browserQueueAdvanceLock) return;
  if (state.browserQueueIndex >= state.browserQueue.length - 1) {
    syncBrowserPlayerState();
    return;
  }
  browserQueueAdvanceLock = true;
  try {
    await playBrowserQueueOffset(1);
  } finally {
    browserQueueAdvanceLock = false;
  }
}

function syncBrowserPlayerState(renderRows = true) {
  state.playing = !el.audioPlayer.paused && !el.audioPlayer.ended;
  state.elapsed = Number(el.audioPlayer.currentTime || 0);
  state.duration = Number.isFinite(el.audioPlayer.duration)
    ? Number(el.audioPlayer.duration)
    : Number(state.currentSong?.duration || 0);
  state.timelineUpdatedAt = Date.now();
  state.volume = Math.round(el.audioPlayer.volume * 100);
  updatePlaybackUi({ renderRows });
}

function clearSnapBackTimer() {
  if (!snapBackTimerId) return;
  window.clearTimeout(snapBackTimerId);
  snapBackTimerId = 0;
}

function isUserInspectingLibraryItem() {
  const infoPanelOpen = !el.songInfoModal.classList.contains("hidden");
  return Boolean(
    infoPanelOpen ||
    state.infoTrackIndex != null ||
    state.activeInfoMenuMode !== "closed" ||
    state.drawerOpen ||
    state.activeDropdown ||
    state.searchOpen
  );
}

function entryMatchesCurrentSong(entry = getCurrentEntry(), track = state.currentSong) {
  if (!entry || !track) return false;
  if (entry.kind === "radio" && isRadioPlaybackTrack(track)) {
    const entryStream = normalizeRadioStreamUrl(entry.streamUrl);
    const trackStream = normalizeRadioStreamUrl(track.streamUrl || track.file);
    return Boolean(
      (entry.id && track.id && entry.id === track.id) ||
      (entry.externalUuid && track.externalUuid && entry.externalUuid === track.externalUuid) ||
      (entryStream && trackStream && entryStream === trackStream)
    );
  }
  if (entry.kind === "song") return sameTrack(entry, track);
  const albumNames = [
    entry.album,
    entry.title,
    entry.id,
    entry.albumId
  ].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  const trackAlbum = String(track.album || "").trim().toLowerCase();
  if (!trackAlbum) return false;
  return albumNames.some((name) => name === trackAlbum || name.includes(trackAlbum) || trackAlbum.includes(name));
}

function currentPlayingBrowseIndex() {
  if (!state.currentSong) return -1;
  return state.entries.findIndex((entry) => entryMatchesCurrentSong(entry, state.currentSong));
}

function syncBrowseToPlayingSong({ immediate = false } = {}) {
  if (!state.currentSong || !state.entries.length) return false;
  const targetIndex = currentPlayingBrowseIndex();
  if (targetIndex < 0 || targetIndex === state.browseIndex) return false;
  clearSnapBackTimer();
  navigateBrowseTo(targetIndex, { immediate, suppressSnapBack: true });
  return true;
}

function animateBrowseBackToCurrentSong() {
  syncBrowseToPlayingSong();
}

function scheduleSnapBackToPlaying({ restart = true } = {}) {
  if (
    isExternalInputActive() ||
    isUserInspectingLibraryItem() ||
    state.mode === BROWSE_MODE.SEARCH ||
    !state.currentSong ||
    !state.playing ||
    entryMatchesCurrentSong()
  ) {
    if (restart) clearSnapBackTimer();
    return;
  }
  if (!restart && snapBackTimerId) return;
  clearSnapBackTimer();
  snapBackTimerId = window.setTimeout(() => {
    snapBackTimerId = 0;
    if (!state.currentSong || !state.playing || isUserInspectingLibraryItem()) return;
    if (entryMatchesCurrentSong()) return;
    animateBrowseBackToCurrentSong();
  }, 5000);
}

async function toggleDrawerAlbumFavourite(event) {
  event?.preventDefault();
  event?.stopPropagation();
  const entry = getCurrentEntry();
  if (!entry) return;
  if (entry.kind === "radio") {
    await toggleRadioFavourite(entry);
    return;
  }
  await toggleAlbumFavourite(entry);
}

async function refreshPlayer() {
  try {
    const data = await apiGet("/api/player/state").catch(() => apiGet("/api/status"));

    // Browser output uses local <audio> — never adopt Pi/MPD radio state for this client.
    if (isBrowserPlayback()) {
      if (data.uiContext) {
        await applyRemoteUiContext(data.uiContext);
      }
      if (el.audioPlayer?.src) {
        syncBrowserPlayerState();
      }
      await finalizeBrowseSyncAfterPlayer();
      updateBrowseSummary();
      return;
    }

    if (data.uiContext) {
      await applyRemoteUiContext(data.uiContext);
    }
    const inputSource = data.inputSource || "local";
    const wasExternal = state.externalSourceActive;
    const isWirelessInput = inputSource === "airplay" || inputSource === "bluetooth";
    const isRadio = inputSource === "radio";

    if (isRadio && remoteSessionOverridesLocalMpd()) {
      await finalizeBrowseSyncAfterPlayer();
      updateBrowseSummary();
      updatePlaybackUi();
      return;
    }

    if (isRadio) {
      if (isBrowserPlayback() && (state.playing || el.audioPlayer.src)) {
        stopBrowserPlayback();
      }
      const status = data.status || data || {};
      const song = data.song || {};
      const radio = data.radio || {};
      const previousSongKey = radioPlaybackKey(state.currentSong);
      state.inputSource = "radio";
      state.externalSourceActive = false;
      const lockTransportUi = Date.now() < state.localTransportLockUntil;
      if (!lockTransportUi) {
        state.playing = status.state === "play";
      }
      state.volume = Number(status.volume ?? state.volume ?? 0);
      state.elapsed = Number(status.elapsed || 0);
      state.duration = Number(status.duration || song.Time || song.duration || 0);
      state.timelineUpdatedAt = Date.now();
      state.currentSong = normalizeTrack({
        kind: "radio",
        id: radio.id || song.file || `${radio.name || song.Title || "radio"}`,
        file: song.file || radio.url || radio.streamUrl || "",
        title: radio.name || song.Title || song.title || "Internet Radio",
        artist: radio.genre || radio.tags || song.Artist || song.artist || "Internet radio",
        album: "Internet radio",
        streamUrl: radio.url || radio.streamUrl || song.file || "",
        artUrl: radio.artUrl || radio.favicon || "",
        externalUuid: radio.externalUuid || ""
      });
      const currentSongKey = radioPlaybackKey(state.currentSong);
      if (!state.playing) {
        clearSnapBackTimer();
      } else if (currentSongKey !== previousSongKey) {
        await followLocalPlaybackBrowse(previousSongKey, currentSongKey);
        if (!entryMatchesCurrentSong()) scheduleSnapBackToPlaying({ restart: true });
      }
      await finalizeBrowseSyncAfterPlayer();
      updateBrowseSummary();
      updatePlaybackUi();
      return;
    }

    if (isWirelessInput) {
      if (isBrowserPlayback() && (state.playing || el.audioPlayer.src)) {
        stopBrowserPlayback();
      }

      const sourceChanged = state.inputSource !== inputSource;
      const status = data.status || data || {};
      const song = data.song || {};
      state.inputSource = inputSource;
      state.externalSourceActive = true;
      const lockTransportUi = Date.now() < state.externalTransportLockUntil;
      if (!lockTransportUi) {
        state.playing = status.state === "play";
      }
      state.volume = Number(status.volume ?? state.volume ?? 0);
      state.duration = Number(status.duration || song.Time || song.duration || 0);
      state.elapsed = Number(status.elapsed || 0);
      state.timelineUpdatedAt = Date.now();
      state.currentSong = normalizeTrack({
        id: song.id || song.file || `${inputSource}:${song.Title || song.title || ""}`,
        file: song.file || "",
        title: song.Title || song.title || externalInputLabel(),
        artist: song.Artist || song.artist || "",
        album: song.Album || song.album || externalInputLabel(),
        duration: song.Time || song.duration || 0
      });
      clearSnapBackTimer();
      if (!wasExternal || sourceChanged || state.externalCoverAppliedIndex !== state.browseIndex) {
        await syncExternalSourceCover();
      }
      updateBrowseSummary();
      updatePlaybackUi();
      return;
    }

    if (wasExternal) {
      state.inputSource = "local";
      state.externalSourceActive = false;
      restoreExternalSourceCover();
    }

    const wasPlaying = state.playing;
    const previousSongKey = state.currentSong?.file || state.currentSong?.id || "";
    const status = data.status || data || {};
    const song = data.song || {};
    const lockTransportUi = Date.now() < state.localTransportLockUntil;
    if (!lockTransportUi) {
      state.playing = status.state === "play";
    }
    state.volume = Number(status.volume ?? state.volume ?? 0);
    state.duration = Number(status.duration || song.Time || song.duration || 0);
    state.elapsed = Number(status.elapsed || 0);
    state.playlistLength = Number(status.playlistlength || status.playlistLength || 0);
    state.timelineUpdatedAt = Date.now();
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
    const currentSongKey = state.currentSong?.file || state.currentSong?.id || "";
    if (!state.playing) {
      clearSnapBackTimer();
    } else if (!wasPlaying || currentSongKey !== previousSongKey) {
      await followLocalPlaybackBrowse(previousSongKey, currentSongKey);
      if (!entryMatchesCurrentSong()) scheduleSnapBackToPlaying({ restart: true });
    }
    await finalizeBrowseSyncAfterPlayer();
    updateBrowseSummary();
    updatePlaybackUi();
  } catch (_error) {
    updatePlaybackUi();
  }
}

function getDisplayedTimeline() {
  if (!state.playing) return { elapsed: state.elapsed, duration: state.duration };
  const drift = state.seekDragging ? 0 : Math.max(0, (Date.now() - state.timelineUpdatedAt) / 1000);
  const elapsed = Math.min(state.duration || Infinity, state.elapsed + drift);
  return { elapsed, duration: state.duration };
}

function updatePlaybackUi({ renderRows = true } = {}) {
  const { elapsed, duration } = getDisplayedTimeline();
  const progress = duration > 0 ? clamp((elapsed / duration) * 100, 0, 100) : 0;
  el.seekTime.textContent = `${formatClock(elapsed)} / ${duration > 0 ? formatClock(duration) : "--:--"}`;
  el.seekFill.style.width = `${progress}%`;
  el.seekHandle.style.left = `${progress}%`;
  el.seekTrack.setAttribute("aria-valuenow", String(Math.round(progress)));
  el.iconPlay.classList.toggle("hidden", state.playing);
  el.iconPause.classList.toggle("hidden", !state.playing);
  el.iconFsPlay?.classList.toggle("hidden", state.playing);
  el.iconFsPause?.classList.toggle("hidden", !state.playing);
  const playLabel = state.playing ? "Pause" : "Play";
  el.btnPlay.setAttribute("aria-label", playLabel);
  el.btnFsPlay?.setAttribute("aria-label", playLabel);
  const volume = clamp(Math.round(state.volume || 0), 0, 100);
  el.volumeSlider.value = String(volume);
  el.volumeSlider.style.setProperty("--volume-progress", `${volume}%`);
  el.volumeIconPath.setAttribute("d", getVolumeIconPath(volume));
  if (renderRows) renderSongsDrawer();
}

function seekFromClientX(clientX) {
  const rect = el.seekTrack.getBoundingClientRect();
  if (!rect.width || !state.duration) return 0;
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  state.elapsed = Math.floor(state.duration * ratio);
  state.timelineUpdatedAt = Date.now();
  updatePlaybackUi();
  return state.elapsed;
}

async function commitSeek(seconds) {
  if (isBrowserPlayback()) {
    el.audioPlayer.currentTime = clamp(Number(seconds) || 0, 0, state.duration || 0);
    state.timelineUpdatedAt = Date.now();
    syncBrowserPlayerState(false);
    return;
  }
  if (isExternalInputActive() && state.inputSource !== "airplay") {
    return;
  }
  await apiPost("/api/player/seek", { seconds }).catch(() => apiPost("/api/seek", { seconds }));
  state.elapsed = Number(seconds) || 0;
  state.timelineUpdatedAt = Date.now();
  await refreshPlayer();
}

async function setVolume(volume) {
  state.volume = clamp(Number(volume), 0, 100);
  if (isBrowserPlayback()) {
    el.audioPlayer.volume = state.volume / 100;
    updatePlaybackUi({ renderRows: false });
    return;
  }
  updatePlaybackUi();
  await apiPost("/api/player/volume", { volume: state.volume }).catch(() => apiPost("/api/volume", { volume: state.volume }));
}

function shouldDeferSettingsRerender() {
  if (state.activeDropdown !== "settings-dropdown" || !state.touchKeyboard.open) return false;
  return ["wifi-ssid-input", "wifi-password-input", "wifi-country-input"].includes(state.touchKeyboard.targetId);
}

function getBrowseDropdownId(menu) {
  return {
    album: "album-dropdown",
    songs: "songs-dropdown",
    artist: "artist-dropdown",
    playlist: "playlist-dropdown",
    more: "more-dropdown",
    settings: "settings-dropdown"
  }[menu] || "";
}

function isActiveDropdownAnchor(target) {
  if (!state.activeDropdown || !target) return false;
  const anchor = getDropdownAnchor(state.activeDropdown);
  return Boolean(anchor && (anchor === target || anchor.contains(target)));
}

function isBrowseMenuSurface(target) {
  return Boolean(target?.closest?.(".browse-dropdown, .browse-btn, #browse-bar-shell, .browse-menu-wrap"));
}

function isBrowseMenuAnchor(target) {
  return browseButtons.some((button) => button && (button === target || button.contains(target)));
}

function shouldSuppressBrowseMenuOpen(dropdownId) {
  const guard = state.browseMenuSuppressOpen;
  return guard.dropdownId === dropdownId && Date.now() < guard.until;
}

function suppressBrowseMenuOpen(dropdownId, ms = 520) {
  state.browseMenuSuppressOpen = { dropdownId, until: Date.now() + ms };
}

function renderBrowseMenus() {
  for (const button of browseButtons) {
    const menu = button.dataset.browseMenu;
    const dropdownId = getBrowseDropdownId(menu);
    const moreActive = [BROWSE_MODE.YEAR, BROWSE_MODE.GENRE, BROWSE_MODE.RATING, BROWSE_MODE.STARRED, BROWSE_MODE.RADIO].includes(state.mode) && menu === "more";
    const artistActive = [BROWSE_MODE.ARTIST, BROWSE_MODE.COMPOSER].includes(state.mode) && menu === "artist";
    const playlistActive = [BROWSE_MODE.SMART_PLAYLIST, BROWSE_MODE.PLAYLIST].includes(state.mode) && menu === "playlist";
    button.classList.toggle("is-active", menu === state.mode || moreActive || artistActive || playlistActive || (state.mode === BROWSE_MODE.SEARCH && button === el.browseAlbum));
    button.classList.toggle("is-menu-open", dropdownId === state.activeDropdown);
    button.setAttribute("aria-expanded", String(dropdownId === state.activeDropdown));
  }
  renderAlbumDropdown();
  renderSongsDropdown();
  renderArtistDropdown();
  renderPlaylistDropdown();
  renderMoreDropdown();
  if (!shouldDeferSettingsRerender()) {
    renderSettingsDropdown();
  }
  for (const dropdown of [el.albumDropdown, el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown, el.settingsDropdown]) {
    dropdown.classList.toggle("is-open", dropdown.id === state.activeDropdown);
    dropdown.setAttribute("aria-hidden", String(dropdown.id !== state.activeDropdown));
  }
  positionActiveDropdown();
}

function renderDropdownCheck(checked) {
  if (!checked) {
    return `<span class="browse-dropdown-check" aria-hidden="true"></span>`;
  }
  return `<span class="browse-dropdown-check is-checked" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14"><path fill="currentColor" d="M6.2 11.6 2.8 8.2l1.2-1.2 2.2 2.2 5.8-5.8 1.2 1.2z"/></svg></span>`;
}

function renderTrackDisplayModeOptions(mode, action) {
  return `
    <button class="browse-dropdown-item browse-dropdown-display-mode" data-action="${action}" data-value="album">
      <span class="browse-dropdown-label-row">
        <span class="browse-dropdown-label">Group by album</span>
        ${renderDropdownCheck(mode === "album")}
      </span>
      <span class="browse-dropdown-meta">One cover per album</span>
    </button>
    <button class="browse-dropdown-item browse-dropdown-display-mode" data-action="${action}" data-value="song">
      <span class="browse-dropdown-label-row">
        <span class="browse-dropdown-label">Show songs</span>
        ${renderDropdownCheck(mode === "song")}
      </span>
      <span class="browse-dropdown-meta">One cover per song</span>
    </button>
  `;
}

function renderSortOptions(sort, action) {
  const activeSort = sort || "title";
  return `
    <button class="browse-dropdown-item browse-dropdown-display-mode ${activeSort === "year-asc" ? "is-selected" : ""}" data-action="${action}" data-value="year-asc">
      <span class="browse-dropdown-label-row">
        <span class="browse-dropdown-label">Year: Low to High</span>
        ${renderDropdownCheck(activeSort === "year-asc")}
      </span>
      <span class="browse-dropdown-meta">Oldest first</span>
    </button>
    <button class="browse-dropdown-item browse-dropdown-display-mode ${activeSort === "year-desc" ? "is-selected" : ""}" data-action="${action}" data-value="year-desc">
      <span class="browse-dropdown-label-row">
        <span class="browse-dropdown-label">Year: High to Low</span>
        ${renderDropdownCheck(activeSort === "year-desc")}
      </span>
      <span class="browse-dropdown-meta">Newest first</span>
    </button>
    <button class="browse-dropdown-item browse-dropdown-display-mode ${activeSort === "title" ? "is-selected" : ""}" data-action="${action}" data-value="title">
      <span class="browse-dropdown-label-row">
        <span class="browse-dropdown-label">Title (A-Z)</span>
        ${renderDropdownCheck(activeSort === "title")}
      </span>
      <span class="browse-dropdown-meta">Sort by name</span>
    </button>
  `;
}

function renderAlbumDropdown() {
  const allSelected = state.mode === BROWSE_MODE.ALBUM && state.albumBrowseScope === "all";
  const favouriteSelected = state.mode === BROWSE_MODE.ALBUM && state.albumBrowseScope === "favourite";
  el.albumDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${allSelected ? "is-selected" : ""}" data-action="album-all" data-value="">
        <span class="browse-dropdown-label-row">
          <span class="browse-dropdown-label">All Albums</span>
        </span>
        <span class="browse-dropdown-meta">Browse your full library</span>
      </button>
      <button class="browse-dropdown-item ${favouriteSelected ? "is-selected" : ""}" data-action="album-favourite" data-value="">
        <span class="browse-dropdown-label-row">
          <span class="browse-dropdown-label">Favourite</span>
        </span>
        <span class="browse-dropdown-meta">Browse favourite albums only</span>
      </button>
    </div>
    <div class="browse-dropdown-section">
      ${renderSortOptions(state.albumBrowseSort, "album-sort")}
    </div>
  `;
}

function renderSongsDropdown() {
  const allSelected = state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "all";
  const favouriteSelected = state.mode === BROWSE_MODE.SONGS && state.songsBrowseScope === "favourite";
  el.songsDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      ${renderTrackDisplayModeOptions(state.songsDisplayMode, "songs-display")}
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${allSelected ? "is-selected" : ""}" data-action="songs-all" data-value="">
        <span class="browse-dropdown-label-row">
          <span class="browse-dropdown-label">All Songs</span>
        </span>
        <span class="browse-dropdown-meta">Browse every track</span>
      </button>
      <button class="browse-dropdown-item ${favouriteSelected ? "is-selected" : ""}" data-action="songs-favourite" data-value="">
        <span class="browse-dropdown-label-row">
          <span class="browse-dropdown-label">Favourite</span>
        </span>
        <span class="browse-dropdown-meta">Browse favourite songs only</span>
      </button>
    </div>
    <div class="browse-dropdown-section">
      ${renderSortOptions(state.songsBrowseSort, "songs-sort")}
    </div>
  `;
}

function renderPlaylistDropdown() {
  const playlistItems = state.playlists.map((playlist) => `
    <button class="browse-dropdown-item ${state.activePlaylistId === playlist.id ? "is-selected" : ""}" data-action="playlist" data-value="${escapeHtml(playlist.id)}">
      <span class="browse-dropdown-label">${escapeHtml(playlist.name || "Playlist")}</span>
      <span class="browse-dropdown-meta">${(playlist.trackIds || []).length} ${(playlist.trackIds || []).length === 1 ? "song" : "songs"}</span>
    </button>
  `).join("");
  const smartItems = state.smartPlaylists.map((playlist) => `
    <button class="browse-dropdown-item ${state.activeSmartPlaylistId === playlist.id ? "is-selected" : ""}" data-action="smart-playlist" data-value="${escapeHtml(playlist.id)}">
      <span class="browse-dropdown-label">${escapeHtml(playlist.name || "Smart Playlist")}</span>
      <span class="browse-dropdown-meta">${playlist.rules?.length || 0} ${playlist.rules?.length === 1 ? "rule" : "rules"}</span>
    </button>
  `).join("");
  el.playlistDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      ${renderTrackDisplayModeOptions(state.playlistDisplayMode, "playlist-display")}
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item" data-action="create-playlist">
        <span class="browse-dropdown-label">Create Playlist...</span>
        <span class="browse-dropdown-meta">Save songs to a new playlist</span>
      </button>
      ${playlistItems || `
        <button class="browse-dropdown-item" disabled>
          <span class="browse-dropdown-label">No saved playlists</span>
          <span class="browse-dropdown-meta">Create one from a song menu</span>
        </button>
      `}
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item" data-action="create-smart-playlist">
        <span class="browse-dropdown-label">Create Smart Playlist...</span>
        <span class="browse-dropdown-meta">Set rules, limit, and live updating</span>
      </button>
      ${smartItems || `
        <button class="browse-dropdown-item" disabled>
          <span class="browse-dropdown-label">No saved smart playlists</span>
          <span class="browse-dropdown-meta">Create one from rules</span>
        </button>
      `}
    </div>
  `;
}

function renderArtistDropdown() {
  const selectedComposerTitle = state.selectedComposer || "Select composer";
  const artistItems = state.artists.map((artist) => `
    <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.ARTIST && state.selectedArtist === artist.name ? "is-selected" : ""}" data-action="artist" data-value="${escapeHtml(artist.name)}">
      <span class="browse-dropdown-label">${escapeHtml(artist.name)}</span>
      <span class="browse-dropdown-meta">${artist.album_count || artist.albumCount || 0} albums</span>
    </button>
  `).join("");
  const composerItems = state.composers.map((composer) => {
    const value = String(composer.name ?? composer.value ?? composer);
    const count = composer.album_count || composer.albumCount || 0;
    return `
      <button class="browse-dropdown-item ${state.mode === BROWSE_MODE.COMPOSER && state.selectedComposer === value ? "is-selected" : ""}" data-action="composer" data-value="${escapeHtml(value)}">
        <span class="browse-dropdown-label">${escapeHtml(value)}</span>
        <span class="browse-dropdown-meta">${count ? `${count} albums` : state.selectedComposer === value ? "Selected" : "\u00A0"}</span>
      </button>
    `;
  }).join("");

  el.artistDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      ${artistItems || `
        <button class="browse-dropdown-item" disabled>
          <span class="browse-dropdown-label">No artists</span>
        </button>
      `}
    </div>
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${state.activeArtistPanel === "composer" ? "is-selected" : ""}" data-action="artist-panel" data-value="composer">
        <span class="browse-dropdown-label">Composers</span>
        <span class="browse-dropdown-meta">${escapeHtml(selectedComposerTitle)}</span>
      </button>
      ${state.activeArtistPanel === "composer" ? `<div class="browse-dropdown-sublist">${composerItems || `<button class="browse-dropdown-item" disabled><span class="browse-dropdown-label">No composers</span></button>`}</div>` : ""}
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

  const radioScopeSection = state.activeMorePanel === "radio" ? `
    <div class="browse-dropdown-section browse-dropdown-sublist">
      <button class="browse-dropdown-item" data-action="radio-scope" data-value="favourites">
        <span class="browse-dropdown-label-row">
          <span class="browse-dropdown-label">Favourite stations</span>
          ${renderDropdownCheck(state.radioScope === "favourites")}
        </span>
        <span class="browse-dropdown-meta">Your starred radio</span>
      </button>
      <button class="browse-dropdown-item" data-action="radio-scope" data-value="all">
        <span class="browse-dropdown-label-row">
          <span class="browse-dropdown-label">All saved stations</span>
          ${renderDropdownCheck(state.radioScope === "all")}
        </span>
        <span class="browse-dropdown-meta">Every station in your library</span>
      </button>
      <button class="browse-dropdown-item" data-action="radio-search">
        <span class="browse-dropdown-label">Search stations</span>
        <span class="browse-dropdown-meta">Find internet radio worldwide</span>
      </button>
    </div>
  ` : "";

  el.moreDropdown.innerHTML = `
    <div class="browse-dropdown-section">
      <button class="browse-dropdown-item ${state.activeMorePanel === "radio" ? "is-selected" : ""}" data-action="more-panel" data-value="radio">
        <span class="browse-dropdown-label">Radio</span>
        <span class="browse-dropdown-meta">${state.mode === BROWSE_MODE.RADIO ? (state.radioScope === "favourites" ? "Favourites" : "All saved") : "Listen to internet radio"}</span>
      </button>
      ${radioScopeSection}
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
  for (const dropdown of [el.albumDropdown, el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown, el.settingsDropdown]) {
    if (!dropdown || dropdown.parentElement === document.body) continue;
    dropdown.classList.add("browse-dropdown-floating");
    document.body.appendChild(dropdown);
  }
}

function portalSongDrawerContextMenu() {
  if (!el.songDrawerContextMenu) return;
  document.body.appendChild(el.songDrawerContextMenu);
}

function getDropdownAnchor(dropdownId = state.activeDropdown) {
  return {
    "album-dropdown": el.browseAlbum,
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

function snapshotAudioSettings() {
  return {
    audioOutput: state.settings.audioOutput,
    dacHat: state.settings.dacHat,
    alsaDevice: state.settings.alsaDevice,
    mixer: state.settings.mixer,
    deviceAudioOutput: state.deviceAudioOutput
  };
}

function syncAudioSettingsApplied() {
  state.audioSettingsApplied = snapshotAudioSettings();
}

function isAudioSettingsDirty() {
  const applied = state.audioSettingsApplied;
  if (!applied) return false;
  const draft = snapshotAudioSettings();
  return (
    applied.audioOutput !== draft.audioOutput ||
    applied.dacHat !== draft.dacHat ||
    applied.alsaDevice !== draft.alsaDevice ||
    applied.mixer !== draft.mixer ||
    applied.deviceAudioOutput !== draft.deviceAudioOutput
  );
}

function settingsPickerLabel(options, value, fallback = "Select...") {
  const match = options.find((option) => option.value === value);
  return match?.label || fallback;
}

function renderSettingsPicker({ id, name, label, pickerKey, value, options }) {
  const isOpen = state.settingsOpenPicker === pickerKey;
  const selectedLabel = settingsPickerLabel(options, value);
  return `
    <div class="settings-picker-field">
      <span class="settings-picker-label">${escapeHtml(label)}</span>
      <div class="settings-picker-control">
        <input type="hidden" id="${id}" name="${name}" value="${escapeHtml(value)}">
        <button
          class="settings-picker-trigger ${isOpen ? "is-open" : ""}"
          type="button"
          data-action="settings-picker-toggle"
          data-picker="${escapeHtml(pickerKey)}"
          aria-expanded="${String(isOpen)}"
          aria-haspopup="listbox"
        >
          <span>${escapeHtml(selectedLabel)}</span>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 6l4 4 4-4"/>
          </svg>
        </button>
        ${
          isOpen
            ? `<div class="settings-picker-menu" role="listbox" aria-label="${escapeHtml(label)}">
            ${options
              .map(
                (option) => `
              <button
                class="browse-dropdown-item settings-picker-item ${option.value === value ? "is-selected" : ""}"
                type="button"
                data-action="settings-picker-select"
                data-picker="${escapeHtml(pickerKey)}"
                data-value="${escapeHtml(option.value)}"
                role="option"
                aria-selected="${String(option.value === value)}"
              >
                <span class="browse-dropdown-label">${escapeHtml(option.label)}</span>
              </button>`
              )
              .join("")}
          </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderSettingsDropdown() {
  const fontPercent = Math.round(state.albumInfoFontScale * 100);
  const audioOptions = state.audioDevices.length
    ? state.audioDevices
    : [{ alsa: state.settings.alsaDevice || "default", label: "default - ALSA default output" }];
  const routeOptions = [
    [BROWSER_OUTPUT_ROUTE, "Browser / This Device"],
    ["hdmi", "HDMI"],
    ["headphones", "3.5 mm Headphones"],
    ["usb-dac", "USB DAC"],
    ["dac-hat", "DAC HAT (I2S)"]
  ];
  const showHatPicker = state.settings.audioOutput === "dac-hat" && state.settings.audioOutput !== BROWSER_OUTPUT_ROUTE;
  const hatOptions = (state.dacHats.length
    ? [{ id: "", label: "Select DAC HAT model..." }, ...state.dacHats]
    : [{ id: "", label: "Select DAC HAT model..." }]
  ).map((hat) => ({ value: hat.id, label: hat.label || hat.id || "Select DAC HAT model..." }));
  const routePickerOptions = routeOptions.map(([value, optionLabel]) => ({ value, label: optionLabel }));
  const audioPickerOptions = audioOptions.map((device) => ({
    value: device.alsa,
    label: device.label || device.alsa
  }));
  const mixerPickerOptions = [
    { value: "software", label: "Software volume" },
    { value: "none", label: "Bit-perfect/no mixer" },
    { value: "hardware", label: "Hardware mixer" }
  ];
  el.settingsDropdown.innerHTML = `
    <button class="settings-close-btn" type="button" data-action="settings-close" aria-label="Close settings">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path fill="currentColor" d="M18.3 5.71 12 12l6.3 6.29-1.41 1.41L10.59 13.4 4.29 19.7 2.88 18.29 9.17 12 2.88 5.71 4.29 4.29l6.3 6.3 6.29-6.3z"/>
      </svg>
    </button>
    <span class="pitunes-settings-version">${escapeHtml(formatPiTunesVersionLabel(state.system.info?.pitunes || {}))}</span>
    <form id="pitunes-settings-form" class="pitunes-settings-form" autocomplete="off">
      <div class="browse-dropdown-section pitunes-system-controls">
        <div class="settings-summary pitunes-system-header">
          <span class="browse-dropdown-label">System</span>
          <span class="browse-dropdown-meta pitunes-system-update-meta ${state.system.update.checking ? "is-running" : ""}" aria-live="polite">
            <span class="scan-spinner" aria-hidden="true"></span>
            <span>${escapeHtml(systemUpdateStatusText())}</span>
          </span>
        </div>
        <div class="pitunes-system-actions">
          <button class="settings-step-btn pitunes-system-btn" type="button" data-action="system-about">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>
            About
          </button>
          <button class="settings-step-btn pitunes-system-btn" type="button" data-action="system-check-update" ${state.system.update.checking || state.system.update.applying ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            Check Update
          </button>
          <button class="settings-step-btn pitunes-system-btn pitunes-system-btn--update" type="button" data-action="system-apply-update" ${state.system.update.available && !state.system.update.applying && !state.system.update.checking ? "" : "disabled"}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
            Update
          </button>
          <span class="pitunes-system-action-pair">
            <button class="settings-step-btn pitunes-system-btn" type="button" data-action="system-reboot">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
              Reboot
            </button>
            <button class="settings-step-btn pitunes-system-btn pitunes-system-btn--danger" type="button" data-action="system-shutdown">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>
              Shut Down
            </button>
          </span>
        </div>
      </div>
      ${renderWifiSettingsSection()}

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

      <div class="browse-dropdown-section pitunes-settings-grid">
        <label>
          <span class="settings-label-with-info">
            <span>Music source</span>
            <span class="settings-info-icon" tabindex="0" role="img" aria-label="Choose music from internal storage, a USB-connected drive, or a mounted network share." title="Choose music from internal storage, a USB-connected drive, or a mounted network share.">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>
            </span>
          </span>
          <div class="settings-path-row">
            <input id="setting-music-path" name="music_directory" type="hidden" value="${escapeHtml(state.settings.musicDirectory)}">
            <div id="setting-music-source-display" class="settings-path-display">${escapeHtml(storageSourceLabel(state.settings.storageSource))}</div>
            <button class="settings-icon-btn" type="button" data-action="browse-music-folder" aria-label="Choose music library location" title="Choose Internal Storage, Local HDD / SSD, or Network Storage">
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>
              </svg>
            </button>
          </div>
        </label>
        <div class="pitunes-settings-actions pitunes-folder-actions">
          <button class="settings-step-btn" type="button" data-action="rescan-library">Rescan</button>
          <button class="settings-step-btn" type="button" data-action="rebuild-artwork">Rebuild Art</button>
        </div>
        ${renderSourceScanStatus()}
      </div>

      <div class="browse-dropdown-section pitunes-settings-grid">
        ${renderSettingsPicker({
          id: "audio-output-route",
          name: "audio_output",
          label: "Output route",
          pickerKey: "audio-output-route",
          value: state.settings.audioOutput,
          options: routePickerOptions
        })}
        ${
          showHatPicker
            ? renderSettingsPicker({
                id: "dac-hat-model",
                name: "dac_hat",
                label: "DAC HAT model",
                pickerKey: "dac-hat-model",
                value: state.settings.dacHat,
                options: hatOptions
              })
            : ""
        }
        ${renderSettingsPicker({
          id: "audio-output-device",
          name: "alsa_device",
          label: "ALSA device",
          pickerKey: "audio-output-device",
          value: state.settings.alsaDevice,
          options: audioPickerOptions
        })}
        ${renderSettingsPicker({
          id: "audio-output-mixer",
          name: "mixer",
          label: "Mixer type",
          pickerKey: "audio-output-mixer",
          value: state.settings.mixer,
          options: mixerPickerOptions
        })}
        <label>
          <span>Visible covers</span>
          <input id="setting-visible" name="visible" type="number" min="0" max="240" step="2" value="${escapeHtml(state.settings.visible)}" title="0 = auto by screen width">
        </label>
        <div class="pitunes-settings-actions pitunes-audio-apply-row">
          <button class="settings-step-btn" type="button" data-action="apply-audio-output" ${isAudioSettingsDirty() ? "" : "disabled"}>Apply Output</button>
          <button class="settings-step-btn" type="button" data-action="refresh-audio">Refresh Audio</button>
        </div>
      </div>

      <div class="browse-dropdown-section">
        <div class="settings-summary">
          <span class="browse-dropdown-label">Services</span>
          <span class="browse-dropdown-meta">SSH / Bluetooth / AirPlay / Kiosk</span>
        </div>
        <div class="pitunes-service-grid">
          ${renderServiceControl("ssh", "SSH")}
          ${renderServiceControl("bluetooth", "Bluetooth")}
          ${renderServiceControl("airplay", "AirPlay")}
          ${renderServiceControl("kiosk", "Kiosk")}
        </div>
      </div>

      <div id="settings-status" class="pitunes-settings-status">${escapeHtml(state.settingsStatus)}</div>
    </form>
  `;
}

function isWifiStationConnected(station = state.wifi.status?.station || {}) {
  return Boolean(station.active && station.ip);
}

function wifiUiSnapshot() {
  const status = state.wifi.status || {};
  const station = status.station || {};
  return JSON.stringify({
    ethActive: Boolean(status.ethernet?.active),
    ethIp: status.ethernet?.ip || "",
    wifiActive: isWifiStationConnected(station),
    wifiSsid: station.ssid || "",
    wifiIp: station.ip || "",
    hotspotActive: Boolean(status.hotspot?.active),
    connectionStatus: status.connection?.status || "idle",
    configureOpen: Boolean(state.wifi.configureOpen),
    loading: Boolean(state.wifi.loading),
    message: state.wifi.message || ""
  });
}

function renderWifiSettingsSection() {
  const wifiConnectionStatus = state.wifi.status?.connection?.status || "idle";
  const wifiConnecting = wifiConnectionStatus === "queued" || wifiConnectionStatus === "connecting";
  const station = state.wifi.status?.station || {};
  const wifiConnected = isWifiStationConnected(station);
  const showWifiSetup = state.wifi.configureOpen || (!wifiConnected && !wifiConnecting) || wifiConnecting;
  return `
    <div class="browse-dropdown-section">
      <div class="settings-summary">
        <span class="browse-dropdown-label">Network</span>
        <span class="browse-dropdown-meta">${escapeHtml(wifiSummary())}</span>
      </div>
      <div class="pitunes-wifi-panel">
        <div class="pitunes-network-status-grid">
          ${renderNetworkStatusRow("Ethernet", state.wifi.status?.ethernet, "Disconnected")}
          ${renderNetworkStatusRow("WiFi", state.wifi.status?.station, state.wifi.status?.station?.configured ? "Saved / disconnected" : "Disconnected")}
          ${renderNetworkStatusRow("Hotspot", state.wifi.status?.hotspot, "Off")}
        </div>
        ${wifiConnected ? renderWifiConnectedCard(station, showWifiSetup) : ""}
        ${showWifiSetup ? renderWifiSetupForm(wifiConnecting, wifiConnected) : ""}
        <div class="pitunes-wifi-message">${escapeHtml(state.wifi.message)}</div>
      </div>
    </div>
  `;
}

function renderWifiConnectedCard(station, setupOpen) {
  return `
    <div class="wifi-connected-card">
      <div>
        <div class="wifi-connected-title">Connected to ${escapeHtml(station.ssid || "WiFi")}</div>
        <div class="wifi-connected-meta">${escapeHtml([station.interface, station.ip].filter(Boolean).join(" / "))}</div>
      </div>
      <button class="settings-step-btn" type="button" data-action="${setupOpen ? "wifi-cancel-change" : "wifi-change"}">
        ${setupOpen ? "Cancel" : "Change"}
      </button>
    </div>
  `;
}

function renderWifiSetupForm(wifiConnecting, wifiConnected) {
  return `
    <div class="wifi-setup-form">
      <div class="pitunes-network-setup-label">${wifiConnected ? "Change WiFi" : "WiFi setup"}</div>
      <div class="pitunes-settings-actions">
        <button class="settings-step-btn" type="button" data-action="wifi-scan" ${state.wifi.loading ? "disabled" : ""}>${state.wifi.loading ? "Scanning" : "Scan"}</button>
        <button class="settings-step-btn" type="button" data-action="hotspot-start">Hotspot</button>
      </div>
      ${renderWifiNetworkList()}
      <label>
        <span>SSID</span>
        <div class="settings-input-row">
          <input id="wifi-ssid-input" value="${escapeHtml(state.wifi.selectedSsid)}" spellcheck="false" autocomplete="off" placeholder="Your WiFi network">
          <button class="settings-icon-btn keyboard-open-btn" type="button" data-keyboard-target="wifi-ssid-input" aria-label="Open SSID keyboard" title="Touch keyboard">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M18 9h.01M7 13h10"/></svg>
          </button>
        </div>
      </label>
      <label>
        <span>Password</span>
        <div class="settings-input-row settings-password-row">
          <input id="wifi-password-input" name="wifi-pass" value="${escapeHtml(state.wifi.password)}" type="${state.wifi.showPassword ? "text" : "password"}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="${state.wifi.credentialsSaved ? "Password saved on device" : "WiFi password"}">
          <button class="settings-step-btn settings-password-toggle" type="button" data-action="wifi-password-toggle" aria-pressed="${String(state.wifi.showPassword)}">${state.wifi.showPassword ? "Hide" : "Show"}</button>
          <button class="settings-icon-btn keyboard-open-btn" type="button" data-keyboard-target="wifi-password-input" aria-label="Open password keyboard" title="Touch keyboard">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M18 9h.01M7 13h10"/></svg>
          </button>
        </div>
      </label>
      <label>
        <span>Country</span>
        <div class="settings-input-row">
          <input id="wifi-country-input" value="${escapeHtml(state.wifi.country)}" maxlength="2" autocapitalize="characters" spellcheck="false">
          <button class="settings-icon-btn keyboard-open-btn" type="button" data-keyboard-target="wifi-country-input" aria-label="Open country keyboard" title="Touch keyboard">
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h.01M11 9h.01M15 9h.01M18 9h.01M7 13h10"/></svg>
          </button>
        </div>
      </label>
      <div class="pitunes-settings-actions">
        <button class="settings-step-btn" type="button" data-action="wifi-connect" ${wifiConnecting ? "disabled" : ""}>${wifiConnecting ? "Connecting" : "Connect"}</button>
      </div>
    </div>
  `;
}

function renderWifiNetworkList() {
  const networks = state.wifi.networks || [];
  if (!networks.length) {
    return `
      <div class="wifi-network-picker">
        <div class="wifi-network-picker-title">Available networks</div>
        <div class="wifi-network-empty">Press Scan or enter the SSID manually.</div>
      </div>
    `;
  }
  return `
    <div class="wifi-network-picker">
      <div class="wifi-network-picker-title">Available networks</div>
      <div class="wifi-network-list" role="listbox" aria-label="Available WiFi networks">
        ${networks.map((network) => {
          const selected = network.ssid === state.wifi.selectedSsid;
          const secure = network.security && network.security !== "open";
          return `
            <button class="wifi-network-option ${selected ? "is-selected" : ""}" type="button" data-action="wifi-network-select" data-ssid="${escapeHtml(network.ssid)}" role="option" aria-selected="${String(selected)}">
              <span>${escapeHtml(network.ssid || "Hidden network")}</span>
              <span>${escapeHtml([secure ? "secured" : "open", network.signal ? `${network.signal}%` : ""].filter(Boolean).join(" / "))}</span>
            </button>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderNetworkStatusRow(label, connection, inactiveLabel) {
  const active = Boolean(connection?.active);
  const connected = active || Boolean(connection?.connected);
  const details = [];
  if (connection?.ssid) details.push(connection.ssid);
  if (connection?.interface) details.push(connection.interface);
  if (connection?.ip) details.push(connection.ip);
  if (connected && !active) details.push("Acquiring IP");
  return `
    <div class="pitunes-network-status-row">
      <span class="pitunes-network-status-dot ${active ? "is-connected" : connected ? "is-link" : ""}" aria-hidden="true"></span>
      <span class="browse-dropdown-label">${escapeHtml(label)}</span>
      <span class="browse-dropdown-meta">${escapeHtml(connected ? details.join(" / ") || "Connected" : inactiveLabel)}</span>
    </div>
  `;
}

function renderServiceControl(key, label) {
  const service = normalizeServiceState(state.services[key]);
  return `
    <div class="pitunes-service-row">
      <div>
        <span class="browse-dropdown-label">${escapeHtml(label)}</span>
        <span class="browse-dropdown-meta">${escapeHtml(service.label)}</span>
      </div>
      <button class="service-toggle ${service.active ? "is-on" : ""}" type="button" data-action="service-toggle" data-service="${escapeHtml(key)}" aria-pressed="${String(service.active)}" aria-label="${escapeHtml(label)} ${service.active ? "on" : "off"}">
        <span class="service-toggle-thumb"></span>
      </button>
    </div>
  `;
}

function renderSourceScanStatus() {
  const scan = state.libraryScan || {};
  const message = scanMessage(scan);
  return `
    <div class="pitunes-source-scan-status ${scan.running ? "is-running" : ""}" aria-live="polite">
      <span class="scan-spinner" aria-hidden="true"></span>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

function scanMessage(scan = state.libraryScan) {
  if (scan.lastError) return `Scan failed: ${scan.lastError}`;
  if (scan.running) {
    const parts = [scan.message || "Scanning library"];
    if (Number(scan.progress || 0) > 0) parts.push(`${Number(scan.progress)} files`);
    if (Number(scan.albumCount || 0) > 0) parts.push(`${Number(scan.albumCount)} albums available`);
    return parts.join(" - ");
  }
  if (scan.message === "Scan complete") return `Scan complete${Number(scan.albumCount || 0) ? ` - ${Number(scan.albumCount)} albums` : ""}`;
  return state.settingsStatus || `Library: ${state.total || 0} albums`;
}

function wifiSummary() {
  const status = state.wifi.status || {};
  const ethernet = status.ethernet || {};
  const station = status.station || {};
  if (ethernet.active && station.active) return "Ethernet + WiFi connected";
  if (ethernet.active) return `Ethernet / ${ethernet.ip || ethernet.interface || "connected"}`;
  if (ethernet.connected) return "Ethernet / acquiring IP";
  if (station.active) return `WiFi / ${station.ssid || station.ip || "connected"}`;
  if (status.hotspot?.active) {
    return `Hotspot ${status.hotspot?.ssid || "PiTunes"} / ${status.hotspot?.ip || "172.24.1.1"}`;
  }
  return "Disconnected";
}

function renderFolderBrowser() {
  if (!el.folderBrowserModal) return;
  const currentPath = state.folderBrowser.currentPath || state.settings.musicDirectory || "/mnt/music";
  el.folderBrowserPath.value = currentPath;
  el.folderBrowserRoots.innerHTML = (state.folderBrowser.roots || []).map((root) => `
    <button class="folder-browser-root folder-browser-root-${escapeHtml(root.kind || "folder")} ${(root.selected || (root.kind === state.folderBrowser.selectedSource && (!root.device || root.device === state.folderBrowser.selectedDevice))) ? "is-selected" : ""}" type="button" data-folder-path="${escapeHtml(root.path || "")}" data-storage-kind="${escapeHtml(root.kind || "local")}" data-storage-action="${escapeHtml(root.action || "")}" data-storage-device="${escapeHtml(root.device || "")}" title="${escapeHtml(root.description || root.path || "")}" ${root.available === false ? "disabled" : ""}>
      <span class="folder-browser-root-icon" aria-hidden="true">${storageRootIcon(root.kind)}</span>
      <span class="folder-browser-root-copy">
        <span class="folder-browser-root-label">${escapeHtml(root.label || "Storage")}</span>
        <span class="folder-browser-root-description">${escapeHtml(root.description || root.path || "")}</span>
      </span>
    </button>
  `).join("");
  const parent = parentPath(currentPath);
  const rows = [];
  if (parent && parent !== currentPath) {
    rows.push(`
      <button class="folder-browser-row" type="button" data-folder-path="${escapeHtml(parent)}">
        <span class="folder-browser-icon">..</span>
        <span class="folder-browser-name">Parent Folder</span>
        <span class="folder-browser-path">${escapeHtml(parent)}</span>
      </button>
    `);
  }
  rows.push(...(state.folderBrowser.entries || []).map((entry) => `
    <button class="folder-browser-row" type="button" data-folder-path="${escapeHtml(entry.path)}">
      <span class="folder-browser-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/>
        </svg>
      </span>
      <span class="folder-browser-name">${escapeHtml(entry.name || entry.path)}</span>
      <span class="folder-browser-path">${escapeHtml(entry.path)}</span>
    </button>
  `));
  el.folderBrowserList.innerHTML = state.folderBrowser.mode === "network"
    ? renderNetworkStorageForm()
    : state.folderBrowser.loading
    ? `<div class="folder-browser-empty">Loading...</div>`
    : rows.join("") || `<div class="folder-browser-empty">No folders found.</div>`;
  el.folderBrowserStatus.textContent = state.folderBrowser.error || currentPath;
  el.folderBrowserPathForm.classList.toggle("hidden", state.folderBrowser.mode === "network");
  el.folderBrowserUse.classList.toggle("hidden", state.folderBrowser.mode === "network");
}

function renderNetworkStorageForm() {
  const network = state.folderBrowser.roots.find((root) => root.kind === "network")?.status || {};
  return `
    <form id="network-storage-form" class="network-storage-form" autocomplete="off">
      <label><span>Type</span><select name="protocol"><option value="smb" ${network.protocol === "nfs" ? "" : "selected"}>SMB / Windows share</option><option value="nfs" ${network.protocol === "nfs" ? "selected" : ""}>NFS</option></select></label>
      <label><span>NAS hostname or IP</span><input name="server" value="${escapeHtml(network.server || "")}" placeholder="192.168.1.20 or nas.local" required></label>
      <label><span>Shared folder</span><input name="share" value="${escapeHtml(network.share || "")}" placeholder="Music" required></label>
      <label><span>Username</span><input name="username" value="${escapeHtml(network.username || "")}" autocomplete="username" placeholder="Optional for NFS"></label>
      <label><span>Password</span><input name="nas-pass" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore data-form-type="other" placeholder="${network.configured ? "Leave blank to keep saved password" : "NAS password"}"></label>
      <button class="settings-step-btn folder-browser-use" type="submit">Connect and Scan</button>
    </form>
  `;
}

function storageRootIcon(kind) {
  if (kind === "network") {
    return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12a7 7 0 0 1 14 0"/><path d="M8.5 15.5a5 5 0 0 1 7 0"/><path d="M12 19h.01"/></svg>`;
  }
  if (kind === "external") {
    return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 17h.01M12 17h4"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 15h.01M11 15h6"/></svg>`;
}

function storageSourceLabel(source) {
  if (source === "network") return "Network Storage";
  if (source === "internal") return "Internal Storage";
  return "Local HDD / SSD";
}

function parentPath(path) {
  const normalized = String(path || "/").replace(/\/+$/, "") || "/";
  if (normalized === "/") return "";
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

async function openFolderBrowser() {
  state.folderBrowser.currentPath = getSettingsFormPath();
  state.folderBrowser.error = "";
  state.folderBrowser.mode = "browse";
  state.folderBrowser.selectedSource = state.settings.storageSource || "local";
  state.folderBrowser.selectedDevice = state.settings.localDevice || "";
  el.folderBrowserModal.classList.remove("hidden");
  el.folderBrowserModal.setAttribute("aria-hidden", "false");
  renderFolderBrowser();
  await loadFolderRoots();
  const selectedAvailable = state.folderBrowser.roots.some((root) => root.kind === state.folderBrowser.selectedSource && root.path === state.folderBrowser.currentPath);
  const firstAvailable = state.folderBrowser.roots.find((root) => root.kind === state.folderBrowser.selectedSource && root.path)
    || state.folderBrowser.roots.find((root) => root.kind === "local" && root.path);
  await browseFolder(selectedAvailable || !firstAvailable ? state.folderBrowser.currentPath : firstAvailable.path);
  el.folderBrowserPath.focus();
  el.folderBrowserPath.select();
}

function closeFolderBrowser() {
  el.folderBrowserModal.classList.add("hidden");
  el.folderBrowserModal.setAttribute("aria-hidden", "true");
}

async function loadFolderRoots() {
  const data = await apiGet("/api/filesystem/roots").catch(() => ({
    roots: [
      { path: state.settings.musicDirectory || "/mnt/music", kind: "current", label: "Current Music Folder", description: "The folder PiTunes scans now.", available: true },
      { path: "", kind: "external", label: "Local HDD / SSD", description: "No connected USB drive found.", available: false },
      { path: "", kind: "network", label: "Network Storage", description: "No mounted NAS or network share found.", available: false }
    ]
  }));
  state.folderBrowser.roots = data.roots || [];
  renderFolderBrowser();
}

async function browseFolder(path) {
  const nextPath = String(path || "/mnt/music").trim() || "/mnt/music";
  state.folderBrowser.currentPath = nextPath;
  state.folderBrowser.loading = true;
  state.folderBrowser.error = "";
  renderFolderBrowser();
  try {
    const data = await apiGet(`/api/filesystem/browse?path=${encodeURIComponent(nextPath)}`);
    state.folderBrowser.currentPath = data.path || nextPath;
    state.folderBrowser.entries = data.entries || [];
    state.folderBrowser.error = "";
  } catch (error) {
    state.folderBrowser.entries = [];
    state.folderBrowser.error = `${error.message || "Folder unavailable."} Choose an available storage location.`;
  } finally {
    state.folderBrowser.loading = false;
    renderFolderBrowser();
  }
}

function getSettingsFormPath() {
  const input = el.settingsDropdown.querySelector("#setting-music-path");
  return String(input?.value || state.settings.musicDirectory || "/mnt/music").trim() || "/mnt/music";
}

async function applySelectedMusicFolder(path) {
  const nextPath = String(path || state.folderBrowser.currentPath || "/mnt/music").trim();
  if (!nextPath) return;
  state.settings.musicDirectory = nextPath;
  state.settings.storageSource = state.folderBrowser.selectedSource || "local";
  state.settings.localDevice = state.folderBrowser.selectedDevice || "";
  const input = el.settingsDropdown.querySelector("#setting-music-path");
  if (input) input.value = nextPath;
  const sourceDisplay = el.settingsDropdown.querySelector("#setting-music-source-display");
  if (sourceDisplay) sourceDisplay.textContent = storageSourceLabel(state.settings.storageSource);
  const form = el.settingsDropdown.querySelector("#pitunes-settings-form");
  if (form) {
    await saveSettings(form, { message: "Music source saved. Library scan started.", render: false, skipAudioOutput: true });
  }
  state.libraryScan = {
    ...state.libraryScan,
    running: true,
    progress: 0,
    message: "Library scan started",
    lastError: ""
  };
  state.settingsStatus = "Music source saved. Library scan started.";
  const status = el.settingsDropdown.querySelector("#settings-status");
  if (status) status.textContent = state.settingsStatus;
  closeFolderBrowser();
  renderBrowseMenus();
  startLibraryScanPolling({ force: true });
}

function handleFolderBrowserClick(event) {
  const item = event.target.closest("[data-folder-path]");
  if (!item) return;
  event.preventDefault();
  event.stopPropagation();
  if (item.dataset.storageAction === "configure-network") {
    state.folderBrowser.mode = "network";
    state.folderBrowser.selectedSource = "network";
    state.folderBrowser.error = "";
    renderFolderBrowser();
    return;
  }
  if (item.dataset.storageKind) state.folderBrowser.selectedSource = item.dataset.storageKind;
  state.folderBrowser.selectedDevice = item.dataset.storageDevice || "";
  state.folderBrowser.mode = "browse";
  browseFolder(item.dataset.folderPath).catch(showError);
}

async function connectNetworkStorage(form) {
  const formData = new FormData(form);
  state.folderBrowser.error = "Connecting network storage...";
  renderFolderBrowser();
  try {
    const data = await apiPost("/api/storage/network/configure", {
      protocol: String(formData.get("protocol") || "smb"),
      server: String(formData.get("server") || ""),
      share: String(formData.get("share") || ""),
      username: String(formData.get("username") || ""),
      password: String(formData.get("nas-pass") || formData.get("password") || "")
    });
    state.settings.storageSource = "network";
    state.settings.musicDirectory = data.storage?.mountPoint || "/mnt/music";
    window.localStorage.setItem(MUSIC_FOLDER_STORAGE_KEY, state.settings.musicDirectory);
    state.libraryScan = {
      ...state.libraryScan,
      running: true,
      progress: 0,
      message: "Library scan started",
      lastError: ""
    };
    state.settingsStatus = data.message || "Network storage connected. Library scan started.";
    closeFolderBrowser();
    renderBrowseMenus();
    startLibraryScanPolling({ force: true });
  } catch (error) {
    state.folderBrowser.error = error.message || "Could not connect network storage.";
    renderFolderBrowser();
  }
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
    label: first.label || (installed
      ? `${active ? "active" : "inactive"} / ${enabled ? "enabled" : "disabled"}`
      : "not installed")
  };
}

function setOptimisticServiceState(service, active) {
  const first = Array.isArray(state.services[service]) ? state.services[service][0] : state.services[service] || {};
  state.services = {
    ...state.services,
    [service]: [{
      ...first,
      name: first.name || service,
      active: active ? "active" : "inactive",
      enabled: active ? "enabled" : "disabled"
    }]
  };
}

async function warmMenus() {
  if (!state.playlists.length) {
    loadPlaylists().then(() => renderBrowseMenus()).catch(() => {});
  }
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
  if (!state.composers.length) {
    apiGet("/api/library/composers").then((data) => {
      state.composers = data.composers || [];
      renderBrowseMenus();
    }).catch(() => {});
  }
}

function openDropdown(dropdownId) {
  state.activeDropdown = dropdownId;
  warmMenus();
  renderBrowseMenus();
  if (dropdownId === "settings-dropdown" && el.settingsDropdown) {
    el.settingsDropdown.scrollTop = 0;
    refreshSettingsData({ render: true }).catch(() => {});
  }
}

function closeBrowseMenu(dropdownId) {
  if (state.activeDropdown !== dropdownId) return false;
  suppressBrowseMenuOpen(dropdownId);
  closeDropdowns();
  return true;
}

async function handleBrowseMenuButtonClick(dropdownId, prepare) {
  if (shouldSuppressBrowseMenuOpen(dropdownId)) return;
  if (closeBrowseMenu(dropdownId)) return;
  if (typeof prepare === "function") {
    await prepare();
  }
  if (shouldSuppressBrowseMenuOpen(dropdownId)) return;
  if (state.activeDropdown === dropdownId) return;
  openDropdown(dropdownId);
}

function closeDropdowns() {
  state.settingsOpenPicker = "";
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
  if (state.activeRadioSearchMenuIndex != null) {
    state.activeRadioSearchMenuIndex = null;
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
    renderRadioSearchContextMenu();
    if (state.radioInternetSearch) {
      renderSearchPanel();
    }
  }
  closeVolumePopover();
}

function endRadioInternetSearch() {
  state.radioInternetSearch = false;
  el.searchPanel?.classList.remove("is-radio-search");
  state.activeRadioSearchMenuIndex = null;
  state.searchResults = [];
  state.radioSearchLoading = false;
  state.radioSearchLoadingMore = false;
  state.radioSearchHasMore = false;
  renderRadioSearchContextMenu();
  if (el.searchInput) {
    el.searchInput.placeholder = "Search albums and songs";
  }
}

function setSearchOpen(open) {
  if (!open && state.radioInternetSearch) {
    endRadioInternetSearch();
  }
  state.searchOpen = open;
  el.searchPanel.classList.toggle("hidden", !open);
  el.searchPanel.classList.toggle("is-radio-search", open && state.radioInternetSearch);
  el.searchPanel.setAttribute("aria-hidden", String(!open));
  el.btnSearch.classList.toggle("is-active", open);
  el.btnSearch.setAttribute("aria-expanded", String(open));
  syncSearchPanelLayout(getLayoutCoverBounds());
  if (open) {
    closeDropdowns();
    el.searchInput.focus();
    if (shouldAutoShowTouchKeyboard()) openTouchKeyboard(el.searchInput);
  } else if (state.touchKeyboard.targetId === "search-input") {
    closeTouchKeyboard();
  }
  renderSearchPanel();
}

const RADIO_SEARCH_MENU_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg>`;

function renderRadioSearchActionMenuContent(entry, index) {
  const favourited = Boolean(entry.favourite);
  const saved = isRadioStationSaved(entry);
  return `
    ${renderActionButton({
      action: "toggle-favourite",
      actionAttr: "data-radio-action",
      label: favourited ? "Remove favourite" : "Favourite",
      rowIndex: index
    })}
    ${renderActionButton({
      action: "save-radio",
      actionAttr: "data-radio-action",
      label: saved ? "Saved" : "Save",
      rowIndex: index,
      className: saved ? "is-muted" : ""
    })}
    ${renderActionButton({
      action: "more-info",
      actionAttr: "data-radio-action",
      label: "More info",
      rowIndex: index
    })}
    ${saved ? renderActionButton({
      action: "remove-from-saved",
      actionAttr: "data-radio-action",
      label: "Remove",
      rowIndex: index
    }) : ""}
  `;
}

function renderRadioSearchContextMenu() {
  const menu = el.radioSearchContextMenu;
  if (!menu) return;
  const index = state.activeRadioSearchMenuIndex;
  if (!state.searchOpen || !state.radioInternetSearch || !Number.isInteger(index) || index < 0 || index >= state.searchResults.length) {
    menu.classList.add("hidden");
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML = "";
    return;
  }
  const entry = state.searchResults[index];
  menu.innerHTML = renderRadioSearchActionMenuContent(entry, index);
  menu.classList.remove("hidden");
  menu.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(positionRadioSearchContextMenu);
}

function positionRadioSearchContextMenu() {
  const menu = el.radioSearchContextMenu;
  const index = state.activeRadioSearchMenuIndex;
  if (!menu || menu.classList.contains("hidden") || !Number.isInteger(index)) return;
  const button = el.searchResults?.querySelector(`button.search-radio-menu-btn[data-index="${index}"]`);
  if (!button) return;

  portalRadioSearchContextMenu();
  menu.style.position = "fixed";
  menu.style.zIndex = "500";
  menu.style.pointerEvents = "auto";
  menu.style.visibility = "hidden";
  menu.style.display = "block";
  const menuRect = menu.getBoundingClientRect();
  const rect = button.getBoundingClientRect();
  const gap = 6;
  const padding = 8;
  let left = rect.right - menuRect.width;
  let top = rect.top - menuRect.height - gap;
  if (top < padding) {
    top = rect.bottom + gap;
  }
  if (left < padding) {
    left = rect.left - menuRect.width - gap;
  }
  if (left < padding) {
    left = rect.right + gap;
  }
  left = clamp(left, padding, Math.max(padding, window.innerWidth - menuRect.width - padding));
  top = clamp(top, padding, Math.max(padding, window.innerHeight - menuRect.height - padding));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.right = "auto";
  menu.style.bottom = "auto";
  menu.style.visibility = "";
}

function closeRadioSearchContextMenu() {
  state.activeRadioSearchMenuIndex = null;
  const menu = el.radioSearchContextMenu;
  if (menu) {
    menu.classList.add("hidden");
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML = "";
  }
  if (state.radioInternetSearch && state.searchOpen) {
    renderSearchPanel();
  }
}

function portalRadioSearchContextMenu() {
  if (!el.radioSearchContextMenu) return;
  document.body.appendChild(el.radioSearchContextMenu);
}

function renderRadioSearchResults(entries, loading, errorMessage = "") {
  const loadingLabel = loading
    ? "Searching internet radio..."
    : (errorMessage || "No stations found.");
  return entries.map((entry, index) => {
    const streamInfo = formatRadioSearchStreamInfo(entry);
    const menuOpen = state.activeRadioSearchMenuIndex === index;
    const rowClass = streamInfo ? "search-result-radio" : "search-result-radio search-result-radio-no-detail";
    return `
    <div class="search-result search-result-item ${rowClass} ${menuOpen ? "is-menu-open" : ""}" data-index="${index}">
      <button class="search-result-play" type="button" data-action="play-radio-search" data-index="${index}">
        <span class="search-result-title">${escapeHtml(formatRadioSearchTitle(entry.title))}</span>
        <span class="search-result-meta">${escapeHtml(entry.subtitle || "Internet radio")}</span>
        ${renderRadioSearchStreamInfo(entry)}
      </button>
      ${renderRadioSearchLogo(entry)}
      <div class="search-result-actions ${menuOpen ? "is-menu-open" : ""}">
        <button class="song-menu-btn search-radio-menu-btn" type="button" data-action="toggle-radio-search-menu" data-index="${index}" aria-label="Station actions" aria-expanded="${menuOpen ? "true" : "false"}">
          ${RADIO_SEARCH_MENU_ICON}
        </button>
      </div>
    </div>
  `;
  }).join("") || `<div class="search-empty search-empty-hint">${loadingLabel}</div>`;
}

async function handleSearchResultsClick(event) {
  if (state.radioInternetSearch) {
    const actionButton = event.target.closest("button[data-action], button[data-radio-action]");
    if (!actionButton) return;
    event.preventDefault();
    event.stopPropagation();
    const index = Number(actionButton.dataset.index ?? 0);
    const entry = state.searchResults[index];
    if (!entry) return;
    const action = actionButton.dataset.action || actionButton.dataset.radioAction;
    if (action === "toggle-radio-search-menu") {
      state.activeRadioSearchMenuIndex = state.activeRadioSearchMenuIndex === index ? null : index;
      renderSearchPanel();
      window.requestAnimationFrame(positionRadioSearchContextMenu);
      return;
    }
    closeRadioSearchContextMenu();
    try {
      if (action === "play-radio-search") {
        setSearchOpen(false);
        await playRadio(entry);
      } else if (action === "toggle-favourite") {
        await toggleRadioFavourite(entry);
      } else if (action === "save-radio") {
        await saveRadioStationFromSearch(entry, false);
      } else if (action === "more-info") {
        await showRadioInfo(entry);
      } else if (action === "remove-from-saved") {
        await removeRadioStationFromLibrary(entry);
      }
    } catch (error) {
      showError(error);
    } finally {
      closeRadioSearchContextMenu();
    }
    return;
  }

  const row = event.target.closest(".search-result");
  if (!row) return;
  const index = Number(row.dataset.index || 0);
  navigateBrowseTo(index);
  setSearchOpen(false);
}

function renderSearchPanel() {
  const query = state.searchQuery.trim();
  el.btnSearchClear.classList.toggle("hidden", !query);

  if (state.radioInternetSearch) {
    el.searchPanel?.classList.add("is-radio-search");
    if (!query || query.length < 2) {
      el.searchResults.innerHTML = "";
      return;
    }
    el.searchResults.innerHTML = renderRadioSearchResults(
      state.searchResults,
      state.searchLoading || state.radioSearchLoading,
      state.radioSearchError
    );
    if (el.btnRadioSearchMore) {
      const showMore = Boolean(state.radioSearchHasMore && !state.radioSearchError);
      el.btnRadioSearchMore.classList.toggle("hidden", !showMore);
      el.btnRadioSearchMore.disabled = state.radioSearchLoadingMore;
      el.btnRadioSearchMore.textContent = state.radioSearchLoadingMore ? "Loading..." : "Load more stations";
    }
    renderRadioSearchContextMenu();
    if (state.searchOpen) {
      window.requestAnimationFrame(() => syncSearchPanelLayout(getLayoutCoverBounds()));
    }
    return;
  }

  if (el.btnRadioSearchMore) {
    el.btnRadioSearchMore.classList.add("hidden");
  }

  if (!query) {
    el.searchResults.innerHTML = "";
    return;
  }
  const loadingLabel = state.searchLoading ? "Searching..." : "No results.";
  el.searchResults.innerHTML = state.entries.slice(0, 80).map((entry, index) => {
    const typeLabel = entry.kind === "song" ? "Song" : entry.kind === "radio" ? "Radio" : "Album";
    return `
    <button class="search-result search-result-item" type="button" data-index="${index}">
      <span class="search-result-title">${escapeHtml(entry.title)}</span>
      <span class="search-result-meta">${escapeHtml(entry.subtitle || entry.artist || entry.album || entry.country || entry.kind)}</span>
      <span class="search-result-type">${typeLabel}</span>
    </button>
  `;
  }).join("") || `<div class="search-empty search-empty-hint">${loadingLabel}</div>`;
}

function isFinePointerDevice() {
  return window.matchMedia?.("(pointer: fine)")?.matches === true;
}

function shouldAutoShowTouchKeyboard() {
  if (document.body.classList.contains("is-touch-kiosk")) return true;
  if (new URLSearchParams(window.location.search).get("kiosk") === "1") return true;
  if (window.matchMedia?.("(pointer: coarse)")?.matches) return true;
  if (window.innerWidth <= 900 && !isFinePointerDevice()) return true;
  return false;
}

function requestTouchKeyboardForEditable(target) {
  if (!shouldAutoShowTouchKeyboard() || !isKeyboardEditable(target)) return;
  if (!target.id) target.id = `touch-input-${Date.now()}`;
  if (state.touchKeyboard.open && state.touchKeyboard.targetId === target.id) return;

  if (isFinePointerDevice()) {
    const targetId = target.id;
    window.clearTimeout(state.touchKeyboard.openDelayTimer);
    state.touchKeyboard.openDelayTimer = window.setTimeout(() => {
      state.touchKeyboard.openDelayTimer = 0;
      const nextTarget = document.getElementById(targetId);
      if (isKeyboardEditable(nextTarget)) openTouchKeyboard(nextTarget);
    }, 0);
    return;
  }
  openTouchKeyboard(target);
}

function handleEditableKeyboardFocus(event) {
  if (!isKeyboardEditable(event.target)) return;
  if (isFinePointerDevice() && event.type === "pointerdown") return;
  requestTouchKeyboardForEditable(event.target);
}

function isKeyboardEditable(target) {
  if (!target?.matches?.(TEXT_INPUT_SELECTOR)) return false;
  return !target.disabled && !target.readOnly;
}

function closestElement(target, selector) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  return element?.closest?.(selector) || null;
}

function ensureTouchKeyboardMounted() {
  // The keyboard must live inside #app so it stays visible in fullscreen:
  // class-based fullscreen raises #app to z-index 999, and native fullscreen
  // only renders #app's subtree in the top layer — a body-level keyboard is
  // painted behind it. Keeping it in #app does not change normal-mode stacking
  // (#app has no stacking context without a z-index).
  if (el.app && el.touchKeyboard && el.touchKeyboard.parentElement !== el.app) {
    el.app.appendChild(el.touchKeyboard);
  }
}

function openTouchKeyboard(targetOrId) {
  const target = typeof targetOrId === "string" ? document.getElementById(targetOrId) : targetOrId;
  if (!isKeyboardEditable(target)) return;
  if (!target.id) target.id = `touch-input-${Date.now()}`;
  ensureTouchKeyboardMounted();
  state.touchKeyboard.open = true;
  state.touchKeyboard.targetId = target.id;
  state.touchKeyboard.caretPosition = String(target.value || "").length;
  renderTouchKeyboard();
  syncModalKeyboardLayout();
  window.setTimeout(() => {
    target.focus({ preventScroll: true });
    setInputCaret(target, state.touchKeyboard.caretPosition);
  }, 0);
}

function closeTouchKeyboard() {
  window.clearTimeout(state.touchKeyboard.openDelayTimer);
  state.touchKeyboard.openDelayTimer = 0;
  if (!state.touchKeyboard.open) return;
  state.touchKeyboard.open = false;
  state.touchKeyboard.targetId = "";
  state.touchKeyboard.shift = false;
  state.touchKeyboard.symbols = false;
  state.touchKeyboard.caretPosition = 0;
  renderTouchKeyboard();
  syncModalKeyboardLayout();
}

function usesManualCaret(target) {
  return target?.type === "password" && state.touchKeyboard.open && state.touchKeyboard.targetId === target.id;
}

function getInputCaret(target) {
  const value = String(target?.value || "");
  if (usesManualCaret(target)) {
    const caret = Number(state.touchKeyboard.caretPosition);
    return Number.isFinite(caret) ? Math.max(0, Math.min(caret, value.length)) : value.length;
  }
  return Number.isFinite(target.selectionStart) ? target.selectionStart : value.length;
}

function getInputCaretEnd(target) {
  const value = String(target?.value || "");
  if (usesManualCaret(target)) {
    return getInputCaret(target);
  }
  return Number.isFinite(target.selectionEnd) ? target.selectionEnd : value.length;
}

function setInputCaret(target, position) {
  const next = Math.max(0, Math.min(position, String(target.value || "").length));
  if (usesManualCaret(target)) {
    state.touchKeyboard.caretPosition = next;
  }
  try {
    target.setSelectionRange(next, next);
  } catch (_) {
    // Password fields may reject selection updates in some browsers.
  }
}

function renderTouchKeyboard() {
  if (!el.touchKeyboard) return;
  el.touchKeyboard.classList.toggle("hidden", !state.touchKeyboard.open);
  el.touchKeyboard.setAttribute("aria-hidden", String(!state.touchKeyboard.open));
  if (!state.touchKeyboard.open) {
    el.touchKeyboard.innerHTML = "";
    return;
  }
  const rows = state.touchKeyboard.symbols ? TOUCH_KEYBOARD_ROWS.symbols : TOUCH_KEYBOARD_ROWS.letters;
  el.touchKeyboard.innerHTML = rows.map((row) => `
    <div class="touch-keyboard-row">
      ${row.map((key) => renderTouchKey(key)).join("")}
    </div>
  `).join("");
  syncModalKeyboardLayout();
}

function renderTouchKey(key) {
  const labels = {
    backspace: "Delete",
    shift: "Shift",
    symbols: "123",
    abc: "ABC",
    space: "Space",
    done: "Done"
  };
  const wide = ["backspace", "shift", "symbols", "abc", "space", "done"].includes(key);
  const primary = key === "done";
  return `
    <button class="touch-key ${wide ? "touch-key-wide" : ""} ${primary ? "touch-key-primary" : ""}" type="button" data-key="${escapeHtml(key)}">
      ${escapeHtml(labels[key] || displayTouchKey(key))}
    </button>
  `;
}

function displayTouchKey(key) {
  if (state.touchKeyboard.symbols || key.length !== 1) return key;
  return state.touchKeyboard.shift ? key.toUpperCase() : key;
}

function handleKeyboardOpenClick(event) {
  const button = closestElement(event.target, ".keyboard-open-btn[data-keyboard-target]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  openTouchKeyboard(button.dataset.keyboardTarget);
}

function handleTouchKeyboardClick(event) {
  const button = closestElement(event.target, ".touch-key[data-key]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function handleTouchKeyboardPointerDown(event) {
  const button = closestElement(event.target, ".touch-key[data-key]");
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  if (!button) return;
  applyTouchKey(button.dataset.key || "");
}

function applyTouchKey(key) {
  const target = document.getElementById(state.touchKeyboard.targetId);
  if (!isKeyboardEditable(target)) {
    closeTouchKeyboard();
    return;
  }

  if (key === "done") {
    closeTouchKeyboard();
    return;
  }
  if (key === "shift") {
    state.touchKeyboard.shift = !state.touchKeyboard.shift;
    renderTouchKeyboard();
    return;
  }
  if (key === "symbols" || key === "abc") {
    state.touchKeyboard.symbols = key === "symbols";
    state.touchKeyboard.shift = false;
    renderTouchKeyboard();
    return;
  }

  const insert = key === "space" ? " " : displayTouchKey(key);
  if (key === "backspace") {
    applyTextEdit(target, "");
  } else {
    applyTextEdit(target, insert);
    if (state.touchKeyboard.shift && !state.touchKeyboard.symbols) {
      state.touchKeyboard.shift = false;
      renderTouchKeyboard();
    }
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.focus({ preventScroll: true });
}

function applyTextEdit(target, text) {
  const value = String(target.value || "");
  const start = getInputCaret(target);
  const end = getInputCaretEnd(target);
  if (text === "") {
    if (start !== end) {
      target.value = value.slice(0, start) + value.slice(end);
      setInputCaret(target, start);
    } else if (start > 0) {
      target.value = value.slice(0, start - 1) + value.slice(end);
      setInputCaret(target, start - 1);
    }
    return;
  }
  target.value = value.slice(0, start) + text + value.slice(end);
  setInputCaret(target, start + text.length);
}

let searchTimer = 0;
function scheduleSearch() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, SEARCH_DELAY_MS);
}

async function runRadioSearch(query, { append = false } = {}) {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    state.searchResults = [];
    state.radioSearchHasMore = false;
    renderSearchPanel();
    return;
  }
  const offset = append ? state.searchResults.length : 0;
  if (append) {
    state.radioSearchLoadingMore = true;
  } else {
    state.radioSearchLoading = true;
    state.searchLoading = true;
    state.radioSearchError = "";
    state.radioSearchHasMore = false;
  }
  renderSearchPanel();
  try {
    const data = await apiGet(
      `/api/library/radio/search?q=${encodeURIComponent(trimmed)}&limit=${RADIO_SEARCH_PAGE_SIZE}&offset=${offset}`
    );
    const stations = (data.stations || []).map(normalizeRadioStation);
    if (append) {
      const seen = new Set(state.searchResults.map((entry) => entry.id));
      for (const station of stations) {
        if (seen.has(station.id)) continue;
        state.searchResults.push(station);
        seen.add(station.id);
      }
    } else {
      state.searchResults = stations;
    }
    state.radioSearchHasMore = Boolean(data.hasMore);
    if (!state.searchResults.length && !append) {
      state.radioSearchError = data.error || "No stations found. Try a different search.";
    } else if (state.searchResults.length) {
      state.radioSearchError = "";
    }
  } catch (error) {
    if (!append) {
      state.searchResults = [];
      state.radioSearchHasMore = false;
      state.radioSearchError = window.location.protocol === "file:"
        ? "Open http://127.0.0.1:8095 in your browser (run scripts\\start-mock.ps1 first)."
        : `Search failed: ${error.message || "network error"}. Run scripts\\start-mock.ps1 and open http://127.0.0.1:8095`;
    }
  } finally {
    state.radioSearchLoading = false;
    state.radioSearchLoadingMore = false;
    state.searchLoading = false;
    renderSearchPanel();
  }
}

async function loadMoreRadioSearch() {
  if (!state.radioInternetSearch || !state.radioSearchHasMore || state.radioSearchLoadingMore) return;
  await runRadioSearch(state.searchQuery, { append: true });
}

async function runSearch() {
  const query = state.searchQuery.trim();
  if (state.radioInternetSearch) {
    await runRadioSearch(query);
    return;
  }
  if (!query) {
    await loadAlbums({ resetIndex: true, filter: "", mode: BROWSE_MODE.ALBUM });
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

function getAlbumInfoFontScale() {
  const base = state.albumInfoFontScale;
  if (!isPlayerFullscreen()) return base;
  return base * 1.08;
}

function measureAlbumInfoLayout(coverWidthPx, fontScale, options = {}) {
  const { maxHeightPx = null, allowShrink = false } = options;
  const safeWidth = Math.max(120, coverWidthPx || 0);
  const safeHeight = Math.max(10, Math.floor(maxHeightPx || 0));
  const fullscreen = isPlayerFullscreen();
  let lineHeight = safeHeight && safeHeight < 18 ? 0.98 : safeHeight && safeHeight < 26 ? 1.04 : 1.15;
  const minTitleSize = fullscreen ? 14 : 12;
  const minArtistSize = fullscreen ? 10 : 10;
  const maxTitleSize = fullscreen ? 56 : 54;
  const maxArtistSize = fullscreen ? 35 : 34;
  let titleSize = clamp(
    Math.round(safeWidth * (fullscreen ? 0.118 : 0.115) * fontScale),
    minTitleSize,
    maxTitleSize
  );
  let artistSize = Math.min(
    clamp(Math.round(safeWidth * (fullscreen ? 0.072 : 0.07) * fontScale), minArtistSize, maxArtistSize),
    Math.round(titleSize * 0.74)
  );
  let gap = clamp(Math.round(titleSize * 0.08), 1, 6);
  const padTop = clamp(Math.round((safeHeight || titleSize) * 0.01), 0, 3);
  const padX = clamp(Math.round(safeWidth * 0.02), 4, 12);
  const contentHeight = () => Math.ceil(titleSize * lineHeight) + Math.ceil(artistSize * lineHeight) + gap + padTop;

  if (allowShrink && maxHeightPx) {
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
  }

  return { titleSize, artistSize, gap, padTop, padX, lineHeight, height: contentHeight() };
}

function applyInfoPanelLayout(layout) {
  el.infoPanel.style.setProperty("--info-title-size", `${layout.titleSize}px`);
  el.infoPanel.style.setProperty("--info-artist-size", `${layout.artistSize}px`);
  el.infoPanel.style.setProperty("--info-gap", `${layout.gap}px`);
  el.infoPanel.style.padding = `${layout.padTop}px ${layout.padX}px 0`;
  el.trackTitle.style.lineHeight = String(layout.lineHeight);
  el.trackArtist.style.lineHeight = String(layout.lineHeight);
}

function getAlbumInfoTypographyWidth(infoWidthPx) {
  return Math.max(120, Math.round(infoWidthPx || 0));
}

/* =============================================================
   ALBUM INFO FONT LAYOUT — DO NOT CHANGE CASUALLY
   Desktop browsers (mouse/trackpad) must keep full album info
   typography when the cover settles. Do not re-enable shrink or
   cover-lift on desktop without a visual check on pitunes.local.
   Touch/Pi layout is handled separately via isDesktopFinePointerBrowser().
   ============================================================= */
function fitInfoPanelTypography(coverWidthPx, availableHeightPx = null) {
  const fontScale = getAlbumInfoFontScale();
  let layout = measureAlbumInfoLayout(coverWidthPx, fontScale);
  const mayShrink = (
    availableHeightPx != null &&
    !isPlayerFullscreen() &&
    !isSlideAnimating() &&
    !isDesktopFinePointerBrowser()
  );
  if (mayShrink && layout.height > availableHeightPx) {
    layout = measureAlbumInfoLayout(coverWidthPx, fontScale, {
      maxHeightPx: availableHeightPx,
      allowShrink: true
    });
  }
  applyInfoPanelLayout(layout);
  return { height: layout.height };
}

function isNativeFullscreen() {
  const active = document.fullscreenElement || document.webkitFullscreenElement;
  return Boolean(el.app && active === el.app);
}

function isKioskLaunch() {
  return new URLSearchParams(window.location.search).get("kiosk") === "1";
}

function prefersNativeFullscreen() {
  if (document.body.classList.contains("is-touch-kiosk")) return false;
  if (isKioskLaunch()) return false;
  return true;
}

function enableKioskPlayerFullscreen() {
  if (!isKioskLaunch() || kioskFullscreenSuppressed || isPlayerFullscreen()) return;
  document.body.classList.add("is-player-fullscreen");
  syncFullscreenButton({ fromToggle: true });
}

function isPlayerFullscreen() {
  return document.body.classList.contains("is-player-fullscreen") || isNativeFullscreen();
}

function isDesktopFinePointerBrowser() {
  return Boolean(window.matchMedia?.("(hover: hover) and (pointer: fine)")?.matches);
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
  const shellWidth = `${Math.round(mix(280, 440))}px`;
  const btnSize = `${Math.round(mix(22, 32))}px`;
  const btnIconSize = `${Math.round(mix(12, 18))}px`;
  const playSize = `${Math.round(mix(26, 36))}px`;
  const playIconSize = `${Math.round(mix(16, 24))}px`;
  const clusterGap = `${Math.round(mix(1, 6))}px`;
  const browseLayoutVars = {
    "--controls-shell-width": shellWidth,
    "--browse-btn-min-height": `${Math.round(mixBrowse(18, 34))}px`,
    "--browse-btn-padding-y": `${Math.round(mixBrowse(0, 3))}px`,
    "--browse-btn-padding-x": `${Math.round(mixBrowse(1, 4))}px`,
    "--browse-btn-gap": `${Math.round(mixBrowse(0, 1))}px`,
    "--browse-bar-gap": `${Math.round(mixBrowse(1, 3))}px`,
    "--browse-btn-font-size": `${mixBrowse(5.8, 8.8).toFixed(1)}px`,
    "--browse-btn-icon-size": `${Math.round(mixBrowse(8, 16))}px`,
  };

  style.setProperty("--controls-shell-width", shellWidth);
  style.setProperty("--controls-gap", `${Math.round(mix(0, 2))}px`);
  style.setProperty("--controls-padding-top", `${Math.round(mix(0, 2))}px`);
  style.setProperty("--controls-padding-side", `${Math.round(mix(4, 12))}px`);
  style.setProperty("--controls-padding-bottom", "0px");
  style.setProperty("--transport-gap", `${Math.round(mix(1, 8))}px`);
  style.setProperty("--ctrl-btn-size", btnSize);
  style.setProperty("--ctrl-btn-icon-size", btnIconSize);
  style.setProperty("--ctrl-play-size", playSize);
  style.setProperty("--ctrl-play-icon-size", playIconSize);
  style.setProperty("--transport-cluster-height", `${Math.round(mix(30, 42))}px`);
  style.setProperty("--transport-cluster-gap", clusterGap);
  el.fullscreenTransport?.style.setProperty("--ctrl-btn-size", btnSize);
  el.fullscreenTransport?.style.setProperty("--ctrl-btn-icon-size", btnIconSize);
  el.fullscreenTransport?.style.setProperty("--ctrl-play-size", playSize);
  el.fullscreenTransport?.style.setProperty("--ctrl-play-icon-size", playIconSize);
  el.fullscreenTransport?.style.setProperty("--transport-cluster-gap", clusterGap);
  style.setProperty("--browse-strip-shell-height", `${Math.round(mix(16, 24))}px`);
  style.setProperty("--browse-strip-track-height", `${Math.round(mix(10, 16))}px`);
  style.setProperty("--browse-strip-thumb-height", `${Math.round(mix(10, 16))}px`);
  style.setProperty("--browse-strip-thumb-width", `${Math.round(mix(16, 30))}px`);
  style.setProperty("--browse-strip-cap-width", `${Math.round(mix(18, 26))}px`);
  for (const [name, value] of Object.entries(browseLayoutVars)) {
    style.setProperty(name, value);
  }
  if (el.browseBarShell) {
    for (const [name, value] of Object.entries(browseLayoutVars)) {
      el.browseBarShell.style.setProperty(name, value);
    }
  }
}

function applyDrawerSurfaceScale(width, nodes = []) {
  const safeWidth = Math.round(width || 0);
  if (!safeWidth) return;
  const scale = clamp(safeWidth / 420, 0.72, 1.18).toFixed(3);
  for (const node of nodes) {
    node?.style.setProperty("--drawer-ui-scale-js", scale);
  }
}

function syncSongsDrawerMetrics() {
  const targets = [el.songsDrawer, el.songInfoCard].filter(Boolean);
  if (!targets.length) return;
  const width = Math.round(
    el.songsDrawer?.clientWidth ||
    el.songInfoCard?.clientWidth ||
    el.songInfoModal?.clientWidth ||
    0
  );
  applyDrawerSurfaceScale(width, targets);
}

function getInfoPanelWidth(coverWidthPx) {
  const safeWidth = Math.max(0, Math.round(coverWidthPx || 0));
  const inset = clamp(Math.round(safeWidth * 0.04), 4, 12);
  return Math.max(120, safeWidth - inset * 2);
}

function getReflectionStackWidth(containerWidth) {
  const safeWidth = Math.max(0, Math.round(containerWidth || 0));
  return Math.min(Math.max(260, Math.round(safeWidth * 0.86)), 460);
}

function getInfoAnchorBottom(coverBounds) {
  return coverBounds?.bottom ?? 0;
}

function getControlsSurfaceTop() {
  const nodes = [el.transport, el.controlsMain, el.controls];
  if (!isPlayerFullscreen()) {
    nodes.unshift(el.browseBarShell, el.browseBar);
  }
  return nodes
    .map((node) => node?.getBoundingClientRect())
    .filter((rect) => rect && rect.height > 0 && rect.width > 0)
    .map((rect) => rect.top)
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0] || window.innerHeight;
}

function getReflectionStackBottomLocal(containerRect, coverBounds = null) {
  if (isPlayerFullscreen()) {
    const reflectionBottom = coverBounds?.stackBottom;
    if (Number.isFinite(reflectionBottom) && reflectionBottom > 0) {
      return Math.max(0, Math.floor(reflectionBottom));
    }
    // Corner transport is an overlay — do not squeeze reflection typography above it.
    return Math.max(0, containerRect.height - Math.max(12, Math.round(containerRect.height * 0.02)));
  }
  return getControlsSurfaceTop() - containerRect.top;
}

function requiredAlbumInfoHeight(controlWidthPx) {
  const scaleT = clamp(controlWidthPx / 360, 0.62, 1);
  const mix = (min, max) => Math.round(min + (max - min) * scaleT);
  const actionSize = mix(22, 34);
  const hasActions = el.infoPanel.classList.contains("has-actions");
  const actionReserve = hasActions ? actionSize + 4 : 0;
  const textWidth = Math.max(80, controlWidthPx - actionReserve);
  el.infoPanel.style.setProperty("--info-action-size", `${actionSize}px`);
  return measureAlbumInfoLayout(textWidth, getAlbumInfoFontScale()).height;
}

function liftCoverForInfoSpace(coverBounds, coverHeightPx, requiredInfoHeight, controlsTopLocal) {
  const infoPanelGap = clamp(Math.round(coverHeightPx * 0.006), 1, 3);
  const infoBottomMargin = clamp(Math.round(coverHeightPx * 0.012), 2, 6);
  const minInfoTop = Math.round(getInfoAnchorBottom(coverBounds) + infoPanelGap);
  const availableInfoHeight = Math.max(0, Math.floor(controlsTopLocal - minInfoTop - infoBottomMargin));
  const shortage = requiredInfoHeight - availableInfoHeight;
  const containerHeight = el.container?.clientHeight || 0;
  const topMarginPx = Math.max(2, Math.round(containerHeight * 0.01));
  const maxExtraLift = Math.max(0, Math.round(coverBounds.top - topMarginPx));
  if (shortage <= 0 || maxExtraLift <= 0.5) {
    return { coverBounds, lifted: false };
  }

  const liftPx = Math.min(shortage, maxExtraLift);
  const curOffset = getCenterCoverMetrics().offsetY;
  const y1 = worldToScreenY(curOffset);
  const y2 = worldToScreenY(curOffset + 10);
  if (y1 == null || y2 == null || Math.abs(y1 - y2) < 0.1) {
    return { coverBounds, lifted: false };
  }
  const worldShift = liftPx / (Math.abs(y1 - y2) / 10);
  if (!setCoverflowOffsetY(curOffset + worldShift)) {
    return { coverBounds, lifted: false };
  }
  return {
    coverBounds: getActiveCoverBounds() || coverBounds,
    lifted: true
  };
}

function applyReflectionControlGeometry(stackWidthPx, infoWidthPx, centerX) {
  const stackWidth = Math.max(200, Math.round(stackWidthPx));
  const infoWidth = Math.max(120, Math.round(infoWidthPx));
  const center = Math.round(centerX);
  const bottomPad = Math.max(4, Math.round(parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.2));

  el.browseBarShell.style.left = `${center}px`;
  el.browseBarShell.style.bottom = `${bottomPad}px`;
  el.browseBarShell.style.transform = "translateX(-50%)";
  el.browseBarShell.style.width = `${stackWidth}px`;
  el.browseBarShell.style.maxWidth = `${stackWidth}px`;

  const measuredBrowseHeight = Math.round(el.browseBarShell.getBoundingClientRect().height || 0);
  const browseHeight = Math.max(measuredBrowseHeight, getEstimatedBrowseBarHeight());
  el.controls.style.left = `${center}px`;
  el.controls.style.bottom = `${bottomPad + browseHeight}px`;
  el.controls.style.transform = "translateX(-50%)";
  el.controls.style.width = `${stackWidth}px`;
  el.controls.style.maxWidth = `${stackWidth}px`;

  el.infoPanel.style.left = `${center}px`;
  el.infoPanel.style.transform = "translateX(-50%)";
  el.infoPanel.style.width = `${infoWidth}px`;
  el.infoPanel.style.maxWidth = `${infoWidth}px`;
}

function positionReflectionStack(coverBounds) {
  if (!el.container || !el.infoPanel || !el.controls || !el.browseBarShell) return;

  const containerWidth = Math.max(0, el.container.clientWidth);
  const stackWidthPx = getReflectionStackWidth(containerWidth);
  const liveCover = Boolean(getActiveCoverBounds());
  const coverWidthPx = coverBounds ? Math.max(0, Math.round(coverBounds.width)) : getNominalCoverWidth();
  const coverHeightPx = coverBounds ? Math.max(0, Math.round(coverBounds.height)) : Math.round(getCenterCoverMetrics().height);
  const infoWidthPx = getInfoPanelWidth(coverWidthPx);
  const centerX = containerWidth / 2;

  applyReflectionControlGeometry(stackWidthPx, infoWidthPx, centerX);
  if (!coverBounds) return;

  const containerRect = el.container.getBoundingClientRect();
  let activeBounds = coverBounds;
  let stackBottomLocal = getReflectionStackBottomLocal(containerRect, activeBounds);

  const canLiftCover = liveCover && !isSlideAnimating() && !isPlayerFullscreen() && !isDesktopFinePointerBrowser();
  if (canLiftCover) {
    let requiredInfoHeight = requiredAlbumInfoHeight(infoWidthPx);
    for (let pass = 0; pass < 5; pass += 1) {
      const liftResult = liftCoverForInfoSpace(
        activeBounds,
        coverHeightPx,
        requiredInfoHeight,
        stackBottomLocal
      );
      if (!liftResult.lifted) break;
      activeBounds = liftResult.coverBounds;
      stackBottomLocal = getReflectionStackBottomLocal(containerRect, activeBounds);
      requiredInfoHeight = requiredAlbumInfoHeight(infoWidthPx);
    }
  }

  activeBounds = liveCover ? (getActiveCoverBounds() || activeBounds) : activeBounds;
  stackBottomLocal = getReflectionStackBottomLocal(containerRect, activeBounds);

  const scaleT = clamp(infoWidthPx / 360, 0.62, 1);
  const mix = (min, max) => Math.round(min + (max - min) * scaleT);
  const actionSize = mix(22, 34);
  const hasActions = el.infoPanel.classList.contains("has-actions");
  const actionReserve = hasActions ? actionSize + 4 : 0;
  const textWidth = Math.max(80, getAlbumInfoTypographyWidth(infoWidthPx - actionReserve));
  el.infoPanel.style.setProperty("--info-action-size", `${actionSize}px`);

  const infoPanelGap = clamp(Math.round(coverHeightPx * 0.006), 1, 3);
  const infoBottomMargin = clamp(Math.round(coverHeightPx * 0.012), 2, 6);
  const minInfoTop = Math.round(getInfoAnchorBottom(activeBounds) + infoPanelGap);
  const availableInfoHeight = isPlayerFullscreen()
    ? null
    : Math.max(12, Math.floor(stackBottomLocal - minInfoTop - infoBottomMargin));
  el.infoPanel.style.display = "";
  const infoLayout = fitInfoPanelTypography(textWidth, availableInfoHeight);

  const containerHeight = el.container?.clientHeight || 0;
  // Keep album info on-screen when the reflection stack extends below the stage.
  const maxVisibleInfoTop = Math.max(
    minInfoTop,
    Math.floor(containerHeight - infoLayout.height - infoBottomMargin)
  );
  const isTouchLayout = Boolean(window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches);
  let infoTop;
  if (isPlayerFullscreen()) {
    /* =============================================================
       FULLSCREEN ALBUM INFO PLACEMENT — DO NOT CHANGE CASUALLY
       =============================================================
       User-approved fullscreen position (v198): title/artist sit just
       below the cover art, nudged slightly into the reflection band.

       Do NOT anchor to stackBottomLocal directly — in fullscreen the
       reflection bottom often falls past the container edge and pushes
       the info panel off-screen (overflow hidden clips it invisible).

       Keep: reflectionSpan * 0.18 with clamp(4, 14), then cap with
       maxVisibleInfoTop. Only change after visual check on Pi + Mac.
       ============================================================= */
    const reflectionSpan = Math.max(0, stackBottomLocal - minInfoTop);
    const downShift = clamp(Math.round(reflectionSpan * 0.18), 4, 14);
    infoTop = Math.min(minInfoTop + downShift, maxVisibleInfoTop);
  } else if (isTouchLayout) {
    const nearCoverGap = clamp(Math.round(coverHeightPx * 0.01), 2, 5);
    const maxInfoTop = Math.max(minInfoTop, Math.floor(stackBottomLocal - infoBottomMargin - infoLayout.height));
    infoTop = Math.min(maxInfoTop, minInfoTop + nearCoverGap);
  } else {
    const desiredBottomGap = clamp(Math.round(coverHeightPx * 0.012), 4, 8);
    const preferredInfoTop = Math.floor(stackBottomLocal - infoBottomMargin - infoLayout.height - desiredBottomGap);
    infoTop = Math.max(minInfoTop, preferredInfoTop);
  }
  infoTop = clamp(infoTop, minInfoTop, maxVisibleInfoTop);
  el.infoPanel.style.top = `${infoTop}px`;
  el.infoPanel.style.bottom = "auto";
}

function syncPlaybackStripLayout(coverBounds) {
  if (!el.playbackStrip || !el.chromeTop) return;
  const chromeStyle = window.getComputedStyle(el.chromeTop);
  const chromePadLeft = parseFloat(chromeStyle.paddingLeft) || 0;
  const chromePadRight = parseFloat(chromeStyle.paddingRight) || 0;
  const chromeInnerWidth = Math.max(0, el.chromeTop.clientWidth - chromePadLeft - chromePadRight);
  const coverWidthPx = coverBounds ? Math.max(0, Math.round(coverBounds.width)) : getNominalCoverWidth();
  const inset = clamp(Math.round(coverWidthPx * 0.04), 4, 12);
  const stripWidth = Math.min(
    Math.max(100, coverWidthPx - inset * 2),
    Math.max(100, chromeInnerWidth - 8)
  );
  const chromeOriginX = el.chromeTop.getBoundingClientRect().left + chromePadLeft;
  const stripCenterX = coverBounds && el.container
    ? el.container.getBoundingClientRect().left + coverBounds.centerX - chromeOriginX
    : chromeInnerWidth / 2;
  const offsetFromCenter = stripCenterX - chromeInnerWidth / 2;
  const scaleT = clamp(stripWidth / 360, 0.62, 1);
  const mix = (min, max) => Math.round(min + (max - min) * scaleT);

  el.playbackStrip.style.width = `${stripWidth}px`;
  el.playbackStrip.style.maxWidth = `${stripWidth}px`;
  el.playbackStrip.style.left = "";
  el.playbackStrip.style.top = "";
  el.playbackStrip.style.marginLeft = "auto";
  el.playbackStrip.style.marginRight = "auto";
  el.playbackStrip.style.transform =
    Math.abs(offsetFromCenter) >= 1 ? `translateX(${Math.round(offsetFromCenter)}px)` : "none";
  el.playbackStrip.style.setProperty("--playback-strip-gap", `${mix(4, 8)}px`);
  el.playbackStrip.style.setProperty("--seek-hit-height", `${mix(24, 34)}px`);
  el.playbackStrip.style.setProperty("--seek-track-height", `${mix(4, 6)}px`);
  el.playbackStrip.style.setProperty("--seek-handle-size", `${mix(10, 14)}px`);
  el.playbackStrip.style.setProperty("--seek-time-min-width", `${mix(56, 74)}px`);
  el.playbackStrip.style.setProperty("--seek-time-font-size", `${mix(10, 12)}px`);
  el.playbackStrip.style.setProperty("--top-volume-button-size", `${mix(22, 28)}px`);
  el.playbackStrip.style.setProperty("--top-volume-icon-size", `${mix(14, 16)}px`);
}

function syncSearchPanelLayout(coverBounds = null) {
  if (!el.searchPanel || !el.btnSearch || !el.chromeTop) return;
  const bounds = coverBounds || getActiveCoverBounds();
  const chromeStyle = window.getComputedStyle(el.chromeTop);
  const chromePadLeft = parseFloat(chromeStyle.paddingLeft) || 0;
  const chromePadRight = parseFloat(chromeStyle.paddingRight) || 0;
  const chromeInnerWidth = Math.max(0, el.chromeTop.clientWidth - chromePadLeft - chromePadRight);
  const chromeRect = el.chromeTop.getBoundingClientRect();
  const btnRect = el.btnSearch.getBoundingClientRect();
  if (!chromeRect.width) return;
  const coverWidthPx = bounds ? Math.max(0, Math.round(bounds.width)) : 0;
  const inset = coverWidthPx ? clamp(Math.round(coverWidthPx * 0.04), 4, 12) : 0;
  const panelWidth = coverWidthPx
    ? Math.min(Math.max(100, coverWidthPx - inset * 2), Math.max(100, chromeInnerWidth - 8))
    : Math.min(Math.max(100, Math.round(chromeInnerWidth * 0.88)), Math.max(100, chromeInnerWidth - 8));
  const panelCenterX = bounds && el.container
    ? el.container.getBoundingClientRect().left + bounds.centerX
    : chromeRect.left + chromeInnerWidth / 2;
  const top = btnRect.bottom + 6;
  const heightRatio = state.radioInternetSearch ? 0.64 : 0.56;
  const heightCap = state.radioInternetSearch ? 460 : 400;
  let maxHeight = Math.min(
    Math.round(window.innerHeight * heightRatio),
    heightCap,
    Math.max(120, window.innerHeight - top - 12)
  );
  if (el.infoPanel) {
    const infoRect = el.infoPanel.getBoundingClientRect();
    if (infoRect.height > 0 && infoRect.top > top + 72) {
      maxHeight = Math.min(maxHeight, Math.floor(infoRect.top - top - 8));
    }
  }
  el.searchPanel.style.position = "fixed";
  el.searchPanel.style.left = `${Math.round(panelCenterX)}px`;
  el.searchPanel.style.top = `${Math.round(top)}px`;
  el.searchPanel.style.width = `${Math.round(panelWidth)}px`;
  el.searchPanel.style.maxWidth = `${Math.round(panelWidth)}px`;
  el.searchPanel.style.maxHeight = `${Math.max(120, maxHeight)}px`;
  el.searchPanel.style.transform = "translateX(-50%)";
}

function syncCanvasOverlayBounds(coverBounds) {
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

function layoutPlayer() {
  fitControlsLayout();
  // Overlay chrome (seek strip, info panel) may update every pass below.
  // refitStage() is animation-destructive — restrict it to real stage resizes only.
  const stageWidth = Math.round(el.container?.clientWidth || 0);
  const stageHeight = Math.round(el.container?.clientHeight || 0);
  if (stageWidth >= 8 && stageHeight >= 8) {
    const stageChanged =
      stageWidth !== lastStageLayoutWidth || stageHeight !== lastStageLayoutHeight;
    if (stageChanged) {
      lastStageLayoutWidth = stageWidth;
      lastStageLayoutHeight = stageHeight;
      refitStage();
    }
  }

  const activeCoverBounds = getActiveCoverBounds();
  if (activeCoverBounds) rememberLayoutCoverBounds(activeCoverBounds);
  const layoutCoverBounds = getLayoutCoverBounds();
  syncPlaybackStripLayout(layoutCoverBounds);
  positionReflectionStack(layoutCoverBounds);
  syncSearchPanelLayout(layoutCoverBounds);
  const overlayBounds = activeCoverBounds || (
    el.songInfoModal && !el.songInfoModal.classList.contains("hidden") ? getLayoutCoverBounds() : null
  );
  if (!overlayBounds) {
    markLayoutReadyIfStable();
    return;
  }

  syncCanvasOverlayBounds(overlayBounds);
  syncSongsDrawerMetrics();
  positionSongContextMenu();
  markLayoutReadyIfStable();
}

function bindEvents() {
  el.btnPlay.addEventListener("click", () => togglePlaybackFromControls().catch(showError));
  el.btnFsPlay?.addEventListener("click", () => togglePlaybackFromControls().catch(showError));
  el.btnPrev.addEventListener("click", () => handlePrevTrack());
  el.btnFsPrev?.addEventListener("click", () => handlePrevTrack());
  el.btnNext.addEventListener("click", () => handleNextTrack());
  el.btnFsNext?.addEventListener("click", () => handleNextTrack());
  el.btnBrowsePrev.addEventListener("click", () => navigateBrowseBy(-1));
  el.btnBrowseNext.addEventListener("click", () => navigateBrowseBy(1));
  el.browseStrip.addEventListener("input", handleBrowseStripInput);
  el.btnDrawer.addEventListener("click", () => setDrawerOpen(!state.drawerOpen));
  el.btnDrawerClose.addEventListener("click", () => setDrawerOpen(false));
  el.songsDrawerBackdrop.addEventListener("click", () => setDrawerOpen(false));
  el.btnDrawerFavourite.addEventListener("click", toggleDrawerAlbumFavourite);
  el.btnSongInfoClose.addEventListener("click", hideSongInfo);
  el.btnSystemInfoClose?.addEventListener("click", hideSystemInfoModal);

  el.songsTableBody.addEventListener("click", handleSongDrawerTableClick);
  el.songDrawerContextMenu?.addEventListener("click", handleSongDrawerTableClick);
  el.songDrawerContextMenu?.addEventListener("pointerdown", shieldSongDrawerContextMenuPointer, true);
  el.songsDrawer?.querySelector(".songs-table-wrap")?.addEventListener("scroll", positionSongContextMenu, { passive: true });
  if (typeof ResizeObserver !== "undefined" && el.songsDrawer) {
    const drawerMetricsObserver = new ResizeObserver(() => {
      syncSongsDrawerMetrics();
      if (state.activeSongMenuIndex != null) positionSongContextMenu();
    });
    drawerMetricsObserver.observe(el.songsDrawer);
  }
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
  el.audioPlayer.addEventListener("play", () => {
    syncBrowserPlayerState();
    updateBrowseSummary();
    scheduleSnapBackToPlaying();
  });
  el.audioPlayer.addEventListener("pause", () => {
    syncBrowserPlayerState();
    clearSnapBackTimer();
  });
  el.audioPlayer.addEventListener("timeupdate", () => syncBrowserPlayerState(false));
  el.audioPlayer.addEventListener("durationchange", () => syncBrowserPlayerState(false));
  el.audioPlayer.addEventListener("volumechange", () => syncBrowserPlayerState(false));
  el.audioPlayer.addEventListener("ended", () => {
    void advanceBrowserQueueIfNeeded();
  });
  el.audioPlayer.addEventListener("error", () => {
    if (!isBrowserPlayback()) return;
    syncBrowserPlayerState();
    setStatus("This browser could not play the selected audio file.");
    window.setTimeout(clearStatus, 2200);
  });

  el.btnSearch.addEventListener("click", () => setSearchOpen(!state.searchOpen));
  el.btnSearchClose.addEventListener("click", () => setSearchOpen(false));
  el.btnSearchClear.addEventListener("click", async () => {
    el.searchInput.value = "";
    state.searchQuery = "";
    if (state.radioInternetSearch) {
      state.searchResults = [];
      renderSearchPanel();
      return;
    }
    await loadAlbums({ resetIndex: true, filter: "", mode: BROWSE_MODE.ALBUM });
    renderSearchPanel();
  });
  el.searchInput.addEventListener("input", () => {
    state.searchQuery = el.searchInput.value;
    scheduleSearch();
    renderSearchPanel();
  });
  el.btnRadioSearchMore?.addEventListener("click", () => {
    loadMoreRadioSearch();
  });
  el.searchResults.addEventListener("click", handleSearchResultsClick);
  el.radioSearchContextMenu?.addEventListener("click", handleSearchResultsClick);
  el.radioSearchContextMenu?.addEventListener("pointerdown", shieldSongDrawerContextMenuPointer, true);
  el.searchResults.addEventListener("scroll", positionRadioSearchContextMenu, { passive: true });

  el.btnPlayerFullscreen.addEventListener("click", toggleFullscreen);
  let wheelAccum = 0;
  let wheelTimer = 0;
  el.container.addEventListener("wheel", (event) => {
    if (state.activeDropdown) closeDropdowns();
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
  el.container.addEventListener("pointerdown", handleCoverPointerDown, { passive: true });
  el.container.addEventListener("pointermove", handleCoverPointerMove, { passive: false });
  el.container.addEventListener("pointerup", handleCoverPointerEnd);
  el.container.addEventListener("pointercancel", handleCoverPointerEnd);
  el.container.addEventListener("touchstart", handleCoverTouchStart, { passive: true });
  el.container.addEventListener("touchmove", handleCoverTouchMove, { passive: false });
  el.container.addEventListener("touchend", handleCoverTouchEnd, { passive: false });
  el.container.addEventListener("touchcancel", handleCoverTouchEnd, { passive: false });
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

  const bindBrowseMenuButton = (button, dropdownId, prepare) => {
    if (!button) return;
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      suppressCoverInteraction(520);
      state.browseMenuSuppressOpen = { dropdownId: "", until: 0 };
      if (state.activeDropdown === dropdownId) {
        closeBrowseMenu(dropdownId);
      }
    }, true);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      suppressCoverInteraction(520);
      await handleBrowseMenuButtonClick(dropdownId, prepare);
    });
  };
  bindBrowseMenuButton(el.browseAlbum, "album-dropdown", async () => {
    if (state.mode !== BROWSE_MODE.ALBUM) {
      await loadAlbumBrowse("all").catch(showError);
    }
  });
  bindBrowseMenuButton(el.browseSongs, "songs-dropdown", async () => {
    if (state.mode !== BROWSE_MODE.SONGS) {
      await loadSongBrowse().catch(showError);
    }
  });
  bindBrowseMenuButton(el.browseArtist, "artist-dropdown");
  bindBrowseMenuButton(el.browsePlaylist, "playlist-dropdown");
  bindBrowseMenuButton(el.browseMore, "more-dropdown");
  bindBrowseMenuButton(el.browseSettings, "settings-dropdown");
  bindBrowseMenuInteractionShield();
  for (const dropdown of [el.albumDropdown, el.songsDropdown, el.artistDropdown, el.playlistDropdown, el.moreDropdown]) {
    dropdown.addEventListener("click", handleBrowseMenuAction);
  }
  el.settingsDropdown.addEventListener("click", handleSettingsDropdownClick);
  el.settingsDropdown.addEventListener("submit", handleSettingsSubmit);
  el.settingsDropdown.addEventListener("input", handleSettingsInput);
  el.settingsDropdown.addEventListener("change", handleSettingsInput);
  document.addEventListener("click", handleKeyboardOpenClick);
  document.addEventListener("focusin", handleEditableKeyboardFocus);
  document.addEventListener("pointerdown", handleEditableKeyboardFocus, true);
  document.addEventListener("touchstart", handleEditableKeyboardFocus, { capture: true, passive: true });
  el.touchKeyboard?.addEventListener("pointerdown", handleTouchKeyboardPointerDown, true);
  el.touchKeyboard?.addEventListener("click", handleTouchKeyboardClick, true);
  el.btnFolderBrowserClose.addEventListener("click", closeFolderBrowser);
  el.folderBrowserCancel.addEventListener("click", closeFolderBrowser);
  el.folderBrowserUse.addEventListener("click", () => applySelectedMusicFolder(el.folderBrowserPath.value).catch(showError));
  el.folderBrowserPathForm.addEventListener("submit", (event) => {
    event.preventDefault();
    browseFolder(el.folderBrowserPath.value).catch(showError);
  });
  el.folderBrowserRoots.addEventListener("click", handleFolderBrowserClick);
  el.folderBrowserList.addEventListener("click", handleFolderBrowserClick);
  el.folderBrowserList.addEventListener("submit", (event) => {
    if (event.target?.id !== "network-storage-form") return;
    event.preventDefault();
    connectNetworkStorage(event.target).catch(showError);
  });
  bindModalBackdropDismiss(el.folderBrowserModal, closeFolderBrowser);
  el.playlistCancel.addEventListener("click", closePlaylistModal);
  el.playlistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    savePlaylistFromModal().catch(showError);
  });
  bindModalBackdropDismiss(el.playlistModal, closePlaylistModal);
  bindDraggableDialog(el.playlistForm, el.playlistForm?.querySelector(".smart-playlist-title"));
  preventModalInputGhostClick(el.playlistForm);
  el.confirmDialogCancel.addEventListener("click", () => closeConfirmDialog(false));
  el.confirmDialogConfirm.addEventListener("click", () => closeConfirmDialog(true));
  bindModalBackdropDismiss(el.confirmModal, () => closeConfirmDialog(false));
  el.smartAddRule.addEventListener("click", addSmartRule);
  el.smartPlaylistCancel.addEventListener("click", closeSmartPlaylistBuilder);
  el.smartPlaylistForm.addEventListener("submit", (event) => {
    event.preventDefault();
    saveSmartPlaylistFromModal().catch(showError);
  });
  el.smartPlaylistForm.addEventListener("change", handleSmartPlaylistFormChange);
  el.smartRuleList.addEventListener("click", handleSmartPlaylistRuleClick);
  bindModalBackdropDismiss(el.smartPlaylistModal, closeSmartPlaylistBuilder);
  preventModalInputGhostClick(el.smartPlaylistForm);

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
      closeFolderBrowser();
      closePlaylistModal();
      closeSmartPlaylistBuilder();
      closeConfirmDialog(false);
      closeTouchKeyboard();
      hideSongInfo();
      hideSystemInfoModal();
    }
  });
}

function isInsideSongDrawerSurface(target) {
  return Boolean(target?.closest?.("#songs-drawer, #btn-drawer, #song-drawer-context-menu"));
}

function shieldSongDrawerContextMenuPointer(event) {
  event.stopPropagation();
}

function handleOutsideInteraction(event) {
  const target = event.target;
  const insideTouchKeyboardPanel = Boolean(el.touchKeyboard?.contains(target));
  if (insideTouchKeyboardPanel) return;
  if (isBrowseMenuAnchor(target)) return;
  const clickedActiveCover = isCoverCanvasTarget(target) && isPointInsideActiveCover(event.clientX, event.clientY);
  const onActiveDropdownAnchor = isActiveDropdownAnchor(target);
  const insideDropdown = isBrowseMenuSurface(target);
  const insideVolume = Boolean(target.closest?.("#volume-wrap, #volume-popover"));
  const insideInfoMenu = Boolean(target.closest?.("#info-panel, #info-context-menu"));
  const insideSongMenu = Boolean(target.closest?.(".song-row-actions, #song-drawer-context-menu"));
  const insideRadioSearchMenu = Boolean(target.closest?.(".search-result-actions, #radio-search-context-menu"));
  const insideDrawer = isInsideSongDrawerSurface(target);
  const insideSongInfo = Boolean(target.closest?.("#song-info-modal"));
  const insideSystemInfo = Boolean(target.closest?.("#system-info-modal"));
  const insideSearch = Boolean(target.closest?.("#search-panel, #btn-search"));
  const insidePlaylistModal = Boolean(target.closest?.("#playlist-modal"));
  const insideSmartPlaylist = Boolean(target.closest?.("#smart-playlist-modal"));
  const insideFolderBrowser = Boolean(target.closest?.("#folder-browser-modal"));
  const insideConfirmModal = Boolean(target.closest?.("#confirm-modal"));
  const insideTouchKeyboard = insideTouchKeyboardPanel || Boolean(target.closest?.(".keyboard-open-btn"));

  if (!insideDropdown && !onActiveDropdownAnchor && !insideVolume && !insideInfoMenu && !insideSongMenu && !insideRadioSearchMenu && !insidePlaylistModal && !insideSmartPlaylist && !insideFolderBrowser && !insideConfirmModal && !insideTouchKeyboard) {
    closeTransientMenus();
  }
  if (state.drawerOpen && !insideDrawer && !insideSongInfo && !insideSearch && !insideDropdown && !clickedActiveCover) {
    if (isCoverCanvasTarget(target)) {
      state.suppressCoverTapUntil = Date.now() + 350;
    }
    setDrawerOpen(false);
  }
  if (!insideSongInfo && !insideSystemInfo && !insideSongMenu && !insideInfoMenu) {
    hideSongInfo();
  }
  if (!insideSystemInfo && !insideDropdown) {
    hideSystemInfoModal();
  }
  if (state.searchOpen && !insideSearch && !insideRadioSearchMenu && !insideSongInfo) {
    setSearchOpen(false);
  }
  const insideModal = insidePlaylistModal || insideSmartPlaylist || insideFolderBrowser || insideConfirmModal;
  if (state.touchKeyboard.open && !insideTouchKeyboard && !isKeyboardEditable(target) && !insideModal) {
    closeTouchKeyboard();
  }
}

async function handleBrowseMenuAction(event) {
  const item = event.target.closest(".browse-dropdown-item[data-action]");
  if (!item) return;
  event.preventDefault();
  event.stopPropagation();
  suppressCoverInteraction(520);
  const action = item.dataset.action;
  const value = item.dataset.value || "";
  if (action === "album-all") {
    closeDropdowns();
    await loadAlbumBrowse("all");
    return;
  }
  if (action === "album-favourite") {
    closeDropdowns();
    await loadAlbumBrowse("favourite");
    return;
  }
  if (action === "album-sort") {
    closeDropdowns();
    state.albumBrowseSort = ["year-asc", "year-desc", "title"].includes(value) ? value : "title";
    saveBrowseState();
    if (isAlbumBrowseListContext()) {
      applyAlbumBrowseSort();
      renderBrowseMenus();
    } else {
      await loadAlbumBrowse(state.albumBrowseScope || "all");
    }
    return;
  }
  if (action === "songs-display") {
    closeDropdowns();
    state.songsDisplayMode = value === "song" ? "song" : "album";
    if (state.mode === BROWSE_MODE.SONGS) await loadSongBrowse(state.songsBrowseScope);
    else saveBrowseState();
    renderBrowseMenus();
    return;
  }
  if (action === "songs-favourite") {
    closeDropdowns();
    await loadSongBrowse("favourite");
    return;
  }
  if (action === "songs-sort" || action === "songs-favourite-sort") {
    closeDropdowns();
    state.songsBrowseSort = ["year-asc", "year-desc", "title"].includes(value) ? value : "title";
    saveBrowseState();
    if (state.mode === BROWSE_MODE.SONGS) {
      applySongsBrowseSort();
      renderBrowseMenus();
    } else {
      await loadSongBrowse(state.songsBrowseScope || "all");
    }
    return;
  }
  if (action === "playlist-display") {
    closeDropdowns();
    state.playlistDisplayMode = value === "song" ? "song" : "album";
    if (state.mode === BROWSE_MODE.SMART_PLAYLIST && state.activeSmartPlaylistId) {
      await loadSmartPlaylist(state.activeSmartPlaylistId);
      return;
    }
    if (state.mode === BROWSE_MODE.PLAYLIST && state.activePlaylistId) {
      await loadRegularPlaylist(state.activePlaylistId);
      return;
    }
    saveBrowseState();
    renderBrowseMenus();
    return;
  }
  if (action === "create-playlist") {
    closeDropdowns();
    await promptCreatePlaylist(null);
    return;
  }
  if (action === "create-smart-playlist") {
    openSmartPlaylistBuilder();
    return;
  }
  if (action === "playlist") {
    closeDropdowns();
    await loadRegularPlaylist(value);
    return;
  }
  if (action === "smart-playlist") {
    closeDropdowns();
    await loadSmartPlaylist(value);
    return;
  }
  if (action === "more-panel") {
    const opening = state.activeMorePanel !== value;
    state.activeMorePanel = state.activeMorePanel === value ? "" : value;
    state.activeDropdown = "more-dropdown";
    if (value === "radio" && opening) {
      await loadRadioBrowse(state.radioScope || "favourites");
    }
    renderBrowseMenus();
    return;
  }
  if (action === "artist-panel") {
    state.activeArtistPanel = state.activeArtistPanel === value ? "" : value;
    state.activeDropdown = "artist-dropdown";
    renderBrowseMenus();
    return;
  }
  if (action === "radio-scope") {
    await loadRadioBrowse(value);
    state.activeMorePanel = "radio";
    state.activeDropdown = "more-dropdown";
    renderBrowseMenus();
    return;
  }
  if (action === "radio-search") {
    closeDropdowns();
    state.mode = BROWSE_MODE.RADIO;
    state.radioInternetSearch = true;
    state.searchResults = [];
    state.searchQuery = "";
    if (el.searchInput) el.searchInput.value = "";
    el.searchInput.placeholder = "Search internet radio...";
    setSearchOpen(true);
    return;
  }
  closeDropdowns();
  if (action === "songs-all") await loadSongBrowse("all");
  if (action === "artist") await loadArtistAlbums(value);
  if (action === "play-current-album") await playAlbum(getCurrentEntry());
  if (action === "refresh-library") await loadAlbums({ resetIndex: false });
  if (action === "rescan-library") {
    await rescanLibrary();
  }
  if (action === "refresh-audio") {
    await refreshAudioDevices();
    state.settingsStatus = "Audio devices refreshed.";
    renderBrowseMenus();
  }
  if (action === "genre") {
    state.selectedGenre = value;
    await loadAlbums({ resetIndex: true, filter: `genre:${value}`, mode: BROWSE_MODE.GENRE });
    renderBrowseMenus();
  }
  if (action === "year") {
    state.selectedYear = value;
    await loadAlbums({ resetIndex: true, filter: `year:${value}`, mode: BROWSE_MODE.YEAR });
    renderBrowseMenus();
  }
  if (action === "composer") {
    state.selectedComposer = value;
    await loadAlbums({ resetIndex: true, filter: `composer:${value}`, mode: BROWSE_MODE.COMPOSER });
    renderBrowseMenus();
  }
}

async function handleSettingsDropdownClick(event) {
  const actionButton = event.target.closest("button[data-action]");
  if (!actionButton) return;
  event.preventDefault();
  event.stopPropagation();
  suppressCoverInteraction(520);
  const action = actionButton.dataset.action;
  if (action === "font-down") setAlbumInfoFontScale(state.albumInfoFontScale - 0.1);
  if (action === "font-reset") setAlbumInfoFontScale(1);
  if (action === "font-up") setAlbumInfoFontScale(state.albumInfoFontScale + 0.1);
  if (action === "settings-picker-toggle") {
    const picker = actionButton.dataset.picker || "";
    state.settingsOpenPicker = state.settingsOpenPicker === picker ? "" : picker;
    renderBrowseMenus();
  }
  if (action === "settings-picker-select") {
    const picker = actionButton.dataset.picker || "";
    const value = actionButton.dataset.value ?? "";
    state.settingsOpenPicker = "";
    if (picker === "audio-output-route") {
      setOutputRouteDraft(value);
      state.settingsStatus = "Tap Apply Output to save audio settings.";
      renderBrowseMenus();
      return;
    }
    if (picker === "dac-hat-model") {
      state.settings.dacHat = value;
      state.settingsStatus = "Tap Apply Output to save audio settings.";
      renderBrowseMenus();
      return;
    }
    if (picker === "audio-output-device") {
      state.settings.alsaDevice = value;
      state.settingsStatus = "Tap Apply Output to save audio settings.";
      renderBrowseMenus();
      return;
    }
    if (picker === "audio-output-mixer") {
      state.settings.mixer = value;
      state.settingsStatus = "Tap Apply Output to save audio settings.";
      renderBrowseMenus();
      return;
    }
  }
  if (action === "settings-close") {
    closeDropdowns();
    return;
  }
  if (action === "apply-audio-output") {
    await applyAudioOutputSettings();
    return;
  }
  if (action === "refresh-audio") {
    await refreshAudioDevices();
    state.settingsStatus = "Audio devices refreshed.";
    renderBrowseMenus();
  }
  if (action === "service-toggle") {
    await toggleService(actionButton.dataset.service);
  }
  if (action === "wifi-password-toggle") {
    state.wifi.showPassword = !state.wifi.showPassword;
    renderBrowseMenus();
  }
  if (action === "wifi-change") {
    state.wifi.configureOpen = true;
    state.wifi.message = "";
    renderBrowseMenus();
  }
  if (action === "wifi-cancel-change") {
    state.wifi.configureOpen = false;
    state.wifi.password = "";
    state.wifi.message = "";
    renderBrowseMenus();
  }
  if (action === "wifi-network-select") {
    state.wifi.selectedSsid = actionButton.dataset.ssid || "";
    state.wifi.configureOpen = true;
    state.wifi.message = state.wifi.selectedSsid ? `Selected ${state.wifi.selectedSsid}. Enter the password, then Connect.` : "";
    renderBrowseMenus();
  }
  if (action === "wifi-scan") {
    state.wifi.configureOpen = true;
    await scanWifiNetworks();
  }
  if (action === "wifi-connect") {
    await connectWifiNetwork();
  }
  if (action === "hotspot-start") {
    state.wifi.message = "Starting hotspot...";
    renderBrowseMenus();
    const data = await apiPost("/api/network/hotspot/start").catch((error) => ({ message: error.message || "Hotspot start failed." }));
    state.wifi.message = data.message || "Hotspot started.";
    await refreshWifiStatus();
    renderBrowseMenus();
  }
  if (action === "browse-music-folder") {
    await openFolderBrowser();
  }
  if (action === "rescan-library") await rescanLibrary();
  if (action === "rebuild-artwork") await rebuildArtwork();
  if (action === "system-about") {
    closeDropdowns();
    await refreshSystemInfo();
    showSystemInfoModal();
    return;
  }
  if (action === "system-check-update") {
    await checkSystemUpdate();
    return;
  }
  if (action === "system-apply-update") {
    if (!state.system.update.available) return;
    const confirmed = await openConfirmDialog({
      title: "Install Update",
      message: `Install the latest PiTunes update (${state.system.update.latest || "newest"})? The app will restart when finished.`,
      confirmLabel: "Update",
      danger: false
    });
    if (!confirmed) return;
    state.system.update.applying = true;
    if (state.activeDropdown === "settings-dropdown" && !shouldDeferSettingsRerender()) {
      renderBrowseMenus();
    }
    const data = await apiPost("/api/system/update/apply", {}).catch((error) => ({
      ok: false,
      message: error.message || "Update failed."
    }));
    state.system.update.applying = false;
    applySystemUpdateStatus({
      ...state.system.update,
      available: data.ok ? false : state.system.update.available,
      message: data.message || (data.ok ? "Update installed. Restarting…" : "Update failed.")
    });
    if (state.activeDropdown === "settings-dropdown" && !shouldDeferSettingsRerender()) {
      renderBrowseMenus();
    }
    return;
  }
  if (action === "system-reboot") {
    const confirmed = await openConfirmDialog({
      title: "Reboot System",
      message: "Reboot the system? Music playback will stop.",
      confirmLabel: "Reboot",
      danger: true
    });
    if (!confirmed) return;
    state.settingsStatus = "Rebooting…";
    renderBrowseMenus();
    await apiPost("/api/system/control", { action: "reboot" }).catch(() => {});
    state.settingsStatus = "Reboot command sent. The system will restart shortly.";
    renderBrowseMenus();
  }
  if (action === "system-shutdown") {
    const confirmed = await openConfirmDialog({
      title: "Shut Down System",
      message: "Shut down the system? You will need physical access to power it back on.",
      confirmLabel: "Shut Down",
      danger: true
    });
    if (!confirmed) return;
    state.settingsStatus = "Shutting down…";
    renderBrowseMenus();
    await apiPost("/api/system/control", { action: "shutdown" }).catch(() => {});
    state.settingsStatus = "Shutdown command sent. The system will power off shortly.";
    renderBrowseMenus();
  }
}

function handleSettingsInput(event) {
  const target = event.target;
  if (
    !target?.matches?.(
      "#setting-visible, #setting-music-path, #wifi-ssid-input, #wifi-password-input, #wifi-country-input"
    )
  ) {
    return;
  }
  if (target.id === "setting-music-path") state.settings.musicDirectory = target.value;
  if (target.id === "setting-visible") {
    state.settings.visible = target.value;
    scheduleSettingsAutosave();
  }
  if (target.id === "wifi-ssid-input") state.wifi.selectedSsid = target.value;
  if (target.id === "wifi-password-input") state.wifi.password = target.value;
  if (target.id === "wifi-country-input") state.wifi.country = target.value.toUpperCase();
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  await saveSettings(event.target);
}

async function refreshSettingsData(options = {}) {
  const shouldRender = options.render !== false;
  const [settingsData] = await Promise.all([
    apiGet("/api/settings").catch(() => ({})),
    refreshAudioDevices(),
    refreshServices(),
    refreshWifiStatus(),
    refreshWifiNetworksCache(0, { render: false }),
    refreshSystemInfo(),
    refreshSystemUpdateStatus()
  ]);
  state.settings.musicDirectory =
    settingsData.config?.musicDir ||
    settingsData.settings?.music_directory ||
    window.localStorage.getItem(MUSIC_FOLDER_STORAGE_KEY) ||
    state.settings.musicDirectory ||
    "/mnt/music";
  window.localStorage.setItem(MUSIC_FOLDER_STORAGE_KEY, state.settings.musicDirectory);
  state.settings.storageSource = settingsData.settings?.storage_source || state.settings.storageSource || "local";
  state.settings.localDevice = settingsData.settings?.local_device || state.settings.localDevice || "";
  const savedRoute = settingsData.settings?.audio_output || state.deviceAudioOutput || "hdmi";
  state.deviceAudioOutput = savedRoute === "auto" ? "hdmi" : savedRoute;
  state.settings.dacHat = settingsData.settings?.dac_hat || state.settings.dacHat || "";
  state.settings.alsaDevice = settingsData.settings?.alsa_device || state.settings.alsaDevice || "default";
  state.settings.mixer = settingsData.settings?.mixer || state.settings.mixer || "software";
  state.settings.audioOutput = state.deviceAudioOutput;
  if (state.settings.audioOutput === "auto") state.settings.audioOutput = "hdmi";
  window.localStorage.setItem(OUTPUT_ROUTE_STORAGE_KEY, state.settings.audioOutput);
  syncAudioSettingsApplied();
  state.settings.visible = String(
    settingsData.settings?.visibleCoverCount ||
    settingsData.config?.ui?.visibleCoverCount ||
    state.settings.visible ||
    "0"
  );
  const scan = settingsData.scan || {};
  state.libraryScan = {
    ...state.libraryScan,
    ...scan,
    albumCount: Number(scan.albumCount || settingsData.counts?.albums || state.total || 0)
  };
  state.settingsStatus = scan.running
    ? `Library scan: ${scan.message || "running"}`
    : `Library: ${settingsData.counts?.albums ?? state.total ?? 0} albums, ${settingsData.counts?.tracks ?? 0} tracks`;
  state.settingsLoaded = true;
  if (scan.running) startLibraryScanPolling({ force: false });
  if (shouldRender && state.activeDropdown === "settings-dropdown" && !shouldDeferSettingsRerender()) {
    renderBrowseMenus();
  }
}

async function refreshWifiNetworksCache(retry = 0, options = {}) {
  const allowRender = options.render === true;
  const data = await apiGet("/api/network/wifi/scan?cached=1").catch(() => null);
  if (!data) return;
  if (data.networks?.length) {
    state.wifi.networks = data.networks;
    if (allowRender && state.activeDropdown === "settings-dropdown" && !shouldDeferSettingsRerender()) {
      renderBrowseMenus();
    }
  }
  if (data.scanning && retry < 12) {
    window.setTimeout(() => refreshWifiNetworksCache(retry + 1, options), 1000);
  }
}

async function refreshAudioDevices() {
  const data = await apiGet("/api/audio/devices").catch(() => ({ devices: [], hats: [] }));
  state.audioDevices = data.devices || [];
  state.dacHats = data.hats || [];
  if (data.current?.device) state.settings.alsaDevice = data.current.device;
  if (data.current?.mixer) state.settings.mixer = data.current.mixer;
  if (data.current?.dac_hat) state.settings.dacHat = data.current.dac_hat;
}

async function refreshServices() {
  const data = await apiGet("/api/services").catch(() => ({ services: {} }));
  state.services = data.services || {};
}

async function refreshWifiStatus() {
  const data = await apiGet("/api/network/wifi/status").catch(() => null);
  if (data) {
    state.wifi.status = data;
    if (data.connection?.message && data.connection?.status !== "idle") {
      state.wifi.message = data.connection.message;
    }
    if (data.station?.saved_ssid || data.station?.ssid) {
      state.wifi.selectedSsid = data.station.saved_ssid || data.station.ssid || state.wifi.selectedSsid;
    }
    state.wifi.credentialsSaved = Boolean(data.station?.credentials_saved);
    if (data.station?.saved_country) {
      state.wifi.country = data.station.saved_country;
    }
  }
}

async function pollWifiConnection(retry = 0) {
  await refreshWifiStatus();
  if (state.activeDropdown === "settings-dropdown") renderBrowseMenus();
  const status = state.wifi.status?.connection?.status;
  if (status === "connected" && state.wifi.status?.station?.active) {
    state.wifi.configureOpen = false;
    state.wifi.password = "";
    if (state.activeDropdown === "settings-dropdown") renderBrowseMenus();
    return;
  }
  if ((status === "queued" || status === "connecting") && retry < 45) {
    window.setTimeout(() => pollWifiConnection(retry + 1), 2000);
  }
}

async function scanWifiNetworks() {
  state.wifi.loading = true;
  state.wifi.message = "Scanning WiFi networks...";
  state.activeDropdown = "settings-dropdown";
  renderBrowseMenus();
  try {
    const data = await apiGet("/api/network/wifi/scan");
    if (data.networks?.length) state.wifi.networks = data.networks;
    state.wifi.message = data.error || data.warning || data.message || (state.wifi.networks.length ? `${state.wifi.networks.length} networks found.` : "No networks found. You can enter the SSID manually.");
  } catch (error) {
    state.wifi.message = error.message || "WiFi scan failed.";
  } finally {
    state.wifi.loading = false;
    state.activeDropdown = "settings-dropdown";
    renderBrowseMenus();
  }
}

async function connectWifiNetwork() {
  const ssid = String(state.wifi.selectedSsid || "").trim();
  const password = String(state.wifi.password || "");
  const country = String(state.wifi.country || "GB").trim().toUpperCase() || "GB";
  if (!ssid) {
    state.wifi.message = "Enter or select a WiFi network.";
    renderBrowseMenus();
    return;
  }
  if (!password && !state.wifi.credentialsSaved) {
    state.wifi.message = "Enter the WiFi password.";
    renderBrowseMenus();
    return;
  }
  state.wifi.message = `Saving credentials for ${ssid}...`;
  state.activeDropdown = "settings-dropdown";
  renderBrowseMenus();
  try {
    const data = await apiPost("/api/network/wifi/connect", { ssid, password, country });
    state.wifi.message = data.message || `Connecting to ${ssid}. Reopen http://pitunes.local after the Pi joins WiFi.`;
    if (data.connection) {
      state.wifi.status = {...state.wifi.status, connection: data.connection};
    }
  } catch (error) {
    state.wifi.message = error.message || "WiFi connect failed.";
  }
  pollWifiConnection();
  state.activeDropdown = "settings-dropdown";
  renderBrowseMenus();
}

async function saveSettings(form, options = {}) {
  const formData = new FormData(form);
  const appliedAudio = state.audioSettingsApplied || snapshotAudioSettings();
  state.settings.musicDirectory = String(formData.get("music_directory") || "/mnt/music");
  state.settings.visible = String(formData.get("visible") || "0");
  const piRoute =
    appliedAudio.audioOutput === BROWSER_OUTPUT_ROUTE ? appliedAudio.deviceAudioOutput : appliedAudio.audioOutput;
  await apiPost("/api/settings", {
    music_directory: state.settings.musicDirectory,
    storage_source: state.settings.storageSource,
    local_device: state.settings.localDevice || "",
    audio_output: piRoute === "auto" ? "hdmi" : piRoute,
    dac_hat: appliedAudio.dacHat,
    alsa_device: appliedAudio.alsaDevice,
    mixer: appliedAudio.mixer,
    visibleCoverCount: Number(state.settings.visible)
  });
  window.localStorage.setItem(MUSIC_FOLDER_STORAGE_KEY, state.settings.musicDirectory);
  state.settingsStatus = options.message || "Settings saved.";
  if (options.render !== false) renderBrowseMenus();
}

async function applyAudioOutputSettings() {
  if (state.settings.audioOutput === "dac-hat" && !state.settings.dacHat) {
    state.settingsStatus = "Select a DAC HAT model before applying.";
    renderBrowseMenus();
    return;
  }
  state.settingsStatus = "Applying audio output...";
  state.activeDropdown = "settings-dropdown";
  renderBrowseMenus();
  const piRoute =
    state.settings.audioOutput === BROWSER_OUTPUT_ROUTE ? state.deviceAudioOutput : state.settings.audioOutput;
  try {
    await apiPost("/api/settings", {
      music_directory: state.settings.musicDirectory,
      storage_source: state.settings.storageSource,
      local_device: state.settings.localDevice || "",
      audio_output: piRoute === "auto" ? "hdmi" : piRoute,
      dac_hat: state.settings.dacHat,
      alsa_device: state.settings.alsaDevice,
      mixer: state.settings.mixer,
      visibleCoverCount: Number(state.settings.visible)
    });
    window.localStorage.setItem(OUTPUT_ROUTE_STORAGE_KEY, state.settings.audioOutput);
    if (state.settings.audioOutput !== BROWSER_OUTPUT_ROUTE) {
      state.deviceAudioOutput = state.settings.audioOutput;
    }
    if (!isBrowserPlayback()) {
      const audioResult = await apiPost("/api/audio/output", {
        output: piRoute === "auto" ? "hdmi" : piRoute,
        dac_hat: state.settings.dacHat,
        alsa: state.settings.alsaDevice,
        mixer: state.settings.mixer
      });
      if (audioResult?.reboot_required) {
        syncAudioSettingsApplied();
        state.settingsStatus = audioResult.message || "Reboot the Pi to enable the DAC HAT.";
        renderBrowseMenus();
        return;
      }
    }
    commitOutputRouteDraft();
    syncAudioSettingsApplied();
    state.settingsStatus = "Audio output applied.";
  } catch (error) {
    state.settingsStatus = error.message || "Audio output apply failed.";
  }
  state.activeDropdown = "settings-dropdown";
  renderBrowseMenus();
}

function scheduleSettingsAutosave() {
  window.clearTimeout(settingsAutosaveTimerId);
  settingsAutosaveTimerId = window.setTimeout(async () => {
    const form = el.settingsDropdown.querySelector("#pitunes-settings-form");
    if (!form) return;
    try {
      await saveSettings(form, { message: "Settings saved.", render: false });
      if (state.activeDropdown === "settings-dropdown") renderBrowseMenus();
    } catch (error) {
      state.settingsStatus = error.message || "Settings save failed.";
      renderBrowseMenus();
    }
  }, 700);
}

function setOutputRouteDraft(route) {
  state.settings.audioOutput = String(route || "hdmi");
  if (state.settings.audioOutput !== "dac-hat" && state.settingsOpenPicker === "dac-hat-model") {
    state.settingsOpenPicker = "";
  }
  if (state.settings.audioOutput !== BROWSER_OUTPUT_ROUTE) {
    state.deviceAudioOutput = state.settings.audioOutput;
  }
}

function commitOutputRouteDraft() {
  const previousRoute = state.audioSettingsApplied?.audioOutput || state.settings.audioOutput;
  window.localStorage.setItem(OUTPUT_ROUTE_STORAGE_KEY, state.settings.audioOutput);
  if (previousRoute === BROWSER_OUTPUT_ROUTE && !isBrowserPlayback()) {
    el.audioPlayer.pause();
  }
  if (isBrowserPlayback()) syncBrowserPlayerState();
  else refreshPlayer();
}

async function toggleService(service) {
  if (!service) return;
  const current = normalizeServiceState(state.services[service]);
  state.settingsStatus = `${current.active ? "Stopping" : "Starting"} ${service}...`;
  state.activeDropdown = "settings-dropdown";
  setOptimisticServiceState(service, !current.active);
  renderBrowseMenus();
  const data = await apiPost("/api/services/control", {
    service,
    action: current.active ? "stop" : "start"
  }).catch((error) => ({ message: error.message || "Service command failed." }));
  await refreshServices();
  state.settingsStatus = data.message || `${service} command sent.`;
  state.activeDropdown = "settings-dropdown";
  renderBrowseMenus();
}

async function rescanLibrary() {
  const form = el.settingsDropdown.querySelector("#pitunes-settings-form");
  if (form) {
    await saveSettings(form, { message: "Settings saved.", render: false, skipAudioOutput: true });
  }
  const musicPath = state.settings.musicDirectory || "/mnt/music";
  state.libraryScan = {
    ...state.libraryScan,
    running: true,
    progress: 0,
    message: `Scanning ${musicPath}`,
    lastError: ""
  };
  state.settingsStatus = `Scanning ${musicPath}...`;
  renderBrowseMenus();
  const data = await apiPost("/api/library/rescan").catch(() => apiPost("/api/rescan"));
  if (data.message) state.settingsStatus = data.message;
  if (data.scan) {
    state.libraryScan = { ...state.libraryScan, ...data.scan };
    if (data.scan.message) state.settingsStatus = data.scan.message;
  }
  renderBrowseMenus();
  startLibraryScanPolling({ force: true });
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForLibraryScan(startedAtMs) {
  let sawRunning = false;
  let latest = null;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    latest = await apiGet("/api/library/scan-status").catch(() => latest);
    if (latest) {
      const message = latest.message || latest.lastRun?.status || "Scanning files";
      if (latest.running) {
        sawRunning = true;
        state.settingsStatus = `${message}${latest.progress ? ` (${latest.progress})` : ""}`;
        renderBrowseMenus();
      } else {
        const lastFinishedAt = Number(latest.lastFinishedAt || latest.lastRun?.finished_at || 0) * 1000;
        const lastStartedAt = Number(latest.lastRun?.started_at || 0) * 1000;
        const belongsToThisScan = sawRunning || lastFinishedAt >= startedAtMs - 2000 || lastStartedAt >= startedAtMs - 2000;
        if (latest.lastError || belongsToThisScan || attempt > 1) return latest;
      }
    }
    await delay(1000);
  }
  return latest;
}

function startLibraryScanPolling({ force = false } = {}) {
  if (scanPollTimerId && !force) return;
  window.clearTimeout(scanPollTimerId);
  scanPollTimerId = 0;
  scanPollGeneration += 1;
  lastProgressiveAlbumTotal = -1;
  lastProgressiveAlbumRefreshAt = 0;
  pollLibraryScan(scanPollGeneration).catch((error) => {
    state.libraryScan = {
      ...state.libraryScan,
      running: false,
      lastError: error.message || "Scan status unavailable."
    };
    state.settingsStatus = state.libraryScan.lastError;
    renderBrowseMenus();
  });
}

async function pollLibraryScan(generation) {
  const scan = await apiGet("/api/library/scan-status");
  if (generation !== scanPollGeneration) return;
  const wasRunning = state.libraryScan?.running;
  state.libraryScan = {
    ...state.libraryScan,
    ...scan,
    albumCount: Number(scan.albumCount || state.libraryScan?.albumCount || 0)
  };
  if (state.libraryScan.lastError) {
    state.settingsStatus = `Scan failed: ${state.libraryScan.lastError}`;
  } else if (state.libraryScan.running) {
    state.settingsStatus = scanMessage(state.libraryScan);
  } else if (wasRunning || state.libraryScan.message === "Scan complete") {
    state.settingsStatus = scanMessage({ ...state.libraryScan, message: "Scan complete" });
  }

  const shouldRefreshAlbums =
    ALBUM_BROWSE_MODES.includes(state.mode) &&
    (state.libraryScan.running || wasRunning) &&
    shouldRefreshAlbumsForScan(state.libraryScan);
  if (shouldRefreshAlbums) {
    await refreshAlbumsForScan();
  } else {
    renderBrowseMenus();
  }

  if (state.libraryScan.running) {
    scanPollTimerId = window.setTimeout(() => {
      pollLibraryScan(generation).catch(showError);
    }, 1200);
  } else {
    scanPollTimerId = 0;
    if (wasRunning) {
      state.artCacheVersion = Date.now();
      await loadAlbums({ resetIndex: false, quiet: true });
      renderBrowseMenus();
    }
  }
}

function shouldRefreshAlbumsForScan(scan) {
  const now = Date.now();
  const albumTotal = Number(scan.albumCount || 0);
  if (albumTotal !== lastProgressiveAlbumTotal) return true;
  return now - lastProgressiveAlbumRefreshAt > 2800;
}

async function refreshAlbumsForScan() {
  lastProgressiveAlbumTotal = Number(state.libraryScan?.albumCount || 0);
  lastProgressiveAlbumRefreshAt = Date.now();
  await loadAlbums({ resetIndex: state.entries.length === 0, quiet: true });
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
  window.localStorage.setItem("pitunes-album-info-font-scale", String(state.albumInfoFontScale));
  state.settingsStatus = `Album info font ${Math.round(state.albumInfoFontScale * 100)}%`;
  renderBrowseMenus();
  scheduleLayoutPlayer();
}

function exitNativeFullscreen() {
  if (!isNativeFullscreen()) return;
  document.exitFullscreen?.();
  document.webkitExitFullscreen?.();
}

async function requestNativeFullscreen() {
  if (!prefersNativeFullscreen() || !el.app || isNativeFullscreen()) return;
  try {
    if (el.app.requestFullscreen) {
      await el.app.requestFullscreen();
    } else if (el.app.webkitRequestFullscreen) {
      await el.app.webkitRequestFullscreen();
    }
  } catch (error) {
    console.warn("Native fullscreen request failed; using in-browser fullscreen.", error);
  }
}

async function toggleFullscreen() {
  const nextOpen = !isPlayerFullscreen();
  if (isKioskLaunch()) {
    kioskFullscreenSuppressed = !nextOpen;
  }
  document.body.classList.toggle("is-player-fullscreen", nextOpen);
  if (nextOpen) {
    await requestNativeFullscreen();
  } else {
    exitNativeFullscreen();
  }
  syncFullscreenButton({ fromToggle: true });
}

function syncFullscreenButton(options = {}) {
  const nativeOpen = isNativeFullscreen();
  const classOpen = document.body.classList.contains("is-player-fullscreen");
  if (!options.fromToggle) {
    if (nativeOpen && !classOpen) {
      document.body.classList.add("is-player-fullscreen");
    } else if (!nativeOpen && classOpen && prefersNativeFullscreen()) {
      // Kiosk uses in-browser fullscreen only; do not clear the class when native fullscreen is unavailable.
      document.body.classList.remove("is-player-fullscreen");
    }
  }
  const open = isPlayerFullscreen();
  setCoverLayoutProfile(open ? "fullscreen" : "normal");
  el.btnPlayerFullscreen.setAttribute("aria-pressed", String(open));
  el.btnPlayerFullscreen.classList.toggle("is-active", open);
  el.btnPlayerFullscreen.setAttribute("aria-label", open ? "Exit fullscreen player" : "Enter fullscreen player");
  el.btnPlayerFullscreen.setAttribute("title", open ? "Exit fullscreen" : "Fullscreen player");
  el.btnPlayerFullscreen.querySelector(".icon-fullscreen-enter")?.classList.toggle("hidden", open);
  el.btnPlayerFullscreen.querySelector(".icon-fullscreen-exit")?.classList.toggle("hidden", !open);
  if (open) closeDropdowns();
  el.fullscreenTransport?.setAttribute("aria-hidden", String(!open));
  scheduleLayoutPlayer();
}

function isCoverCanvasTarget(target) {
  return target?.tagName === "CANVAS";
}

function isCoverInteractionTarget(target) {
  return !target?.closest?.(
    "#info-panel, #songs-drawer, #songs-drawer-backdrop, #song-info-modal, #system-info-modal, " +
    "#search-panel, #controls, #browse-bar-shell, #player-chrome-top, .browse-dropdown, .song-context-menu"
  );
}

function getActiveCoverHitBox() {
  return getActiveCoverBounds();
}

function getCoverSurfaceRect() {
  const canvas = el.container?.querySelector("canvas");
  return (canvas || el.container).getBoundingClientRect();
}

function isPointInsideActiveCover(clientX, clientY) {
  const bounds = getActiveCoverHitBox();
  if (!bounds) return false;
  const rect = getCoverSurfaceRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  return (
    localX >= bounds.left &&
    localX <= bounds.right &&
    localY >= bounds.top &&
    localY <= bounds.bottom
  );
}

function navigateCoverFromSideTap(clientX, clientY) {
  const bounds = getActiveCoverHitBox();
  if (!bounds || state.drawerOpen) return false;
  const rect = getCoverSurfaceRect();
  const localX = clientX - rect.left;
  navigateBrowseBy(localX < bounds.centerX ? -1 : 1);
  return true;
}

function isCoverSideTapGesture(totalDx, totalDy, clientX, clientY) {
  if (state.drawerOpen || state.searchOpen || state.activeDropdown) return false;
  if (isPointInsideActiveCover(clientX, clientY)) return false;
  if (!getActiveCoverHitBox()) return false;
  if (Math.abs(totalDy) > Math.max(32, Math.abs(totalDx) * 1.25)) return false;
  return Math.abs(totalDx) <= 32 && Math.abs(totalDy) <= 32;
}

function handleCoverSurfaceTap(target, clientX, clientY) {
  if (state.activeDropdown || Date.now() < state.suppressCoverTapUntil) return true;
  if (!isCoverInteractionTarget(target)) return false;
  const bounds = getActiveCoverHitBox();
  if (!bounds) return false;
  if (!isCoverCanvasTarget(target) && !isPointInsideActiveCover(clientX, clientY)) return false;

  if (isPointInsideActiveCover(clientX, clientY)) {
    setDrawerOpen(!state.drawerOpen);
    return true;
  }

  if (state.drawerOpen) return true;

  return navigateCoverFromSideTap(clientX, clientY);
}

function coverDragStepPx() {
  const bounds = getActiveCoverBounds();
  return clamp(Math.round((bounds?.width || el.container.clientWidth || 320) * 0.16), 30, 88);
}

function beginCoverDrag(source, id, target, clientX, clientY) {
  if (state.activeDropdown) closeDropdowns();
  if (Date.now() < state.suppressCoverTapUntil) return false;
  if (!isCoverInteractionTarget(target)) return false;
  if (!isCoverCanvasTarget(target) && !isPointInsideActiveCover(clientX, clientY)) return false;
  if (state.drawerOpen || state.searchOpen) return false;
  state.coverDrag = {
    active: true,
    pointerId: id,
    source,
    startX: clientX,
    startY: clientY,
    lastX: clientX,
    accumulatedX: 0,
    moved: false
  };
  return true;
}

function moveCoverDrag(clientX, clientY) {
  if (!state.coverDrag.active) return false;
  const dx = clientX - state.coverDrag.lastX;
  const totalDx = clientX - state.coverDrag.startX;
  const totalDy = clientY - state.coverDrag.startY;
  if (!state.coverDrag.moved && Math.abs(totalDx) < 8 && Math.abs(totalDy) < 8) return;
  if (Math.abs(totalDy) > Math.abs(totalDx) * 1.4) return;

  state.coverDrag.moved = true;
  state.coverDrag.lastX = clientX;
  state.coverDrag.accumulatedX += dx;

  const step = coverDragStepPx();
  while (Math.abs(state.coverDrag.accumulatedX) >= step) {
    const direction = state.coverDrag.accumulatedX < 0 ? 1 : -1;
    navigateBrowseBy(direction);
    state.coverDrag.accumulatedX -= direction > 0 ? -step : step;
  }
  return true;
}

function endCoverDrag(clientX, clientY) {
  if (!state.coverDrag.active) return false;
  const totalDx = clientX - state.coverDrag.startX;
  const totalDy = clientY - state.coverDrag.startY;
  const dragged = state.coverDrag.moved || Math.abs(totalDx) > 16 || Math.abs(totalDy) > 16;
  let handled = false;

  if (dragged && Math.abs(totalDx) > Math.abs(totalDy) && Math.abs(state.coverDrag.accumulatedX) > coverDragStepPx() * 0.35) {
    navigateBrowseBy(state.coverDrag.accumulatedX < 0 ? 1 : -1);
    handled = true;
  } else if (isCoverSideTapGesture(totalDx, totalDy, clientX, clientY)) {
    handled = navigateCoverFromSideTap(clientX, clientY);
  } else if (!dragged && isPointInsideActiveCover(clientX, clientY) && Date.now() >= state.suppressCoverTapUntil) {
    setDrawerOpen(!state.drawerOpen);
    handled = true;
  }

  if (handled || dragged) {
    state.suppressCoverTapUntil = Date.now() + 260;
  }
  state.coverDrag.active = false;
  state.coverDrag.pointerId = null;
  state.coverDrag.source = "";
  return handled || dragged;
}

function handleCoverPointerDown(event) {
  if (Date.now() < state.suppressCoverTapUntil) return;
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (!beginCoverDrag("pointer", event.pointerId, event.target, event.clientX, event.clientY)) return;
  el.container.setPointerCapture?.(event.pointerId);
}

function handleCoverPointerMove(event) {
  if (!state.coverDrag.active || state.coverDrag.source !== "pointer" || state.coverDrag.pointerId !== event.pointerId) return;
  if (moveCoverDrag(event.clientX, event.clientY)) event.preventDefault();
}

function handleCoverPointerEnd(event) {
  if (!state.coverDrag.active || state.coverDrag.source !== "pointer" || state.coverDrag.pointerId !== event.pointerId) return;
  const moved = endCoverDrag(event.clientX, event.clientY);
  try {
    el.container.releasePointerCapture?.(event.pointerId);
  } catch (_error) {
    // Pointer capture may already be released by the browser.
  }
  if (moved) event.preventDefault?.();
}

function firstChangedTouch(event) {
  const id = state.coverDrag.pointerId;
  return [...(event.changedTouches || [])].find((touch) => touch.identifier === id) || event.changedTouches?.[0] || null;
}

function handleCoverTouchStart(event) {
  if (Date.now() < state.suppressCoverTapUntil) return;
  const touch = event.changedTouches?.[0];
  if (!touch) return;
  if (state.coverDrag.active && state.coverDrag.source === "pointer") {
    state.coverDrag.active = false;
    state.coverDrag.pointerId = null;
    state.coverDrag.source = "";
  } else if (state.coverDrag.active) {
    return;
  }
  beginCoverDrag("touch", touch.identifier, event.target, touch.clientX, touch.clientY);
}

function handleCoverTouchMove(event) {
  if (!state.coverDrag.active) return;
  const touch = firstChangedTouch(event);
  if (!touch) return;
  if (state.coverDrag.source === "pointer") {
    state.coverDrag.source = "touch";
    state.coverDrag.pointerId = touch.identifier;
  }
  if (state.coverDrag.source !== "touch") return;
  if (moveCoverDrag(touch.clientX, touch.clientY)) event.preventDefault();
}

function handleCoverTouchEnd(event) {
  if (!state.coverDrag.active || state.coverDrag.source !== "touch") return;
  const touch = firstChangedTouch(event);
  if (!touch) return;
  if (endCoverDrag(touch.clientX, touch.clientY)) event.preventDefault();
}

function getVolumeIconPath(volume) {
  if (volume <= 0) return "M16.5 12 21 7.5 19.5 6 15 10.5 10.5 6H7v12h3.5l4.5-4.5 4.5 4.5L21 16.5 16.5 12z";
  if (volume < 45) return "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z";
  return "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z";
}

function normalizedWheelStep(event) {
  const dominantDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!Number.isFinite(dominantDelta) || dominantDelta === 0) return 0;

  let scale = WHEEL_PIXEL_SCALE;
  if (event.deltaMode === 1) scale = WHEEL_LINE_SCALE;
  else if (event.deltaMode === 2) scale = WHEEL_PAGE_SCALE;

  return clamp(dominantDelta * scale, -WHEEL_MAX_STEP, WHEEL_MAX_STEP);
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

function setStatus(_message) {
  // Status toasts disabled — browse/empty states use the info panel; errors go to console.
  clearStatus();
}

function clearStatus() {
  el.statusOverlay.classList.add("hidden");
}

function showError(error) {
  console.error(error);
  setStatus(error.message || "PiTunes could not load.");
}

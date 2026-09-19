const HEADERS = [
  "keep", "notes", "title", "artist", "album_artist", "album", "year", "genre",
  "composer", "track_number", "duration", "format", "bitrate_kbps", "file_name",
  "file_extension", "relative_path", "favourite_song", "favourite_album",
  "favourite_albums", "playlists", "playlist_positions", "selection_sources", "pitunes_song_id"
];

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

function normalizeTrack(track, fallback = {}) {
  const file = String(track.file || track.path || track.id || "");
  const name = file.split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1) : "";
  return {
    id: String(track.id || file), file,
    title: String(track.title || name || "Unknown Title"),
    artist: String(track.artist || track.singer || fallback.artist || ""),
    albumArtist: String(track.albumArtist || fallback.albumArtist || ""),
    album: String(track.album || fallback.album || fallback.title || ""),
    year: String(track.year || fallback.year || ""),
    genre: String(track.genre || fallback.genre || ""),
    composer: String(track.composer || ""),
    trackNumber: track.trackNumber || track.trackNo || "",
    duration: track.duration || "",
    format: String(track.suffix || extension).toUpperCase(),
    bitrate: track.bitRate || track.bitrate || "",
    name, extension
  };
}

function addTrack(records, raw, source, options = {}) {
  const track = normalizeTrack(raw, options.album || {});
  const key = track.file || track.id;
  if (!key) return;
  let record = records.get(key);
  if (!record) {
    record = { track, favouriteSong: false, albums: new Set(), playlists: new Map(), sources: new Set() };
    records.set(key, record);
  } else {
    for (const [field, value] of Object.entries(track)) {
      if (!record.track[field] && value) record.track[field] = value;
    }
  }
  record.sources.add(source);
  if (source === "Favourite song") record.favouriteSong = true;
  if (source === "Favourite album") record.albums.add(options.album?.title || options.album?.album || track.album);
  if (source === "Playlist") {
    const name = options.playlistName;
    if (!record.playlists.has(name)) record.playlists.set(name, []);
    record.playlists.get(name).push(options.position);
  }
}

export function buildMusicListCsv(records) {
  const rows = [...records.values()]
    .sort((left, right) => {
      for (const field of ["artist", "album", "trackNumber", "title"]) {
        const result = String(left.track[field] || "").localeCompare(String(right.track[field] || ""), undefined, {
          numeric: true, sensitivity: "base"
        });
        if (result) return result;
      }
      return 0;
    })
    .map((record) => {
      const track = record.track;
      const positions = [...record.playlists].map(([name, indices]) => `${name}: ${indices.join(", ")}`);
      return [
        "", "", track.title, track.artist, track.albumArtist, track.album, track.year, track.genre,
        track.composer, track.trackNumber, track.duration ? formatDuration(track.duration) : "",
        track.format, track.bitrate, track.name, track.extension, track.file,
        record.favouriteSong ? "Yes" : "", record.albums.size ? "Yes" : "",
        [...record.albums].join(" | "), [...record.playlists.keys()].join(" | "),
        positions.join(" | "), [...record.sources].join(" | "), track.id
      ];
    });
  return `\ufeff${[HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

async function runLimited(items, worker, check, onProgress) {
  let next = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      check();
      const item = items[next++];
      await worker(item);
      check();
      onProgress(++completed);
    }
  }));
}

export async function collectMusicLists({ get, favouriteSongs, favouriteAlbums, playlists, check = () => {}, onProgress = () => {} }) {
  const records = new Map();
  const favourites = favouriteSongs || favouriteAlbums ? await get("/api/library/favourites") : { tracks: [], albums: [] };
  check();
  const albumIds = favouriteAlbums ? [...new Set((favourites.albums || []).map(String))] : [];
  const tasks = albumIds.length + playlists.length;
  let completed = 0;
  if (favouriteSongs) {
    const payload = await get("/api/library/starred/tracks");
    check();
    for (const track of payload.tracks || []) addTrack(records, track, "Favourite song");
  }

  await runLimited(albumIds, async (id) => {
    const payload = await get(`/api/library/album/${encodeURIComponent(id)}/tracks`);
    check();
    const first = (payload.tracks || [])[0] || {};
    const album = {
      title: first.album || id,
      albumArtist: first.albumArtist || "",
      year: first.year || "",
      genre: first.genre || ""
    };
    for (const track of payload.tracks || []) addTrack(records, track, "Favourite album", { album });
  }, check, () => onProgress(++completed, tasks));

  await runLimited(playlists, async (playlist) => {
    const payload = await get(`/api/library/playlists/${encodeURIComponent(playlist.id)}/tracks`);
    check();
    const tracks = new Map((payload.tracks || []).map((track) => [String(track.file || track.id), track]));
    const ids = payload.playlist?.trackIds || playlist.trackIds || [];
    ids.forEach((id, index) => {
      const track = tracks.get(String(id));
      if (track) addTrack(records, track, "Playlist", { playlistName: playlist.name, position: index + 1 });
    });
  }, check, () => onProgress(++completed, tasks));
  check();
  return { records, csv: buildMusicListCsv(records) };
}

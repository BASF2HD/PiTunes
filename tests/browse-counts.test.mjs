import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { getBrowseMenuCountText } from "../frontend/assets/browse-counts.js";

const source = await readFile(new URL("../frontend/assets/app.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const base = () => ({ mode: "album", total: 1692, songBrowseTotal: null,
  artists: [{}, {}, {}], composers: [{}], playlists: [{}, {}], smartPlaylists: [{}] });

test("album and song headers use the selected result total without labels", () => {
  const state = base();
  assert.equal(getBrowseMenuCountText("album", state), (1692).toLocaleString());
  state.total = 45;
  assert.equal(getBrowseMenuCountText("album", state), "45");
  state.mode = "songs";
  state.total = 26;
  state.songBrowseTotal = 335;
  assert.equal(getBrowseMenuCountText("songs", state), "335");
  state.songBrowseTotal = 0;
  assert.equal(getBrowseMenuCountText("songs", state), "0");
});

test("unloaded counts are unknown instead of reusing another menu total", () => {
  const state = base();
  assert.equal(getBrowseMenuCountText("songs", state), "—");
  state.mode = "songs";
  assert.equal(getBrowseMenuCountText("songs", state), "—");
});

test("artists and composers follow the selected panel; playlists include smart lists", () => {
  const state = base();
  assert.equal(getBrowseMenuCountText("artist", state), "3");
  state.activeArtistPanel = "composer";
  assert.equal(getBrowseMenuCountText("artist", state), "1");
  assert.equal(getBrowseMenuCountText("playlist", state), "3");
  state.playlists.push({});
  assert.equal(getBrowseMenuCountText("playlist", state), "4");
});

test("More counts the active filter, including reopening its menu", () => {
  const state = { ...base(), mode: "genre", total: 28 };
  assert.equal(getBrowseMenuCountText("more", state), "28");
  state.activeMorePanel = "year";
  assert.equal(getBrowseMenuCountText("more", state), "—");
  state.mode = "year";
  assert.equal(getBrowseMenuCountText("more", state), "28");
  state.mode = "radio";
  state.activeMorePanel = null;
  state.total = 15;
  assert.equal(getBrowseMenuCountText("more", state), "15");
});

function fixture(display, failTotal = false) {
  const requests = [];
  const state = { ...base(), songsDisplayMode: display, songsBrowseScope: "all",
    texturePromises: new Map(), entries: [] };
  const context = { state, BROWSE_MODE: { SONGS: "songs" }, SONGS_BROWSE_LOAD_LIMIT: 5000,
    setStatus() {}, updateBrowseMenuCounts() {}, applySongsBrowseSort() {}, updateBrowseSummary() {},
    renderBrowseMenus() {}, clearStatus() {}, saveBrowseState() {}, loadFavourites: async () => {},
    normalizeTrack: t => t, enrichTrackFromAlbum: t => t, buildSongBrowseEntries: t => t,
    fetchAlbums: async () => ({ albums: [{ id: "album" }], total: 20 }),
    fetchFavouriteAlbumEntries: async () => ({ albums: [{ id: "fav-album" }], total: 1 }),
    apiGet: async () => ({ tracks: [{ id: "fav1" }, { id: "fav2" }] }),
    fetchTracksPage: async (offset, limit) => {
      requests.push({ offset, limit });
      if (failTotal) throw new Error("Unavailable");
      return { tracks: [{ id: "song" }], total: 9000 };
    },
  };
  runInNewContext(section("async function loadSongBrowse(", "function loadSmartPlaylists("), context);
  return { context, state, requests };
}

test("grouped full-library songs request the track total rather than counting albums", async () => {
  const { context, state, requests } = fixture("album");
  await context.loadSongBrowse("all");
  assert.equal(state.total, 20);
  assert.equal(state.songBrowseTotal, 9000);
  assert.deepEqual(requests, [{ offset: 0, limit: 1 }]);
});

test("favourite song totals count tracks in both display modes", async () => {
  for (const display of ["album", "song"]) {
    const { context, state } = fixture(display);
    await context.loadSongBrowse("favourite");
    assert.equal(state.songBrowseTotal, 2);
  }
});

test("song view uses the paginated API total rather than the first page size", async () => {
  const { context, state } = fixture("song");
  await context.loadSongBrowse("all");
  assert.equal(state.entries.length, 1);
  assert.equal(state.songBrowseTotal, 9000);
});

test("failed count metadata does not prevent grouped browsing", async () => {
  const { context, state } = fixture("album", true);
  await context.loadSongBrowse("all");
  assert.equal(state.entries.length, 1);
  assert.equal(getBrowseMenuCountText("songs", state), "—");
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildMusicListCsv, collectMusicLists } from "../frontend/assets/music-export.js";

const songA = {
  id: "Album/01 - One.mp3", file: "Album/01 - One.mp3", title: "One", artist: "Artist",
  album: "Album", trackNumber: 1, duration: 75, year: "2003"
};
const songB = {
  id: "Album/02 - Two.flac", file: "Album/02 - Two.flac", title: "Two", artist: "Artist",
  album: "Album", trackNumber: 2, duration: 125
};

test("exports overlapping favourites and playlists as one row per file", async () => {
  const paths = [];
  const responses = {
    "/api/library/favourites": { tracks: [songA.file], albums: ["42"] },
    "/api/library/starred/tracks": { tracks: [songA] },
    "/api/library/album/42/tracks": { tracks: [songA, songB] },
    "/api/library/playlists/p1/tracks": {
      playlist: { trackIds: [songB.file, songA.file, songB.file] },
      tracks: [songA, songB]
    }
  };
  const { records, csv } = await collectMusicLists({
    get: async (path) => { paths.push(path); return responses[path]; },
    favouriteSongs: true, favouriteAlbums: true,
    playlists: [{ id: "p1", name: "My Mix" }]
  });
  assert.equal(records.size, 2);
  assert.equal(paths.length, 4);
  assert.match(csv, /"file_name","file_extension","relative_path"/);
  assert.match(csv, /"01 - One.mp3","mp3","Album\/01 - One.mp3","Yes","Yes"/);
  assert.match(csv, /"02 - Two.flac","flac","Album\/02 - Two.flac","","Yes"/);
  assert.match(csv, /"My Mix: 1, 3"/);
  assert.match(csv, /"My Mix: 2"/);
});

test("escapes commas, quotes, and spreadsheet formulas", () => {
  const records = new Map([["test", {
    track: {
      id: "test", file: "Music/test.mp3", name: "test.mp3", extension: "mp3",
      title: '=HYPERLINK("bad", "click")', artist: "Artist, Name", albumArtist: "",
      album: "Album", year: "", genre: "", composer: "", trackNumber: "",
      duration: 0, format: "MP3", bitrate: ""
    },
    favouriteSong: true, albums: new Set(), playlists: new Map(), sources: new Set(["Favourite song"])
  }]]);
  const csv = buildMusicListCsv(records);
  assert.match(csv, /"'=HYPERLINK\(""bad"", ""click""\)"/);
  assert.match(csv, /"Artist, Name"/);
});

test("does not fetch unselected sources", async () => {
  const paths = [];
  const result = await collectMusicLists({
    get: async (path) => {
      paths.push(path);
      return { playlist: { trackIds: [songA.file] }, tracks: [songA] };
    },
    favouriteSongs: false, favouriteAlbums: false,
    playlists: [{ id: "p1", name: "Only List" }]
  });
  assert.deepEqual(paths, ["/api/library/playlists/p1/tracks"]);
  assert.equal(result.records.size, 1);
});

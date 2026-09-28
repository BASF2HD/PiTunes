import test from "node:test";
import assert from "node:assert/strict";

import {
  albumReleaseIdentity,
  sameAlbumRelease,
} from "../frontend/assets/album-identity.js";

test("same title from different years is a separate album release", () => {
  assert.notEqual(
    albumReleaseIdentity({ album: "Greatest Hits", albumArtist: "Example", year: 1998 }),
    albumReleaseIdentity({ album: "Greatest Hits", albumArtist: "Example", year: 2024 })
  );
  assert.equal(
    sameAlbumRelease(
      { title: "Greatest Hits", albumArtist: "Example", year: 1998 },
      { album: "Greatest Hits", albumArtist: "Example", year: 2024 }
    ),
    false
  );
});

test("equivalent metadata from the same release still groups together", () => {
  assert.equal(
    albumReleaseIdentity({ album: "  Greatest  Hits ", albumArtist: "Example", year: "2024-01-01" }),
    albumReleaseIdentity({ title: "Greatest Hits", albumArtist: "example", year: 2024 })
  );
});

test("different authoritative library album ids never match", () => {
  assert.equal(
    sameAlbumRelease(
      { kind: "album", id: "10", title: "Greatest Hits", year: 2024 },
      { albumId: "11", album: "Greatest Hits", year: 2024 }
    ),
    false
  );
});

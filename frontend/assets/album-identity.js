export function normalizeAlbumIdentityTitle(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function normalizeAlbumIdentityYear(value) {
  const match = String(value || "").match(/(?:19|20)\d{2}/);
  return match ? match[0] : "";
}

function normalizeAlbumIdentityArtist(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function authoritativeAlbumId(item) {
  const value = String(item?.albumId || item?.album_id || (item?.kind === "album" ? item?.id : "") || "").trim();
  return /^\d+$/.test(value) ? value : "";
}

export function albumReleaseIdentity(item, fallback = "") {
  const title = normalizeAlbumIdentityTitle(item?.album || item?.title);
  if (!title) return `fallback:${String(fallback || item?.id || "")}`;
  const year = normalizeAlbumIdentityYear(item?.year);
  const artist = normalizeAlbumIdentityArtist(item?.albumArtist || item?.album_artist);
  return `${title}|year:${year || "unknown"}|artist:${artist || "unknown"}`;
}

export function sameAlbumRelease(left, right) {
  const leftId = authoritativeAlbumId(left);
  const rightId = authoritativeAlbumId(right);
  if (leftId && rightId) return leftId === rightId;

  const leftTitle = normalizeAlbumIdentityTitle(left?.album || left?.title);
  const rightTitle = normalizeAlbumIdentityTitle(right?.album || right?.title);
  if (!leftTitle || !rightTitle || leftTitle !== rightTitle) return false;

  const leftYear = normalizeAlbumIdentityYear(left?.year);
  const rightYear = normalizeAlbumIdentityYear(right?.year);
  if (leftYear && rightYear && leftYear !== rightYear) return false;

  const leftArtist = normalizeAlbumIdentityArtist(left?.albumArtist || left?.album_artist);
  const rightArtist = normalizeAlbumIdentityArtist(right?.albumArtist || right?.album_artist);
  return !leftArtist || !rightArtist || leftArtist === rightArtist;
}

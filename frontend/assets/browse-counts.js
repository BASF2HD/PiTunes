export function getBrowseMenuCountText(menu, state) {
  if (menu === "artist") {
    const options = state.activeArtistPanel === "composer" ? state.composers : state.artists;
    return options.length.toLocaleString();
  }
  if (menu === "playlist") {
    return (state.playlists.length + state.smartPlaylists.length).toLocaleString();
  }
  if (menu === "more") {
    const selectedMode = { year: "year", genre: "genre", radio: "radio" }[state.activeMorePanel];
    const mode = selectedMode || (["year", "genre", "radio", "rating", "starred"].includes(state.mode) ? state.mode : "");
    if (!mode) return "";
    return mode === state.mode ? formatCount(state.total) : "—";
  }
  if (state.mode !== menu) return "—";
  return formatCount(menu === "songs" ? state.songBrowseTotal : state.total);
}

function formatCount(value) {
  return value != null && Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value).toLocaleString() : "—";
}

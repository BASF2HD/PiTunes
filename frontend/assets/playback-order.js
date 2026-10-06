export function normalizeRepeatMode(value) {
  return ["off", "all", "song"].includes(value) ? value : "off";
}

export function nextRepeatMode(value) {
  const modes = ["off", "all", "song"];
  return modes[(modes.indexOf(normalizeRepeatMode(value)) + 1) % modes.length];
}

export function buildPlaybackOrder(length, currentIndex, shuffle, random = Math.random) {
  const order = Array.from({ length }, (_, index) => index);
  if (!shuffle || !length) return order;
  const current = Math.max(0, Math.min(length - 1, currentIndex));
  order.splice(current, 1);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return [current, ...order];
}

export function playbackStep(order, currentIndex, direction, repeatMode, automatic = false) {
  const position = order.indexOf(currentIndex);
  if (position < 0) return null;
  if (automatic && repeatMode === "song") return currentIndex;
  const next = position + (direction < 0 ? -1 : 1);
  if (next >= 0 && next < order.length) return order[next];
  if (repeatMode === "all") return order[(next + order.length) % order.length];
  return null;
}

export function samePlaybackQueue(previous, next) {
  return previous.length === next.length && previous.every((track, index) =>
    (track.file || track.id) === (next[index].file || next[index].id));
}

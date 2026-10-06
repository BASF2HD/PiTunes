import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { normalizeRepeatMode, nextRepeatMode, buildPlaybackOrder, playbackStep, samePlaybackQueue } from "../frontend/assets/playback-order.js";

const source = await readFile(new URL("../frontend/assets/app.js", import.meta.url), "utf8");
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test("repeat cycles through off, all, song and back to off", () => {
  assert.equal(normalizeRepeatMode("invalid"), "off");
  assert.equal(nextRepeatMode("off"), "all");
  assert.equal(nextRepeatMode("all"), "song");
  assert.equal(nextRepeatMode("song"), "off");
});

test("shuffle keeps the current song and visits every track once", () => {
  for (let length = 1; length < 40; length++) {
    for (let current = 0; current < length; current++) {
      const order = buildPlaybackOrder(length, current, true);
      assert.equal(order[0], current);
      assert.equal(new Set(order).size, length);
      assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length }, (_, i) => i));
    }
  }
});

test("repeat all wraps; repeat song repeats automatically but manual Next skips", () => {
  assert.equal(playbackStep([0, 1, 2], 2, 1, "all", true), 0);
  assert.equal(playbackStep([0, 1, 2], 0, -1, "all"), 2);
  assert.equal(playbackStep([0, 1, 2], 1, 1, "song", true), 1);
  assert.equal(playbackStep([0, 1, 2], 1, 1, "song"), 2);
  assert.equal(playbackStep([0, 1, 2], 2, 1, "off", true), null);
  assert.equal(playbackStep([], -1, 1, "all"), null);
});

test("queue identity includes file paths and duplicate order", () => {
  assert.equal(samePlaybackQueue([{ file: "a" }], [{ file: "b" }]), false);
  assert.equal(samePlaybackQueue([{ file: "a" }, { file: "a" }], [{ id: "a" }, { id: "a" }]), true);
});

function fixture(browser = true) {
  const played = [], saved = new Map(), posted = [];
  const context = {
    state: { browserQueue: [{ file: "a" }, { file: "b" }, { file: "c" }], browserQueueIndex: 1,
      browserPlaybackOrder: [0, 1, 2], repeatMode: "off", shuffle: false, playbackModesPending: false, playbackModesRevision: 0 },
    el: { audioPlayer: { currentTime: 0 } },
    normalizeRepeatMode, nextRepeatMode, buildPlaybackOrder, playbackStep, samePlaybackQueue,
    sameTrack: (a, b) => (a.file || a.id) === (b.file || b.id),
    isBrowserPlayback: () => browser, isRadioInputActive: () => false, isRadioPlaybackTrack: () => false,
    isExternalInputActive: () => false, syncBrowserPlayerState() {}, updatePlaybackModeButtons() {}, showError() {},
    window: { localStorage: { setItem: (key, value) => saved.set(key, value) } },
    apiPost: async (url, body) => posted.push({ url, body }),
  };
  runInNewContext(
    section("function fullQueueFromMatch(", "async function buildForwardBrowseQueue(")
    + section("function setBrowserQueue(", "async function playBrowserTrack(")
    + section("async function playBrowserQueueOffset(", "function syncBrowserPlayerState(")
    + section("async function setPlaybackModes(", "function seekFromClientX("), context);
  context.playBrowserTrack = async (track, queue) => { context.setBrowserQueue(track, queue); played.push(track.file); };
  return { context, played, saved, posted };
}

test("starting midway keeps the whole queue in normal order for repeat all", () => {
  const { context } = fixture();
  const queue = context.state.browserQueue;
  assert.equal(context.fullQueueFromMatch(queue, { file: "b" }), queue);
  context.setBrowserQueue({ file: "b" }, queue);
  assert.equal(context.state.browserQueueIndex, 1);
  assert.equal(context.state.browserQueue.length, 3);
});

test("browser automatic repeat song restarts, manual Next advances, repeat off stops", async () => {
  const { context, played } = fixture();
  context.state.repeatMode = "song";
  await context.advanceBrowserQueueIfNeeded();
  await context.playBrowserQueueOffset(1);
  assert.deepEqual(played, ["b", "c"]);
  context.state.repeatMode = "off";
  await context.advanceBrowserQueueIfNeeded();
  assert.deepEqual(played, ["b", "c"]);
  context.state.repeatMode = "all";
  await context.advanceBrowserQueueIfNeeded();
  assert.deepEqual(played, ["b", "c", "a"]);
});

test("shuffle toggling leaves audio playing and restores original order when off", async () => {
  const { context, played, saved, posted } = fixture();
  await context.setPlaybackModes({ shuffle: true });
  assert.equal(context.state.browserPlaybackOrder[0], 1);
  assert.equal(context.state.browserQueueIndex, 1);
  assert.deepEqual(played, []);
  assert.deepEqual(posted, []);
  assert.equal(saved.get("pitunes-browser-shuffle"), "true");
  const order = [...context.state.browserPlaybackOrder];
  context.setBrowserQueue({ file: "b" }, context.state.browserQueue.map((track) => ({ ...track })));
  assert.deepEqual([...context.state.browserPlaybackOrder], order);
  await context.setPlaybackModes({ shuffle: false });
  assert.deepEqual([...context.state.browserPlaybackOrder], [0, 1, 2]);
});

test("MPD options use the API and restore UI state on a failed save", async () => {
  const { context, posted, saved } = fixture(false);
  await context.setPlaybackModes({ repeatMode: "all" });
  assert.equal(posted[0].url, "/api/player/options");
  assert.equal(posted[0].body.repeatMode, "all");
  assert.equal(saved.size, 0);
  context.apiPost = async () => { throw new Error("offline"); };
  await context.setPlaybackModes({ repeatMode: "song", shuffle: true });
  assert.equal(context.state.repeatMode, "all");
  assert.equal(context.state.shuffle, false);
  assert.equal(context.state.playbackModesPending, false);
});

test("radio, external input and pending updates cannot change modes", async () => {
  const { context, posted } = fixture(false);
  context.isRadioPlaybackTrack = () => true;
  await context.setPlaybackModes({ shuffle: true });
  assert.equal(posted.length, 0);
  assert.equal(context.state.shuffle, false);
  context.isRadioPlaybackTrack = () => false;
  context.isExternalInputActive = () => true;
  await context.setPlaybackModes({ shuffle: true });
  assert.equal(posted.length, 0);
  context.isExternalInputActive = () => false;
  context.state.playbackModesPending = true;
  await context.setPlaybackModes({ repeatMode: "all" });
  assert.equal(posted.length, 0);
});

test("a delayed MPD poll cannot undo a newly saved mode", async () => {
  const { context } = fixture(false);
  let finishPoll;
  context.apiGet = () => new Promise((resolve) => { finishPoll = resolve; });
  const modePoll = section("async function refreshPlayer() {", "    // Browser output uses local <audio>");
  runInNewContext(`${modePoll}\n} catch (error) { throw error; } }`, context);
  const poll = context.refreshPlayer();
  await context.setPlaybackModes({ repeatMode: "song", shuffle: true });
  finishPoll({ status: { repeat: false, single: false, random: false } });
  await poll;
  assert.equal(context.state.repeatMode, "song");
  assert.equal(context.state.shuffle, true);
  context.apiGet = async () => ({ status: { repeat: true, single: false, random: false } });
  await context.refreshPlayer();
  assert.equal(context.state.repeatMode, "all", "a fresh poll still adopts the native MPD state");
  assert.equal(context.state.shuffle, false);
});

import ast
import shlex
import sys
import threading
import time
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from playback_modes import mode_commands
from shared import ApiError, mpd_quote


def load_functions(file, names, context):
    tree = ast.parse((ROOT / file).read_text())
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(functions) == len(names)
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(file), "exec"), context)


class FakeMPD:
    def __init__(self):
        self.commands = []
        self.queue = []
        self.playing_file = None
        self.status = {}

    def command(self, command):
        self.commands.append(command)
        parts = shlex.split(command)
        if parts[0] == "clear":
            self.queue.clear()
        elif parts[0] == "add":
            self.queue.append(parts[1])
        elif parts[0] == "addid":
            self.queue.insert(int(parts[2]), parts[1])
        elif parts[0] == "play":
            self.playing_file = self.queue[int(parts[1])]
        return ["OK"]

    def single_map(self, command):
        return self.status if command == "status" else {"file": self.playing_file or "album/song.flac"}


class PlaybackModesTest(unittest.TestCase):
    def test_native_modes(self):
        self.assertEqual(mode_commands({"repeatMode": "off"}), ["repeat 0", "single 0"])
        self.assertEqual(mode_commands({"repeatMode": "all"}), ["repeat 1", "single 0", "consume 0"])
        self.assertEqual(mode_commands({"repeatMode": "song"}), ["repeat 1", "single 1", "consume 0"])
        self.assertEqual(mode_commands({"shuffle": True}), ["random 1"])
        self.assertEqual(mode_commands({"shuffle": False}), ["random 0"])

    def test_invalid_options_are_rejected_before_commands(self):
        for body in ({}, None, {"repeatMode": "once"}, {"shuffle": "false"}, {"shuffle": 1}, {"repeatMode": "all", "shuffle": "bad"}):
            with self.subTest(body=body), self.assertRaises(ApiError) as error:
                mode_commands(body)
            self.assertEqual(error.exception.status, 400)

    def test_endpoint_sends_only_options_and_rejects_radio(self):
        mpd = FakeMPD()
        context = {"mpd": mpd, "mode_commands": mode_commands, "ApiError": ApiError,
                   "_external_transport_action": lambda *args: None,
                   "note_playback_activity": lambda: None, "get_external_input_state": None,
                   "_is_radio_stream_uri": lambda uri: uri.startswith("http"),
                   "compat_player_state": lambda: {"ok": True}}
        load_functions("backend/server.py", {"compat_player_post"}, context)
        self.assertEqual(context["compat_player_post"]("/api/player/options", {"repeatMode": "song", "shuffle": True}), {"ok": True})
        self.assertEqual(mpd.commands, ["command_list_begin\nrepeat 1\nsingle 1\nconsume 0\nrandom 1\ncommand_list_end"])
        mpd.playing_file = "https://radio.example/stream"
        with self.assertRaises(ApiError) as error:
            context["compat_player_post"]("/api/player/options", {"shuffle": False})
        self.assertEqual(error.exception.status, 409)
        self.assertEqual(len(mpd.commands), 1)

    def test_status_exposes_native_modes_to_all_clients(self):
        mpd = FakeMPD()
        mpd.status = {"repeat": "1", "single": "1", "random": "1", "state": "play"}
        context = {"mpd": mpd, "as_track": lambda song: {"file": song["file"]},
                   "get_external_input_state": None, "sync_local_playback_takeover": None,
                   "_is_radio_stream_uri": lambda uri: False, "_with_ui_context": lambda payload: payload}
        load_functions("backend/server.py", {"api_status", "compat_player_state"}, context)
        status = context["compat_player_state"]()["status"]
        self.assertTrue(status["repeat"])
        self.assertTrue(status["single"])
        self.assertTrue(status["random"])

    def queue_fixture(self):
        mpd = FakeMPD()
        workers = []
        context = {"mpd": mpd, "mpd_quote": mpd_quote, "ApiError": ApiError,
                   "_mpd_append_lock": threading.Lock(), "_mpd_append_generation": 0,
                   "note_playback_activity": lambda: None, "log_playback": lambda *args, **kw: None,
                   "set_play_context": lambda **kw: None, "SYNC_QUEUE_HEAD": 0,
                   "lib_ui_context": types.SimpleNamespace(publish_playback=lambda *args, **kw: None),
                   "_file_exists_in_library": lambda uri: True}
        class DeferredThread:
            def __init__(self, target, **kwargs):
                self.target = target
            def start(self):
                workers.append(self.target)
        context["threading"] = types.SimpleNamespace(Thread=DeferredThread)
        load_functions("backend/playback.py", {"_normalize_uri", "_forward_queue_from_target",
            "_cancel_mpd_append_queue", "mpd_add_uri", "_mpd_append_uris_async", "play_queue_fast"}, context)
        return mpd, workers, context

    def test_mid_album_fast_start_retains_full_queue_without_restarting(self):
        mpd, workers, context = self.queue_fixture()
        context["play_queue_fast"](target_uri="c.flac", queue=["a.flac", "b.flac", "c.flac", "d.flac"], album_id="1")
        self.assertEqual(mpd.queue, ["c.flac"])
        self.assertEqual(mpd.playing_file, "c.flac")
        workers[0]()
        self.assertEqual(mpd.queue, ["a.flac", "b.flac", "c.flac", "d.flac"])
        self.assertEqual(mpd.playing_file, "c.flac")
        self.assertEqual(mpd.commands.count("play 0"), 1)

    def test_a_last_track_still_retains_earlier_tracks_for_repeat(self):
        mpd, workers, context = self.queue_fixture()
        context["play_queue_fast"](target_uri="b.wav", queue=["a.wav", "b.wav"], album_id="1")
        workers[0]()
        self.assertEqual(mpd.queue, ["a.wav", "b.wav"])
        self.assertEqual(mpd.playing_file, "b.wav")

    def test_cancelled_queue_cannot_append_to_a_new_selection(self):
        mpd, workers, context = self.queue_fixture()
        context["play_queue_fast"](target_uri="b.flac", queue=["a.flac", "b.flac", "c.flac"], album_id="1")
        context["_cancel_mpd_append_queue"]()
        workers[0]()
        self.assertEqual(mpd.queue, ["b.flac"])

    def test_repeat_and_shuffle_do_not_continue_into_other_albums(self):
        for status in ({"repeat": "1"}, {"random": "1"}):
            mpd = FakeMPD()
            mpd.status = status
            context = {"mpd": mpd, "time": time, "_continue_lock": threading.Lock(),
                       "_play_lock": threading.Lock(), "_last_continue_at": 0,
                       "_play_context": {"continuous": True, "album_id": "1"}}
            load_functions("backend/playback.py", {"maybe_continue_next_album"}, context)
            self.assertFalse(context["maybe_continue_next_album"]())


if __name__ == "__main__":
    unittest.main()

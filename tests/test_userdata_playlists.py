import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from library import userdata


class UserdataPlaylistTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_config_dir = userdata.CONFIG_DIR
        self.original_userdata_file = userdata._USERDATA_FILE
        userdata.CONFIG_DIR = Path(self.temp_dir.name)
        userdata._USERDATA_FILE = userdata.CONFIG_DIR / "userdata.json"

    def tearDown(self):
        userdata.CONFIG_DIR = self.original_config_dir
        userdata._USERDATA_FILE = self.original_userdata_file
        self.temp_dir.cleanup()

    def test_create_playlist_persists_all_tracks_in_one_write(self):
        original_save = userdata._save_unlocked
        with mock.patch.object(userdata, "_save_unlocked", wraps=original_save) as save:
            playlist = userdata.create_playlist(
                "Road Trip",
                ["Album/01.mp3", "Album/02.mp3", "Album/01.mp3", ""],
            )

        self.assertEqual(save.call_count, 1)
        self.assertEqual(playlist["trackIds"], ["Album/01.mp3", "Album/02.mp3"])
        self.assertEqual(userdata.list_playlists(), [playlist])

    def test_create_playlist_keeps_single_track_compatibility(self):
        playlist = userdata.create_playlist("Single", "Album/01.mp3")
        self.assertEqual(playlist["trackIds"], ["Album/01.mp3"])


if __name__ == "__main__":
    unittest.main()

import sqlite3
import unittest

from backend.library.scanner import _get_or_create_album


class AlbumScannerIdentityTest(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute(
            """
            CREATE TABLE albums (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL COLLATE NOCASE,
                artist_id INTEGER,
                album_artist_id INTEGER,
                year INTEGER,
                genre TEXT,
                updated_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )

    def tearDown(self):
        self.conn.close()

    def album(self, title, album_artist_id, year):
        return _get_or_create_album(
            self.conn, title, album_artist_id, album_artist_id, year, "Rock", 1
        )

    def test_album_identity_uses_title_artist_and_year(self):
        original = self.album("Greatest Hits", 1, 1998)
        same_release = self.album("greatest hits", 1, 1998)
        newer_release = self.album("Greatest Hits", 1, 2024)
        different_artist = self.album("Greatest Hits", 2, 1998)

        self.assertEqual(original, same_release)
        self.assertNotEqual(original, newer_release)
        self.assertNotEqual(original, different_artist)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM albums").fetchone()[0], 3)


if __name__ == "__main__":
    unittest.main()

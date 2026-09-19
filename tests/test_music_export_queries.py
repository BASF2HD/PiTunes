import tempfile
import unittest
from pathlib import Path

from backend.library import db, queries


class MusicExportQueriesTest(unittest.TestCase):
    def test_large_favourites_and_composer_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            db._db_path = Path(directory) / "library.db"
            db.init_db()
            conn = db.get_connection()
            conn.execute("INSERT INTO artists(id, name) VALUES (1, 'Artist')")
            conn.execute("INSERT INTO albums(id, title, artist_id, album_artist_id, year, genre) VALUES (1, 'Album', 1, 1, 2003, 'Soundtrack')")
            paths = [f"Album/{number:04d}.mp3" for number in range(1001)]
            conn.executemany(
                """INSERT INTO tracks(album_id, file_path, title, artist, composer, track_number,
                                      duration_sec, mtime, file_size)
                   VALUES (1, ?, ?, 'Singer', 'Composer', ?, 75, 1, 100)""",
                [(path, f"Song {index}", index) for index, path in enumerate(paths)],
            )
            conn.commit()

            favourites = queries.list_starred_tracks(paths)
            self.assertEqual(len(favourites["tracks"]), 1001)
            self.assertEqual(favourites["tracks"][0]["composer"], "Composer")
            self.assertEqual(queries.album_tracks(1)["tracks"][0]["composer"], "Composer")
            conn.close()
            del db._local.conn
            db._db_path = None


if __name__ == "__main__":
    unittest.main()

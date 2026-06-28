import contextlib
import wave
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

from .db import album_count, get_connection, init_db

try:
    from mutagen import File as MutagenFile
except Exception:
    MutagenFile = None

_COMPILATION_ARTIST_NAMES = {"various artists", "various", "unknown artist"}


def _local_audio_path(file_path):
    raw = str(file_path or "").strip()
    if not raw:
        return None
    if raw.startswith("file://"):
        parsed = urlparse(raw)
        raw = unquote(parsed.path or "")
    else:
        raw = unquote(raw)
    path = Path(raw)
    return path if path.is_file() else None


def _probe_audio_duration(file_path):
    path = _local_audio_path(file_path)
    if not path:
        return 0.0
    if MutagenFile is not None:
        try:
            audio = MutagenFile(path)
            duration = float(getattr(getattr(audio, "info", None), "length", 0) or 0)
            if duration > 0:
                return duration
        except Exception:
            pass
    if path.suffix.lower() in {".wav", ".wave"}:
        try:
            with contextlib.closing(wave.open(str(path), "rb")) as audio:
                frame_rate = float(audio.getframerate() or 0)
                if frame_rate > 0:
                    return float(audio.getnframes() or 0) / frame_rate
        except Exception:
            pass
    return 0.0


def _duration_from_row(conn, row):
    duration = float(row["duration_sec"] or 0)
    if duration > 0:
        return duration, False
    duration = _probe_audio_duration(row["file_path"])
    if duration > 0:
        conn.execute(
            "UPDATE tracks SET duration_sec = ? WHERE file_path = ?",
            (duration, row["file_path"]),
        )
        return duration, True
    return 0.0, False


def _track_display_artist(track_artist, album_artist=""):
    track_artist = (track_artist or "").strip()
    if track_artist:
        return track_artist
    album_artist = (album_artist or "").strip()
    if album_artist.casefold() in _COMPILATION_ARTIST_NAMES:
        return ""
    return album_artist


def library_art_revision(conn=None) -> str:
    init_db()
    conn = conn or get_connection()
    setting = conn.execute("SELECT value FROM app_settings WHERE key = 'library_revision'").fetchone()
    if setting and setting["value"]:
        return str(setting["value"])
    row = conn.execute("SELECT COALESCE(MAX(id), 0) AS rev FROM scan_runs").fetchone()
    return str(int(row["rev"] or 0))


def album_art_url(album_id, revision=None, size=128) -> str:
    revision = revision or library_art_revision()
    return f"/api/art?album_id={int(album_id)}&size={int(size)}&rev={quote(str(revision), safe='')}"


def library_ready() -> bool:
    init_db()
    return album_count() > 0


def list_albums(
    offset=0,
    limit=96,
    artist_filter=None,
    composer_filter=None,
    year_filter=None,
    genre_filter=None,
    album_ids=None,
    toprated=False,
    sort="title",
):
    init_db()
    conn = get_connection()
    order = "a.title COLLATE NOCASE"
    if sort == "artist":
        order = "ar.name COLLATE NOCASE, a.title COLLATE NOCASE"
    elif sort == "year-asc":
        order = "a.year ASC, a.title COLLATE NOCASE"
    elif sort in ("year", "year-desc"):
        order = "a.year DESC, a.title COLLATE NOCASE"
    elif sort in ("rating", "highest", "toprated"):
        order = "a.rating DESC, a.title COLLATE NOCASE"

    clauses = []
    params = []
    if artist_filter:
        clauses.append("ar.name = ? COLLATE NOCASE")
        params.append(artist_filter)
    if composer_filter:
        clauses.append(
            """
            a.id IN (
                SELECT DISTINCT album_id FROM tracks
                WHERE composer = ? COLLATE NOCASE
            )
            """
        )
        params.append(composer_filter)
    if year_filter is not None:
        clauses.append("a.year = ?")
        params.append(int(year_filter))
    if genre_filter:
        clauses.append("a.genre = ? COLLATE NOCASE")
        params.append(genre_filter)
    if album_ids:
        placeholders = ",".join("?" for _ in album_ids)
        clauses.append(f"a.id IN ({placeholders})")
        params.extend(album_ids)
    if toprated:
        clauses.append("a.rating > 0")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    total = conn.execute(
        f"SELECT COUNT(*) AS c FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id {where}",
        params,
    ).fetchone()["c"]

    params.extend([limit, offset])
    rows = conn.execute(
        f"""
        SELECT a.id, a.title, a.year, a.genre, a.rating, a.art_path,
               ar.name AS artist_name,
               aa.name AS album_artist_name
        FROM albums a
        LEFT JOIN artists ar ON ar.id = a.artist_id
        LEFT JOIN artists aa ON aa.id = a.album_artist_id
        {where}
        ORDER BY {order}
        LIMIT ? OFFSET ?
        """,
        params,
    ).fetchall()

    albums = []
    art_revision = library_art_revision(conn)
    for row in rows:
        album_id = int(row["id"])
        albums.append(
            {
                "id": str(album_id),
                "title": row["title"],
                "artist": row["artist_name"] or "",
                "albumArtist": row["album_artist_name"] or row["artist_name"] or "",
                "year": str(row["year"] or ""),
                "genre": row["genre"] or "",
                "rating": int(row["rating"] or 0),
                "artUrl": album_art_url(album_id, art_revision),
            }
        )
    return {"albums": albums, "total": int(total), "offset": int(offset), "limit": int(limit)}


def list_all_tracks(offset=0, limit=10000):
    init_db()
    conn = get_connection()
    total = conn.execute("SELECT COUNT(*) AS c FROM tracks").fetchone()["c"]
    rows = conn.execute(
        """
        SELECT t.file_path, t.title, t.artist AS track_artist, t.track_number, t.duration_sec, t.rating,
               a.id AS album_id, a.title AS album_title, a.year, a.genre,
               ar.name AS artist_name, aa.name AS album_artist_name
        FROM tracks t
        JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = a.artist_id
        LEFT JOIN artists aa ON aa.id = a.album_artist_id
        ORDER BY ar.name COLLATE NOCASE, a.title COLLATE NOCASE,
                 t.disc_number, COALESCE(t.track_number, 9999), t.title COLLATE NOCASE
        LIMIT ? OFFSET ?
        """,
        (int(limit), int(offset)),
    ).fetchall()
    tracks = []
    art_revision = library_art_revision(conn)
    repaired_any = False
    for row in rows:
        album_id = int(row["album_id"])
        duration, repaired_duration = _duration_from_row(conn, row)
        repaired_any = repaired_any or repaired_duration
        tracks.append(
            {
                "id": row["file_path"],
                "file": row["file_path"],
                "title": row["title"],
                "trackNumber": row["track_number"],
                "duration": duration,
                "rating": int(row["rating"] or 0),
                "album": row["album_title"],
                "artist": _track_display_artist(row["track_artist"], row["artist_name"]),
                "singer": row["track_artist"] or "",
                "albumArtist": row["album_artist_name"] or row["artist_name"] or "",
                "year": str(row["year"] or ""),
                "genre": row["genre"] or "",
                "artUrl": album_art_url(album_id, art_revision),
                "albumId": str(album_id),
            }
        )
    if repaired_any:
        conn.commit()
    return {"tracks": tracks, "total": int(total), "offset": int(offset), "limit": int(limit)}


def list_starred_tracks(file_paths):
    init_db()
    if not file_paths:
        return {"tracks": []}
    conn = get_connection()
    placeholders = ",".join("?" for _ in file_paths)
    rows = conn.execute(
        f"""
        SELECT t.file_path, t.title, t.artist AS track_artist, t.track_number, t.duration_sec, t.rating,
               a.id AS album_id, a.title AS album_title, a.year, a.genre,
               ar.name AS artist_name, aa.name AS album_artist_name
        FROM tracks t
        JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = a.artist_id
        LEFT JOIN artists aa ON aa.id = a.album_artist_id
        WHERE t.file_path IN ({placeholders})
        ORDER BY t.title COLLATE NOCASE
        """,
        list(file_paths),
    ).fetchall()
    tracks = []
    art_revision = library_art_revision(conn)
    repaired_any = False
    for row in rows:
        album_id = int(row["album_id"])
        duration, repaired_duration = _duration_from_row(conn, row)
        repaired_any = repaired_any or repaired_duration
        tracks.append(
            {
                "id": row["file_path"],
                "file": row["file_path"],
                "title": row["title"],
                "trackNumber": row["track_number"],
                "duration": duration,
                "rating": int(row["rating"] or 0),
                "album": row["album_title"],
                "artist": _track_display_artist(row["track_artist"], row["artist_name"]),
                "singer": row["track_artist"] or "",
                "albumArtist": row["album_artist_name"] or row["artist_name"] or "",
                "year": str(row["year"] or ""),
                "genre": row["genre"] or "",
                "artUrl": album_art_url(album_id, art_revision),
                "albumId": str(album_id),
                "starred": True,
            }
        )
    if repaired_any:
        conn.commit()
    return {"tracks": tracks}


def album_by_id(album_id):
    init_db()
    conn = get_connection()
    row = conn.execute(
        """
        SELECT a.id, a.title, a.year, a.genre, a.art_path,
               ar.name AS artist_name, aa.name AS album_artist_name
        FROM albums a
        LEFT JOIN artists ar ON ar.id = a.artist_id
        LEFT JOIN artists aa ON aa.id = a.album_artist_id
        WHERE a.id = ?
        """,
        (album_id,),
    ).fetchone()
    if not row:
        return None
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "artist": row["artist_name"] or "",
        "albumArtist": row["album_artist_name"] or "",
        "year": str(row["year"] or ""),
        "artUrl": album_art_url(int(row["id"]), library_art_revision(conn)),
    }


def album_by_title(title):
    init_db()
    conn = get_connection()
    row = conn.execute(
        "SELECT id FROM albums WHERE title = ? COLLATE NOCASE ORDER BY id LIMIT 1",
        (title,),
    ).fetchone()
    if not row:
        return None
    return album_by_id(int(row["id"]))


def album_tracks(album_id):
    init_db()
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT t.file_path, t.title, t.artist, t.track_number, t.duration_sec,
               a.title AS album_title, a.year, a.genre, aa.name AS album_artist_name
        FROM tracks t
        JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists aa ON aa.id = a.album_artist_id
        WHERE t.album_id = ?
        ORDER BY t.disc_number, COALESCE(t.track_number, 9999), t.title COLLATE NOCASE
        """,
        (album_id,),
    ).fetchall()
    repaired_any = False
    tracks = []
    for row in rows:
        duration, repaired_duration = _duration_from_row(conn, row)
        repaired_any = repaired_any or repaired_duration
        tracks.append(
            {
                "id": row["file_path"],
                "file": row["file_path"],
                "trackNumber": row["track_number"],
                "title": row["title"],
                "artist": row["artist"] or "",
                "singer": row["artist"] or "",
                "album": row["album_title"] or "",
                "albumArtist": row["album_artist_name"] or "",
                "year": str(row["year"] or ""),
                "genre": row["genre"] or "",
                "duration": duration,
            }
        )
    if repaired_any:
        conn.commit()
    return {"tracks": tracks}


def list_artists():
    init_db()
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT ar.name, COUNT(DISTINCT a.id) AS album_count
        FROM artists ar
        JOIN albums a ON a.artist_id = ar.id
        GROUP BY ar.id
        ORDER BY ar.name COLLATE NOCASE
        """
    ).fetchall()
    return {"artists": [{"name": row["name"], "album_count": int(row["album_count"])} for row in rows]}


def list_genres():
    init_db()
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT genre AS name, COUNT(*) AS album_count
        FROM albums WHERE genre != ''
        GROUP BY genre
        ORDER BY name COLLATE NOCASE
        """
    ).fetchall()
    return {"genres": [{"name": row["name"], "album_count": int(row["album_count"])} for row in rows]}


def list_years():
    init_db()
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT year, COUNT(*) AS album_count
        FROM albums WHERE year IS NOT NULL
        GROUP BY year
        ORDER BY year DESC
        """
    ).fetchall()
    return {"years": [{"year": int(row["year"]), "album_count": int(row["album_count"])} for row in rows]}


def list_composers():
    init_db()
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT composer AS name, COUNT(DISTINCT album_id) AS album_count
        FROM tracks
        WHERE composer != ''
        GROUP BY composer COLLATE NOCASE
        ORDER BY composer COLLATE NOCASE
        """
    ).fetchall()
    return {"composers": [{"name": row["name"], "album_count": int(row["album_count"])} for row in rows]}


def _fts_pattern(query):
    return (query or "").strip().replace('"', '""')


def _track_row_to_entry(row):
    album_id = int(row["album_id"])
    return {
        "id": row["file_path"],
        "file": row["file_path"],
        "title": row["title"],
        "trackNumber": row["track_number"],
        "duration": float(row["duration_sec"] or 0),
        "rating": int(row["rating"] or 0),
        "album": row["album_title"],
        "artist": _track_display_artist(row["track_artist"], row["artist_name"]),
        "singer": row["track_artist"] or "",
        "albumArtist": row["album_artist_name"] or row["artist_name"] or "",
        "year": str(row["year"] or ""),
        "genre": row["genre"] or "",
        "artUrl": album_art_url(album_id),
        "albumId": str(album_id),
    }


def search_albums(query, limit=120):
    init_db()
    conn = get_connection()
    q = (query or "").strip()
    if not q:
        return list_albums(0, limit)

    pattern = _fts_pattern(q)
    rows = conn.execute(
        """
        SELECT DISTINCT album_id FROM search_fts
        WHERE search_fts MATCH ?
        LIMIT ?
        """,
        (pattern, limit),
    ).fetchall()

    if not rows:
        like = f"%{q}%"
        rows = conn.execute(
            """
            SELECT a.id AS album_id FROM albums a
            LEFT JOIN artists ar ON ar.id = a.artist_id
            WHERE a.title LIKE ? OR ar.name LIKE ?
            LIMIT ?
            """,
            (like, like, limit),
        ).fetchall()

    albums = []
    for row in rows:
        item = album_by_id(int(row["album_id"]))
        if item:
            albums.append(item)
    return {"albums": albums, "total": len(albums)}


def search_tracks(query, limit=120):
    init_db()
    conn = get_connection()
    q = (query or "").strip()
    if not q:
        return {"tracks": [], "total": 0}

    pattern = _fts_pattern(q)
    rows = conn.execute(
        """
        SELECT DISTINCT t.file_path, t.title, t.artist AS track_artist, t.track_number, t.duration_sec, t.rating,
               a.id AS album_id, a.title AS album_title, a.year, a.genre,
               ar.name AS artist_name, aa.name AS album_artist_name
        FROM search_fts
        JOIN tracks t ON t.album_id = search_fts.album_id AND t.title = search_fts.track_title
        JOIN albums a ON a.id = t.album_id
        LEFT JOIN artists ar ON ar.id = a.artist_id
        LEFT JOIN artists aa ON aa.id = a.album_artist_id
        WHERE search_fts MATCH ?
        ORDER BY ar.name COLLATE NOCASE, a.title COLLATE NOCASE,
                 t.disc_number, COALESCE(t.track_number, 9999), t.title COLLATE NOCASE
        LIMIT ?
        """,
        (pattern, limit),
    ).fetchall()

    if not rows:
        like = f"%{q}%"
        rows = conn.execute(
            """
            SELECT t.file_path, t.title, t.artist AS track_artist, t.track_number, t.duration_sec, t.rating,
                   a.id AS album_id, a.title AS album_title, a.year, a.genre,
                   ar.name AS artist_name, aa.name AS album_artist_name
            FROM tracks t
            JOIN albums a ON a.id = t.album_id
            LEFT JOIN artists ar ON ar.id = a.artist_id
            LEFT JOIN artists aa ON aa.id = a.album_artist_id
            WHERE t.title LIKE ? OR t.artist LIKE ? OR a.title LIKE ? OR ar.name LIKE ?
            ORDER BY ar.name COLLATE NOCASE, a.title COLLATE NOCASE,
                     t.disc_number, COALESCE(t.track_number, 9999), t.title COLLATE NOCASE
            LIMIT ?
            """,
            (like, like, like, like, limit),
        ).fetchall()

    tracks = [_track_row_to_entry(row) for row in rows]
    return {"tracks": tracks, "total": len(tracks)}


def search_all(query, limit=120):
    q = (query or "").strip()
    if not q:
        albums = list_albums(0, limit)
        return {"albums": albums.get("albums", []), "tracks": [], "total": albums.get("total", 0)}
    album_limit = max(40, limit // 2)
    track_limit = max(40, limit - album_limit)
    album_result = search_albums(q, album_limit)
    track_result = search_tracks(q, track_limit)
    albums = album_result.get("albums", [])
    tracks = track_result.get("tracks", [])
    return {"albums": albums, "tracks": tracks, "total": len(albums) + len(tracks)}


def album_art_source(album_id):
    init_db()
    conn = get_connection()
    row = conn.execute("SELECT art_path FROM albums WHERE id = ?", (album_id,)).fetchone()
    if row and row["art_path"]:
        return row["art_path"]
    track = conn.execute(
        "SELECT file_path FROM tracks WHERE album_id = ? ORDER BY track_number, id LIMIT 1",
        (album_id,),
    ).fetchone()
    return track["file_path"] if track else None


def album_first_track_path(album_id):
    init_db()
    track = get_connection().execute(
        "SELECT file_path FROM tracks WHERE album_id = ? ORDER BY track_number, id LIMIT 1",
        (album_id,),
    ).fetchone()
    return track["file_path"] if track else None


def legacy_album_art_title(album_id):
    """Resolve numeric id to title for legacy /api/art?album= URLs."""
    init_db()
    row = get_connection().execute("SELECT title FROM albums WHERE id = ?", (album_id,)).fetchone()
    return row["title"] if row else None

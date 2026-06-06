from urllib.parse import quote

from .db import album_count, get_connection, init_db


def library_ready() -> bool:
    init_db()
    return album_count() > 0


def list_albums(offset=0, limit=96, artist_filter=None, sort="title"):
    init_db()
    conn = get_connection()
    order = "a.title COLLATE NOCASE"
    if sort == "artist":
        order = "ar.name COLLATE NOCASE, a.title COLLATE NOCASE"
    elif sort == "year":
        order = "a.year DESC, a.title COLLATE NOCASE"

    params = []
    where = ""
    if artist_filter:
        where = "WHERE ar.name = ? COLLATE NOCASE"
        params.append(artist_filter)

    total = conn.execute(
        f"SELECT COUNT(*) AS c FROM albums a LEFT JOIN artists ar ON ar.id = a.artist_id {where}",
        params,
    ).fetchone()["c"]

    params.extend([limit, offset])
    rows = conn.execute(
        f"""
        SELECT a.id, a.title, a.year, a.genre, a.art_path,
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
                "artUrl": f"/api/art?album_id={album_id}&size=128",
            }
        )
    return {"albums": albums, "total": int(total), "offset": int(offset), "limit": int(limit)}


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
        "artUrl": f"/api/art?album_id={int(row['id'])}&size=128",
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
        SELECT file_path, title, track_number, duration_sec
        FROM tracks WHERE album_id = ?
        ORDER BY disc_number, COALESCE(track_number, 9999), title COLLATE NOCASE
        """,
        (album_id,),
    ).fetchall()
    return {
        "tracks": [
            {
                "id": row["file_path"],
                "file": row["file_path"],
                "trackNumber": row["track_number"],
                "title": row["title"],
                "duration": float(row["duration_sec"] or 0),
            }
            for row in rows
        ]
    }


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


def search_albums(query, limit=120):
    init_db()
    conn = get_connection()
    q = (query or "").strip()
    if not q:
        return list_albums(0, limit)

    pattern = q.replace('"', '""')
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

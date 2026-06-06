from __future__ import annotations

import base64
from pathlib import Path

try:
    from mutagen import File as MutagenFile
    from mutagen.flac import Picture
except Exception:
    MutagenFile = None
    Picture = None

AUDIO_SUFFIXES = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".wma", ".ape", ".mpc"}


def is_audio_file(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_SUFFIXES


def resolve_album_art_file(track_path: Path, music_root: Path, prefer_folder: bool = True) -> Path | None:
    return None


def embedded_art_bytes(path: Path) -> tuple[bytes, str] | None:
    mp4_art = embedded_mp4_art_bytes(path)
    if mp4_art:
        return mp4_art
    flac_art = embedded_flac_art_bytes(path)
    if flac_art:
        return flac_art
    id3_art = embedded_id3_art_bytes(path)
    if id3_art:
        return id3_art
    if MutagenFile is None:
        return None
    try:
        audio = MutagenFile(path)
    except Exception:
        return None
    if audio is None:
        return None

    pictures = getattr(audio, "pictures", None) or []
    for picture in pictures:
        data = getattr(picture, "data", None)
        if data:
            return bytes(data), getattr(picture, "mime", "") or "image/jpeg"

    tags = getattr(audio, "tags", None) or {}

    values = []
    try:
        values.extend(tags.values())
    except Exception:
        pass

    for frame in values:
        data = getattr(frame, "data", None)
        mime = getattr(frame, "mime", "") or "image/jpeg"
        frame_id = getattr(frame, "FrameID", "")
        if data and (frame_id == "APIC" or str(mime).startswith("image/")):
            return bytes(data), mime

    covr = tags.get("covr") if hasattr(tags, "get") else None
    if covr:
        cover = covr[0] if isinstance(covr, list) else covr
        return bytes(cover), "image/jpeg"

    blocks = tags.get("metadata_block_picture") if hasattr(tags, "get") else None
    if blocks and Picture is not None:
        block = blocks[0] if isinstance(blocks, list) else blocks
        try:
            picture = Picture(base64.b64decode(block))
            if picture.data:
                return bytes(picture.data), picture.mime or "image/jpeg"
        except Exception:
            pass

    return None


def embedded_mp4_art_bytes(path: Path) -> tuple[bytes, str] | None:
    if path.suffix.lower() not in {".m4a", ".mp4", ".aac", ".alac"}:
        return None
    try:
        file_size = path.stat().st_size
        with path.open("rb") as fh:
            while fh.tell() + 8 <= file_size:
                atom_start = fh.tell()
                header = fh.read(8)
                atom_size = int.from_bytes(header[:4], "big")
                atom_type = header[4:8]
                header_size = 8
                if atom_size == 1:
                    extended = fh.read(8)
                    if len(extended) != 8:
                        return None
                    atom_size = int.from_bytes(extended, "big")
                    header_size = 16
                elif atom_size == 0:
                    atom_size = file_size - atom_start
                if atom_size < header_size:
                    return None
                payload_size = atom_size - header_size
                if atom_type == b"moov":
                    return _image_from_mp4_atoms(fh.read(payload_size))
                fh.seek(payload_size, 1)
    except OSError:
        return None
    return None


def _image_from_mp4_atoms(data: bytes, start: int = 0, end: int | None = None) -> tuple[bytes, str] | None:
    pos = start
    limit = len(data) if end is None else min(end, len(data))
    while pos + 8 <= limit:
        atom_size = int.from_bytes(data[pos:pos + 4], "big")
        atom_type = data[pos + 4:pos + 8]
        header_size = 8
        if atom_size == 1 and pos + 16 <= limit:
            atom_size = int.from_bytes(data[pos + 8:pos + 16], "big")
            header_size = 16
        elif atom_size == 0:
            atom_size = limit - pos
        if atom_size < header_size or pos + atom_size > limit:
            break
        body_start = pos + header_size
        body_end = pos + atom_size
        if atom_type == b"covr":
            image = _image_from_mp4_cover_atom(data[body_start:body_end])
            if image:
                return image
        elif atom_type in {b"moov", b"udta", b"ilst"}:
            image = _image_from_mp4_atoms(data, body_start, body_end)
            if image:
                return image
        elif atom_type == b"meta":
            image = _image_from_mp4_atoms(data, min(body_start + 4, body_end), body_end)
            if image:
                return image
        pos += atom_size
    return None


def _image_from_mp4_cover_atom(data: bytes) -> tuple[bytes, str] | None:
    pos = 0
    while pos + 16 <= len(data):
        atom_size = int.from_bytes(data[pos:pos + 4], "big")
        atom_type = data[pos + 4:pos + 8]
        if atom_size < 16 or pos + atom_size > len(data):
            break
        if atom_type == b"data":
            data_type = int.from_bytes(data[pos + 8:pos + 12], "big") & 0xFFFFFF
            image = data[pos + 16:pos + atom_size]
            if image:
                mime = "image/png" if data_type == 14 else "image/jpeg"
                detected = _image_from_raw_bytes(image)
                return detected or (bytes(image), mime)
        pos += atom_size
    return None


def embedded_flac_art_bytes(path: Path) -> tuple[bytes, str] | None:
    try:
        with path.open("rb") as fh:
            if fh.read(4) != b"fLaC":
                return None
            while True:
                header = fh.read(4)
                if len(header) != 4:
                    return None
                block_type = header[0] & 0x7F
                is_last = bool(header[0] & 0x80)
                block_size = int.from_bytes(header[1:4], "big")
                block = fh.read(block_size)
                if len(block) != block_size:
                    return None
                if block_type == 6:
                    image = _image_from_flac_picture_block(block)
                    if image:
                        return image
                if is_last:
                    return None
    except OSError:
        return None


def _image_from_flac_picture_block(block: bytes) -> tuple[bytes, str] | None:
    try:
        offset = 4
        mime_len = int.from_bytes(block[offset:offset + 4], "big")
        offset += 4
        mime = block[offset:offset + mime_len].decode("ascii", "replace") or "image/jpeg"
        offset += mime_len
        description_len = int.from_bytes(block[offset:offset + 4], "big")
        offset += 4 + description_len
        offset += 16
        data_len = int.from_bytes(block[offset:offset + 4], "big")
        offset += 4
        data = block[offset:offset + data_len]
    except Exception:
        return None
    if data:
        return bytes(data), mime
    return None


def embedded_id3_art_bytes(path: Path) -> tuple[bytes, str] | None:
    try:
        with path.open("rb") as fh:
            header = fh.read(10)
            if len(header) != 10:
                return None
            if header[:3] == b"ID3":
                return _image_from_id3_payload(header[3], fh.read(_syncsafe_to_int(header[6:10])))
            if header[:4] == b"RIFF" and header[8:10] == b"WA":
                return _embedded_id3_art_from_riff(fh)
    except OSError:
        return None
    return None


def _embedded_id3_art_from_riff(fh) -> tuple[bytes, str] | None:
    try:
        fh.seek(12)
        while True:
            header = fh.read(8)
            if len(header) != 8:
                return None
            chunk_id = header[:4]
            chunk_size = int.from_bytes(header[4:8], "little")
            if chunk_id.rstrip() == b"ID3":
                tag_header = fh.read(10)
                if len(tag_header) != 10 or tag_header[:3] != b"ID3":
                    return None
                size = _syncsafe_to_int(tag_header[6:10])
                return _image_from_id3_payload(tag_header[3], fh.read(size))
            fh.seek(chunk_size + (chunk_size % 2), 1)
    except OSError:
        return None


def _image_from_id3_payload(version: int, tag: bytes) -> tuple[bytes, str] | None:
    offset = 0
    while offset + 10 <= len(tag):
        frame_id = tag[offset:offset + 4]
        if not frame_id.strip(b"\x00"):
            break
        raw_size = tag[offset + 4:offset + 8]
        frame_size = _syncsafe_to_int(raw_size) if version == 4 else int.from_bytes(raw_size, "big")
        frame = tag[offset + 10:offset + 10 + frame_size]
        if frame_id == b"APIC":
            image = _image_from_apic_frame(frame)
            if image:
                return image
        offset += 10 + max(frame_size, 0)
    return None


def _syncsafe_to_int(data: bytes) -> int:
    value = 0
    for byte in data:
        value = (value << 7) | (byte & 0x7F)
    return value


def _image_from_apic_frame(frame: bytes) -> tuple[bytes, str] | None:
    return _image_from_raw_bytes(frame)


def _image_from_raw_bytes(frame: bytes) -> tuple[bytes, str] | None:
    signatures = [
        (b"\xff\xd8\xff", "image/jpeg"),
        (b"\x89PNG\r\n\x1a\n", "image/png"),
        (b"GIF87a", "image/gif"),
        (b"GIF89a", "image/gif"),
        (b"RIFF", "image/webp"),
    ]
    for signature, mime in signatures:
        index = frame.find(signature)
        if index >= 0:
            return frame[index:], mime
    return None

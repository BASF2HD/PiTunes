from pathlib import Path
from typing import Optional

IMAGE_NAMES = (
    "folder.jpg",
    "folder.jpeg",
    "cover.jpg",
    "cover.jpeg",
    "album.jpg",
    "album.jpeg",
    "front.jpg",
    "front.jpeg",
    "folder.png",
    "cover.png",
    "album.png",
    "front.png",
)

AUDIO_SUFFIXES = {".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".wav", ".wma", ".ape", ".mpc"}


def is_audio_file(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_SUFFIXES


def find_folder_art(directory: Path) -> Optional[Path]:
    if not directory.is_dir():
        return None
    for name in IMAGE_NAMES:
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def resolve_album_art_file(track_path: Path, music_root: Path, prefer_folder: bool = True) -> Path | None:
    directory = track_path.parent
    folder_art = find_folder_art(directory)
    if prefer_folder and folder_art:
        return folder_art
    if not prefer_folder and folder_art:
        return folder_art
    return folder_art

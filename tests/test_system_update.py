#!/usr/bin/env python3
import json
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SYSTEM_PATH = Path(__file__).resolve().parents[1] / "backend" / "library" / "system.py"
SPEC = importlib.util.spec_from_file_location("pitunes_system", SYSTEM_PATH)
assert SPEC and SPEC.loader
system = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(system)


class SystemUpdateTests(unittest.TestCase):
    def test_version_comparison(self):
        self.assertTrue(system._version_is_newer("1.2.1", "1.2.0"))
        self.assertTrue(system._version_is_newer("2.0.0", "1.99.99"))
        self.assertFalse(system._version_is_newer("1.2.0", "1.2.0"))
        self.assertFalse(system._version_is_newer("main", "1.2.0"))

    def test_latest_stable_release_resolves_to_commit(self):
        responses = [
            {"tag_name": "v1.3.0", "draft": False, "prerelease": False},
            {"sha": "a" * 40},
        ]
        with patch.object(system, "_github_json", side_effect=responses):
            self.assertEqual(
                system._remote_release(),
                {"tag": "v1.3.0", "version": "1.3.0", "sha": "a" * 40, "updateType": "app"},
            )

    def test_prerelease_is_not_offered_on_stable_channel(self):
        with patch.object(
            system,
            "_github_json",
            return_value={"tag_name": "v1.3.0-rc1", "draft": False, "prerelease": True},
        ):
            self.assertEqual(system._remote_release(), {})

    def test_installed_commit_file_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "config").mkdir()
            (base / "config" / "version.json").write_text(
                json.dumps({"version": "1.2.0", "channel": "stable"}),
                encoding="utf-8",
            )
            (base / "config" / ".install-commit").write_text("b" * 40, encoding="utf-8")
            self.assertEqual(system.pitunes_version_info(base)["commit"], "bbbbbbb")

    def test_signed_system_release_descriptor_selects_system_update(self):
        release = {
            "assets": [
                {
                    "name": "pitunes-release.json",
                    "browser_download_url": "https://example.invalid/pitunes-release.json",
                }
            ]
        }
        descriptor = {
            "schemaVersion": 1,
            "product": "PiTunes",
            "version": "1.4.0",
            "updateType": "system",
        }
        with patch.object(system, "_url_json", return_value=descriptor):
            self.assertEqual(system._release_update_type(release, "1.4.0"), "system")

    def test_invalid_release_descriptor_does_not_fall_back_to_app_update(self):
        release = {
            "assets": [
                {
                    "name": "pitunes-release.json",
                    "browser_download_url": "https://example.invalid/pitunes-release.json",
                }
            ]
        }
        with patch.object(system, "_url_json", return_value={"updateType": "system"}):
            self.assertEqual(system._release_update_type(release, "1.4.0"), "invalid")

    def test_system_release_requires_new_image_on_legacy_install(self):
        release = {
            "sha": "c" * 40,
            "tag": "v1.4.0",
            "version": "1.4.0",
            "updateType": "system",
        }
        with (
            patch.object(system, "_full_sha", return_value="b" * 40),
            patch.object(system, "_load_version_file", return_value={"version": "1.3.0"}),
            patch.object(system, "_update_supported", return_value=True),
            patch.object(system, "_system_update_supported", return_value=False),
            patch.object(system, "_remote_release", return_value=release),
        ):
            status = system.check_update(Path("/opt/pitunes"))
        self.assertFalse(status["available"])
        self.assertTrue(status["requiresImage"])
        self.assertEqual(status["updateType"], "system")

    def test_system_release_is_available_only_on_ab_capable_install(self):
        release = {
            "sha": "c" * 40,
            "tag": "v1.4.0",
            "version": "1.4.0",
            "updateType": "system",
        }
        with (
            patch.object(system, "_full_sha", return_value="b" * 40),
            patch.object(system, "_load_version_file", return_value={"version": "1.3.0"}),
            patch.object(system, "_update_supported", return_value=True),
            patch.object(system, "_system_update_supported", return_value=True),
            patch.object(system, "_remote_release", return_value=release),
        ):
            status = system.check_update(Path("/opt/pitunes"))
        self.assertTrue(status["available"])
        self.assertFalse(status["requiresImage"])
        self.assertEqual(status["updateType"], "system")


if __name__ == "__main__":
    unittest.main()

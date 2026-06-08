#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-auto}"
HAT_OVERLAY="${HAT_OVERLAY:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root: sudo ./configure-mpd.sh [auto|usb-dac|dac-hat|hdmi|headphones]"
  exit 1
fi

install -d -m 0775 -o mpd -g audio /mnt/music
install -d -m 0755 /var/lib/mpd/playlists
install -d -m 0755 /var/log/mpd
touch /var/log/mpd/mpd.log
chown -R mpd:audio /var/lib/mpd /var/log/mpd /mnt/music

cat >/etc/mpd.conf <<'EOF'
music_directory         "/mnt/music"
playlist_directory      "/var/lib/mpd/playlists"
db_file                 "/var/lib/mpd/tag_cache"
log_file                "/var/log/mpd/mpd.log"
pid_file                "/run/mpd/pid"
state_file              "/var/lib/mpd/state"
sticker_file            "/var/lib/mpd/sticker.sql"

user                    "mpd"
bind_to_address         "127.0.0.1"
port                    "6600"
auto_update             "yes"
restore_paused          "yes"
filesystem_charset      "UTF-8"
metadata_to_use         "artist,album,title,track,name,genre,date,albumartist,disc"
follow_outside_symlinks "yes"
follow_inside_symlinks  "yes"
zeroconf_enabled        "yes"
zeroconf_name           "PiTunes MPD"

audio_output {
        type            "alsa"
        name            "ALSA default"
        mixer_type      "software"
}

audio_buffer_size       "2048"
buffer_before_play      "10%"
max_playlist_length     "16384"
max_connections         "20"
EOF

case "${MODE}" in
  auto)
    rm -f /etc/asound.conf
    ;;
  usb-dac)
    cat >/etc/asound.conf <<'EOF'
defaults.pcm.card 1
defaults.ctl.card 1
EOF
    ;;
  dac-hat)
    cat >/etc/asound.conf <<'EOF'
defaults.pcm.card 0
defaults.ctl.card 0
EOF
    if [ -n "${HAT_OVERLAY}" ]; then
      BOOT_CONFIG="/boot/firmware/config.txt"
      [ -f /boot/config.txt ] && BOOT_CONFIG="/boot/config.txt"
      if ! grep -q "^dtoverlay=${HAT_OVERLAY}$" "${BOOT_CONFIG}"; then
        printf '\n# PiTunes DAC HAT\ndtoverlay=%s\n' "${HAT_OVERLAY}" >>"${BOOT_CONFIG}"
      fi
    fi
    ;;
  hdmi)
    rm -f /etc/asound.conf
    if command -v raspi-config >/dev/null 2>&1; then
      raspi-config nonint do_audio 2 || true
    fi
    ;;
  headphones)
    rm -f /etc/asound.conf
    if command -v raspi-config >/dev/null 2>&1; then
      raspi-config nonint do_audio 1 || true
    fi
    ;;
  *)
    echo "Unknown audio mode: ${MODE}"
    exit 1
    ;;
esac

systemctl restart mpd 2>/dev/null || true
echo "MPD configured for ${MODE} output and /mnt/music library."

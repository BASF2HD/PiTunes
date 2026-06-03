# Image Creation Guide

This guide creates a reusable Raspberry Pi flashable `.img` file from a configured SD card.

Do not call the output an ISO. Raspberry Pi boards boot from flashable disk images, usually `.img` or compressed `.img.xz` files.

## 1. Prepare the Source SD Card

Flash Raspberry Pi OS Lite 32-bit, boot it on the target Pi, then install this project:

```bash
cd EchoFlow
sudo ./install.sh
```

Test the player before imaging:

```bash
systemctl status mpd echoflow-api nginx
mpc status
curl http://127.0.0.1/api/health
```

Open:

```text
http://echoflow.local
```

## 2. Configure Hardware

For USB DAC:

```bash
sudo /opt/echoflow/configure-mpd.sh usb-dac
```

For DAC HAT:

```bash
sudo HAT_OVERLAY=hifiberry-dac /opt/echoflow/configure-mpd.sh dac-hat
```

For HDMI:

```bash
sudo /opt/echoflow/configure-mpd.sh hdmi
```

For headphone jack:

```bash
sudo /opt/echoflow/configure-mpd.sh headphones
```

## 3. Clean Before Imaging

Run on the Pi:

```bash
sudo systemctl stop echoflow-api nginx mpd
sudo apt-get clean
sudo rm -rf /var/cache/apt/archives/*
sudo rm -rf /var/cache/echoflow/art/*
sudo rm -f /var/lib/mpd/tag_cache
sudo truncate -s 0 /var/log/mpd/mpd.log 2>/dev/null || true
sudo journalctl --rotate
sudo journalctl --vacuum-time=1s
history -c
sudo shutdown now
```

If you want a generic image, remove saved Wi-Fi credentials before shutting down.

## 4. Create the `.img` File

Move the SD card to a Linux machine. Identify the card:

```bash
lsblk
```

Use the whole device, such as `/dev/sdb`, not a partition like `/dev/sdb1`.

From this project folder on the Linux machine:

```bash
sudo ./scripts/create-image.sh /dev/sdX echoflow.img
```

The script asks you to type `IMAGE` before it reads the card.

Manual equivalent:

```bash
sudo dd if=/dev/sdX of=echoflow.img bs=4M status=progress conv=fsync
sync
xz -T0 -9 -k echoflow.img
```

## 5. Optional Shrink

If PiShrink is installed on your Linux machine:

```bash
sudo pishrink.sh echoflow.img
xz -T0 -9 -k echoflow.img
```

PiShrink is optional but useful because raw SD card images are the size of the full card.

## 6. Flash the Image

Use Raspberry Pi Imager, Balena Etcher, or `dd` to flash:

```bash
xz -dk echoflow.img.xz
sudo dd if=echoflow.img of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

Boot the new card and open:

```text
http://echoflow.local
```

## Rebuild Workflow

1. Flash a fresh Raspberry Pi OS Lite 32-bit card.
2. Copy this project onto it.
3. Run `sudo ./install.sh`.
4. Apply audio and Wi-Fi settings.
5. Test.
6. Clean.
7. Create a new `.img`.

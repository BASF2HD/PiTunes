# Troubleshooting

## Appliance validation

Run this on the Raspberry Pi before publishing or approving an image:

```bash
sudo /opt/pitunes/scripts/appliance-self-test.sh
```

It verifies the local API, NetworkManager recovery supervisor, SSH, Bluetooth
receiver/discoverability, AirPlay advertisement, and local display services.

## Check Service Health

```bash
sudo systemctl status mpd pitunes-api nginx
sudo journalctl -u pitunes-api -n 100
sudo journalctl -u mpd -n 100
mpc status
```

## Web UI Does Not Load

Check nginx:

```bash
sudo nginx -t
sudo systemctl restart nginx
sudo journalctl -u nginx -n 100
```

Open the Pi by IP address if mDNS is unavailable:

```bash
hostname -I
```

Then browse to `http://PI_IP_ADDRESS`.

If `pitunes.local` does not resolve, check Avahi:

```bash
sudo systemctl status avahi-daemon
```

If the Pi was previously named `raspberrypi`, rename it:

```bash
sudo hostnamectl set-hostname pitunes
sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tpitunes/' /etc/hosts
sudo systemctl restart avahi-daemon nginx
```

## API Errors

Check that MPD is reachable:

```bash
mpc -h 127.0.0.1 status
curl http://127.0.0.1/api/health
curl http://127.0.0.1/api/status
```

Restart services:

```bash
sudo systemctl restart mpd pitunes-api nginx
```

## No Sound From USB DAC

List ALSA devices:

```bash
aplay -l
cat /proc/asound/cards
```

Configure USB DAC mode:

```bash
sudo /opt/pitunes/configure-mpd.sh usb-dac
sudo systemctl restart mpd
```

Test directly:

```bash
speaker-test -c2 -t wav
```

If the USB DAC is not card `1`, edit `/etc/asound.conf` and set the correct card number from `aplay -l`.

## No Sound From DAC HAT

Check the HAT vendor documentation for the required `dtoverlay`.

Example:

```bash
sudo HAT_OVERLAY=hifiberry-dac /opt/pitunes/configure-mpd.sh dac-hat
sudo reboot
```

After reboot:

```bash
aplay -l
mpc status
```

If the HAT does not appear, inspect:

```bash
grep dtoverlay /boot/config.txt /boot/firmware/config.txt 2>/dev/null
dmesg | grep -i -E "alsa|snd|i2s|hifi|dac"
```

## HDMI Or Headphone Output

Run:

```bash
sudo /opt/pitunes/configure-mpd.sh hdmi
```

or:

```bash
sudo /opt/pitunes/configure-mpd.sh headphones
```

Then reboot if the output does not switch immediately.

## Music Drive Does Not Mount

Recommended: label the music partition `MUSIC`.

Check devices:

```bash
lsblk -f
blkid
```

Restart the mount service:

```bash
sudo systemctl restart pitunes-mount.service
mount | grep /mnt/music
```

If needed, mount manually:

```bash
sudo mount /dev/sdX1 /mnt/music
sudo chown -R mpd:audio /mnt/music
mpc update
```

For a permanent drive with a known UUID, add an `/etc/fstab` line:

```text
UUID=YOUR-UUID /mnt/music auto nofail,noatime,x-systemd.automount 0 2
```

## Library Is Empty

Confirm files are visible:

```bash
find /mnt/music -maxdepth 2 -type f | head
```

Force an MPD update:

```bash
mpc update
sudo journalctl -u mpd -n 100
```

Check permissions:

```bash
sudo -u mpd test -r /mnt/music && echo readable
```

MPD supports common formats such as MP3, FLAC, Ogg Vorbis, WAV, and AAC depending on installed codecs.

## Album Art Missing

Put artwork in each album folder using one of these names:

```text
folder.jpg
cover.jpg
album.jpg
front.jpg
folder.png
cover.png
```

Then clear the thumbnail cache:

```bash
sudo rm -rf /var/cache/pitunes/art/*
sudo systemctl restart pitunes-api
```

Embedded art depends on MPD support for the file format and build options. Folder art is fastest and most reliable.

## Wi-Fi Setup

Run:

```bash
sudo /opt/pitunes/scripts/setup-wifi.sh "SSID" "PASSWORD" GB
```

Check connection:

```bash
ip addr show wlan0
ping -c 3 raspberrypi.com
```

PiTunes requires NetworkManager and uses it for both the home WiFi connection and the fallback hotspot:

```bash
nmcli device
nmcli connection show
journalctl -u NetworkManager -u pitunes-hotspot.service
```

## High CPU Or Slow PiTunes

- Use folder artwork around 500x500 to 1000x1000 pixels.
- Let the first browsing pass finish creating cached thumbnails.
- Clear very large embedded-only artwork by adding resized `folder.jpg` files.
- Avoid placing huge non-music folders under `/mnt/music`.

## Reset App Settings

```bash
sudo cp /opt/pitunes/config/settings.json /etc/pitunes/settings.json
sudo chown pitunes:pitunes /etc/pitunes/settings.json
sudo systemctl restart pitunes-api
```

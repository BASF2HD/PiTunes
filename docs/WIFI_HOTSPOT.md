# WiFi hotspot (Moode-style)

EchoFlow can broadcast a setup WiFi network when the Pi has no Ethernet and no home WiFi connection — similar to [moOde Audio](https://moodeaudio.org/) hotspot behaviour.

## Defaults

| Setting | Default |
|---------|---------|
| SSID | `EchoFlow` |
| Password | `echoflowaudio` |
| AP IP | `172.24.1.1` |
| Web UI | http://172.24.1.1 or http://echoflow.local |

Edit `/etc/echoflow/wifi-hotspot.conf` before shipping an image, or change the password after first boot.

## When the hotspot starts

At boot, `echoflow-hotspot.service` runs `wifi-hotspot.sh auto` (waits ~8s for DHCP, then decides):

1. **Ethernet has an IPv4 address** → no hotspot.
2. **WiFi station has an IPv4 address** → no hotspot.
3. **Otherwise** → start AP (if `AUTO_HOTSPOT=1`).

Also starts AP when:

- `FORCE_HOTSPOT=1` in config, or
- `wpa_supplicant` is configured with SSID `Activate Hotspot` (Moode convention).

## Connect your phone / laptop

1. Join WiFi **EchoFlow** (password in `wifi-hotspot.conf`).
2. Open **http://172.24.1.1** in a browser.
3. Configure home WiFi:

```bash
sudo /opt/echoflow/scripts/setup-wifi.sh "YourSSID" "YourPassword" GB
```

Or use the API:

```http
POST /api/network/wifi/connect
Content-Type: application/json

{"ssid":"YourSSID","password":"YourPassword","country":"GB"}
```

The hotspot stops and the Pi joins your network.

## Manual control

```bash
sudo /opt/echoflow/scripts/wifi-hotspot.sh status
sudo /opt/echoflow/scripts/wifi-hotspot.sh start   # force AP on
sudo /opt/echoflow/scripts/wifi-hotspot.sh stop
```

API:

- `GET /api/network/wifi/status`
- `GET /api/network/wifi/scan`
- `POST /api/network/wifi/connect`
- `POST /api/network/hotspot/start`
- `POST /api/network/hotspot/stop`

## Packages

Installed by `install.sh`: `hostapd`, `dnsmasq`, `iw`, `rfkill`, `wpasupplicant`, `dhcpcd`.

Debian’s default `hostapd` / `dnsmasq` services are disabled; EchoFlow starts them only when the hotspot is active.

## Troubleshooting

- **No AP after boot**: Check `journalctl -u echoflow-hotspot.service` and `rfkill list`.
- **Country code**: Set `COUNTRY_CODE=GB` (or your ISO code) in `wifi-hotspot.conf`; run `raspi-config` WiFi country if needed.
- **Still on hotspot with Ethernet**: Unplug Ethernet briefly and run `sudo wifi-hotspot.sh stop`, or set `AUTO_HOTSPOT=0`.

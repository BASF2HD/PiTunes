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

At boot, `echoflow-hotspot.service` continuously supervises NetworkManager:

1. **Ethernet has an IPv4 address** → no hotspot.
2. **WiFi station has an IPv4 address** → no hotspot.
3. **Otherwise** → start AP (if `AUTO_HOTSPOT=1`).

It restores the hotspot automatically if a requested home WiFi connection fails. Set `FORCE_HOTSPOT=1` to keep the AP active.

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

The API acknowledges the request before the hotspot stops. NetworkManager then joins the selected network; if it cannot obtain an IP address, the EchoFlow hotspot returns automatically.

## Manual control

```bash
sudo /opt/echoflow/scripts/wifi-hotspot.sh status
sudo /opt/echoflow/scripts/wifi-hotspot.sh scan
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

Installed by `install.sh`: `network-manager`, `iw`, `rfkill`, and `wpasupplicant`.

NetworkManager exclusively owns Ethernet, saved WiFi networks, scanning, and the EchoFlow hotspot. Standalone `hostapd`, `dnsmasq`, and `dhcpcd` services are disabled to avoid interface ownership conflicts.

## Troubleshooting

- **No AP after boot**: Check `journalctl -u echoflow-hotspot.service`, `nmcli device`, and `rfkill list`.
- **Country code**: Set `COUNTRY_CODE=GB` (or your ISO code) in `wifi-hotspot.conf`; run `raspi-config` WiFi country if needed.
- **Still on hotspot with Ethernet**: Unplug Ethernet briefly and run `sudo wifi-hotspot.sh stop`, or set `AUTO_HOTSPOT=0`.

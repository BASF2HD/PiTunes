# Security Policy

PiTunes is a network-connected appliance. Security reports should not be opened as public issues before a fix is available.

The current web API is intended for a trusted home LAN and does not provide per-user authentication. Configure the recovery hotspot promptly and do not expose port 80 directly to the public internet.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository and include:

- affected PiTunes version and image architecture
- Raspberry Pi model and Raspberry Pi OS version
- reproduction steps and expected impact
- relevant logs with passwords, WiFi credentials, and personal library data removed

Maintainers should acknowledge a report within seven days. A coordinated disclosure date will be agreed after the issue is reproduced and a fix is prepared.

## Supported versions

Only the latest stable PiTunes release receives security fixes. Older releases should be upgraded or reflashed with the latest published image.

## Update boundaries

- App OTA updates PiTunes application and service files only.
- Raspberry Pi OS package, kernel, firmware, and bootloader fixes are delivered through tested PiTunes image releases until a rollback-capable system update channel is available.
- Public images do not ship a known SSH password. Set credentials or an SSH key with Raspberry Pi Imager.
- Do not enable unattended full-distribution upgrades on a production PiTunes appliance.

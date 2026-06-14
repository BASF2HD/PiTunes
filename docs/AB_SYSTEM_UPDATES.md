# A/B System Update Architecture

PiTunes uses two transactional update mechanisms:

- App OTA replaces PiTunes-owned application and service files and restores its
  rollback archive if the API health check fails.
- A/B system OTA writes a signed full-system bundle only to the inactive
  boot/root slot, then uses Raspberry Pi `tryboot` for one validation boot.

Major partition-layout changes still require a newly flashed, tested SD-card
image.

## Safety status

The A/B runtime, signed bundle builder, release routing, and rollback services
are implemented behind a capability gate. They remain disabled on existing
two-partition PiTunes images.

Do not publish an A/B image or a system update until the A/B image builder and
the complete power-loss matrix have passed on every supported Raspberry Pi
model.

Build a staging A/B image from an already tested normal PiTunes image:

```bash
sudo ./tools/build-ab-image.sh \
  --source image/out/pitunes-arm64.img \
  --output image/out/pitunes-arm64-ab.img \
  --public-key /secure/pitunes-system-update-public.pem
```

The normal image build remains the public default. The A/B builder is an
explicit staging step and never modifies its source image.

## Required image layout

An A/B-capable image must provide:

| Component | Purpose |
|---|---|
| Boot control | Stable firmware-visible `autoboot.txt` selector mounted by both slots |
| Boot A | Normal or fallback Raspberry Pi firmware/kernel files |
| Root A | Complete PiTunes operating system |
| Boot B | Inactive/next Raspberry Pi firmware/kernel files |
| Root B | Inactive/next complete PiTunes operating system |
| Persistent data | Update state, settings, network credentials, playlists, and logs |

The control and persistent filesystems must be mounted before the system updater
or boot check runs. Both roots must use the same control selector and persistent
data.

The image must install `/etc/pitunes/system-update.json` using
`config/system-update.example.json` as its schema. Use stable
`/dev/disk/by-partuuid/...` paths, not `/dev/mmcblk0pN` names.

The image must also install the public update verification key at the path
declared by `publicKey`. The private signing key must remain offline.

## Release assets

A system-update GitHub Release contains:

```text
pitunes-release.json
pitunes-system-manifest.json
pitunes-system-manifest.sig
pitunes-system-<version>-<arch>-boot.img.xz
pitunes-system-<version>-<arch>-root.img.xz
```

Build them from hardware-tested raw partition images:

```bash
./tools/build-system-update-bundle.sh \
  --version 1.4.0 \
  --arch aarch64 \
  --boot-image boot.img \
  --root-image root.img \
  --signing-key /secure/offline/pitunes-system-update-private.pem
```

`pitunes-system-manifest.sig` protects the system version, architecture,
strategy, asset names, and SHA-256 checksums. PiTunes refuses modified,
unsigned, wrong-product, wrong-architecture, or wrong-strategy bundles.

## Installation and rollback flow

1. The UI reads `pitunes-release.json` and shows one Software Update action.
2. The system updater validates the A/B capability and persistent mount.
3. It identifies the active root and refuses to write mounted/active devices.
4. It downloads and verifies the signed manifest and both compressed images.
5. It writes root then boot to the inactive slot.
6. It patches slot-specific `fstab` and `cmdline.txt` values.
7. It records pending state on the persistent filesystem.
8. It updates `autoboot.txt` atomically and reboots using `tryboot`.
9. The boot-check service validates nginx, the PiTunes API, MPD, and
   `/api/health`.
10. Success commits the new slot. Failure reboots normally into the previous
    default slot.

If the new kernel cannot reach systemd, Raspberry Pi `tryboot` remains
uncommitted. A power cycle boots the previous default slot. A production image
should additionally enable and test a hardware watchdog before system OTA is
declared generally available.

## Mandatory staging matrix

Test every item on each supported Pi model and architecture:

- valid signed update
- invalid signature and modified manifest
- wrong architecture and wrong product
- insufficient disk space
- network loss during every download
- power loss while downloading, writing root, writing boot, and committing
- API, nginx, and MPD health-check failure
- kernel that cannot complete boot
- persistent data survives success and rollback
- ten consecutive A-to-B and B-to-A updates

The system-update release descriptor must not be published until this matrix
passes. Existing images continue using App OTA.

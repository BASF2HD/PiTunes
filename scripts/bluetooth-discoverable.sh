#!/usr/bin/env bash
# Make the powered Bluetooth controller continuously pairable and discoverable.
set -euo pipefail

DEVICE_NAME="${ECHOFLOW_DEVICE_NAME:-EchoFlow}"

rfkill unblock bluetooth 2>/dev/null || true

for _ in $(seq 1 20); do
  if bluetoothctl show >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

bluetoothctl <<EOF
power on
system-alias ${DEVICE_NAME}
pairable on
discoverable on
show
EOF

status="$(bluetoothctl show)"
grep -q "Alias: ${DEVICE_NAME}" <<<"${status}"
grep -q "Powered: yes" <<<"${status}"
grep -q "Pairable: yes" <<<"${status}"
grep -q "Discoverable: yes" <<<"${status}"

#!/usr/bin/env bash
set -euo pipefail

# Generates the CI SSH keypair used by the GitHub Actions workflow, and prints
# the exact `gcloud compute ssh` commands to install its public key on VM1 and
# VM2 so the runner can SSH into them.
#
# Usage:
#   ./deploy/setup-ssh-keys.sh VM1_NAME VM2_NAME [ZONE]
#
#   VM1_NAME — the VM running api + postgres + redis
#   VM2_NAME — the VM running the reservation worker
#   ZONE     — optional GCP zone (omitted if unset; gcloud uses its default)
#
# Also honors: CI_SSH_KEY_PATH (default ~/.ssh/ticketing-deploy).

KEY_PATH="${CI_SSH_KEY_PATH:-$HOME/.ssh/ticketing-deploy}"

VM1_NAME="${1:-${VM1_NAME:-}}"
VM2_NAME="${2:-${VM2_NAME:-}}"
ZONE="${3:-${ZONE:-}}"

if [[ -z "$VM1_NAME" || -z "$VM2_NAME" ]]; then
  echo "Usage: $0 VM1_NAME VM2_NAME [ZONE]" >&2
  echo "  VM1_NAME — the VM running api + postgres + redis" >&2
  echo "  VM2_NAME — the VM running the reservation worker" >&2
  echo "  ZONE     — optional GCP zone" >&2
  exit 1
fi

# --- Generate the keypair (idempotent: reuse an existing one) ---
if [[ -f "$KEY_PATH" ]]; then
  echo "ℹ️  $KEY_PATH already exists — reusing it (not regenerating)."
else
  ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "ticketing-ci" >/dev/null
  echo "✅ Generated new CI keypair."
fi

PUBKEY="$(cat "$KEY_PATH.pub")"

# --- Build the install command (appends the key only if not already present) ---
install_cmd() {
  local vm="$1" zf=""
  [[ -n "$ZONE" ]] && zf=" --zone=$ZONE"
  echo "gcloud compute ssh $vm$zf --command=\"mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qxF '$PUBKEY' ~/.ssh/authorized_keys 2>/dev/null || echo '$PUBKEY' >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys\""
}

cat <<EOF

Public key (installs on both VMs):
  $PUBKEY

Install it on BOTH VMs by running these on your machine:

  # VM1 ($VM1_NAME)
  $(install_cmd "$VM1_NAME")

  # VM2 ($VM2_NAME)
  $(install_cmd "$VM2_NAME")

Then add these GitHub secrets (Settings → Secrets and variables → Actions):
  VM1_SSH_KEY  ->  full contents of $KEY_PATH      (the PRIVATE key)
  VM2_SSH_KEY  ->  same file (or a separate key per VM)
  VM1_USER     ->  the OS user gcloud signs in as on VM1 (usually: $USER)
  VM2_USER     ->  same on VM2

The VM1_USER/VM2_USER must be the user whose ~/.ssh/authorized_keys you just
appended to — i.e. the OS user that gcloud compute ssh signs in as.
EOF

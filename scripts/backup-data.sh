#!/bin/bash
# Backup listings database, uploads, and generated images.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y-%m-%d_%H-%M-%S)"
DEST="${1:-$ROOT/backups/listing-data_$STAMP}"

mkdir -p "$DEST"
cp "$ROOT/data/db.sqlite" "$DEST/"
rsync -a "$ROOT/data/uploads/" "$DEST/uploads/"
rsync -a "$ROOT/data/generated/" "$DEST/generated/"

echo "Backup saved to: $DEST"
du -sh "$DEST"

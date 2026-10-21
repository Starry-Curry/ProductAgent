#!/bin/sh
set -eu
# Keep the original Railway data path and explicitly permit ModelScope's persistent mount.
case "${PRODUCT_AGENT_DATA_DIR:-}" in
  /data/wujian|/mnt/workspace/wujian) ;;
  *) echo "Unexpected PRODUCT_AGENT_DATA_DIR (allowed: /data/wujian or /mnt/workspace/wujian)" >&2; exit 1 ;;
esac
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$PRODUCT_AGENT_DATA_DIR"
  test ! -L "$PRODUCT_AGENT_DATA_DIR" || { echo "Data root must not be a symlink" >&2; exit 1; }
  chown node:node "$PRODUCT_AGENT_DATA_DIR"
  chmod 700 "$PRODUCT_AGENT_DATA_DIR"
  exec gosu node "$@"
fi
# A rootless runtime must have a writable persistent mount.
test -w "$PRODUCT_AGENT_DATA_DIR" || { echo "Persistent data directory is not writable" >&2; exit 1; }
exec "$@"

#!/bin/sh
set -eu
# The mount may be root-owned; only this dedicated application child is assigned to node.
test "${PRODUCT_AGENT_DATA_DIR}" = "/data/wujian" || { echo "Docker image expects PRODUCT_AGENT_DATA_DIR=/data/wujian" >&2; exit 1; }
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/wujian
  test ! -L /data/wujian || { echo "Data root must not be a symlink" >&2; exit 1; }
  chown node:node /data/wujian
  chmod 700 /data/wujian
  exec gosu node "$@"
fi
exec "$@"

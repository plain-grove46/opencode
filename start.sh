#!/bin/sh
set -e
opencode serve --port 4096 --hostname 127.0.0.1 &
OPENCODE_URL=http://127.0.0.1:4096 SHIM_PORT=${PORT:-8080} node ./shim.mjs

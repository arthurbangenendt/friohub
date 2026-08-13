#!/bin/sh
set -eu

container="supabase_db_friohub"
duration="${FRIOHUB_LOAD_DURATION_SECONDS:-20}"
clients="${FRIOHUB_LOAD_CLIENTS:-10}"

case "$duration:$clients" in
  *[!0-9:]*) echo "Duração e concorrência devem ser inteiros positivos." >&2; exit 1 ;;
esac

docker exec -i "$container" pgbench -U postgres -d postgres \
  --no-vacuum --client="$clients" --jobs=2 --time="$duration" \
  --latency-limit=500 --max-tries=1 --failures-detailed \
  --file=- < scripts/load/marketplace-read.sql

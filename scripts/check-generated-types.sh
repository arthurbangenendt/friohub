#!/usr/bin/env sh
set -eu

types_tmp="$(mktemp)"
trap 'rm -f "$types_tmp"' EXIT

SUPABASE_TELEMETRY_DISABLED=1 supabase gen types --local --schema public > "$types_tmp"

if ! cmp -s "$types_tmp" src/types/database.generated.ts; then
  echo "Os tipos do Supabase estão desatualizados. Rode: npm run db:types" >&2
  diff -u src/types/database.generated.ts "$types_tmp" || true
  exit 1
fi

echo "Tipos do Supabase estão sincronizados."


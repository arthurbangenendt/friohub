#!/bin/sh
set -eu

container="supabase_db_friohub"
restore_db="friohub_restore_verify_$$"
work_dir="$(mktemp -d -t friohub-restore.XXXXXX)"
archive="$work_dir/friohub.dump"
restore_list="$work_dir/restore.list"

case "$restore_db" in
  friohub_restore_verify_[0-9]*) ;;
  *) echo "Nome inseguro para banco temporário." >&2; exit 1 ;;
esac

cleanup() {
  docker exec "$container" dropdb -U postgres --if-exists "$restore_db" >/dev/null 2>&1 || true
  docker exec "$container" rm -f "/tmp/friohub-restore-$$.list" >/dev/null 2>&1 || true
  if [ -f "$archive" ]; then rm "$archive"; fi
  if [ -f "$restore_list" ]; then rm "$restore_list"; fi
  if [ -d "$work_dir" ]; then rmdir "$work_dir"; fi
}
trap cleanup EXIT INT TERM

docker inspect "$container" >/dev/null
docker exec "$container" pg_dump -U postgres -d postgres -Fc --no-owner --no-privileges \
  --schema=public --schema=auth --schema=supabase_migrations > "$archive"
test -s "$archive"
# pg_cron é deliberadamente single-database no ambiente Supabase. O ensaio
# restaura a aplicação e valida os jobs no banco de origem, sem tentar criar
# uma segunda instância da extensão no mesmo cluster.
docker exec -i "$container" pg_restore -l < "$archive" | awk '!/pg_cron/ && !/ cron /' > "$restore_list"
test -s "$restore_list"

docker exec "$container" createdb -U postgres --template=template0 "$restore_db"
docker exec "$container" psql -U postgres -d "$restore_db" -v ON_ERROR_STOP=1 -c "drop schema public cascade" >/dev/null
docker cp "$restore_list" "$container:/tmp/friohub-restore-$$.list" >/dev/null
docker exec -i "$container" pg_restore -U postgres -d "$restore_db" --no-owner --no-privileges --exit-on-error \
  --use-list="/tmp/friohub-restore-$$.list" < "$archive"
docker exec "$container" rm "/tmp/friohub-restore-$$.list"

source_counts="$(docker exec "$container" psql -U postgres -d postgres -Atqc "
  select concat_ws(':',
    (select count(*) from public.profiles),
    (select count(*) from public.quote_requests),
    (select count(*) from public.jobs),
    (select count(*) from public.orders),
    (select count(*) from public.pmoc_plans));")"
restore_counts="$(docker exec "$container" psql -U postgres -d "$restore_db" -Atqc "
  select concat_ws(':',
    (select count(*) from public.profiles),
    (select count(*) from public.quote_requests),
    (select count(*) from public.jobs),
    (select count(*) from public.orders),
    (select count(*) from public.pmoc_plans));")"

test "$source_counts" = "$restore_counts"
cron_count="$(docker exec "$container" psql -U postgres -d postgres -Atqc "
  select count(*) from cron.job
   where jobname in ('friohub-marketplace-operations', 'friohub-financial-reconciliation', 'friohub-pmoc-recorrente', 'friohub-system-health');")"
test "$cron_count" -eq 4
restore_schema_check="$(docker exec "$container" psql -U postgres -d "$restore_db" -v ON_ERROR_STOP=1 -Atqc "
  select concat_ws(':',
    to_regprocedure('public.aceitar_quote(uuid,text,jsonb)') is not null,
    to_regprocedure('public.avaliar_saude_sistema()') is not null,
    to_regclass('public.financial_postings') is not null,
    (select count(*) from pg_constraint where contype = 'f' and connamespace = 'public'::regnamespace) > 0); ")"
echo "Validação estrutural: $restore_schema_check"
test "$restore_schema_check" = "t:t:t:t"

echo "Restauração lógica validada em banco temporário; contagens: $restore_counts"

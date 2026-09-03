-- ============================================================================
-- Chaves de API da distribuidora — autenticação server-to-server para o ERP
--
-- Até aqui, toda escrita em `products` passava por uma sessão de usuário
-- Supabase (`auth.uid()` de um JWT). A integração de sync em massa
-- (20260903120000 em diante) é chamada pelo ERP da distribuidora, sem sessão
-- nenhuma — a chave de API é o único jeito de saber quem está falando.
--
-- Padrão Stripe/GitHub: a chave crua só existe UMA VEZ, na hora da criação.
-- Depois disso só o hash fica gravado — nem a distribuidora, nem ninguém com
-- acesso ao banco, consegue reconstituir a chave original.
--
-- `key_hash` NUNCA pode ser lido pela distribuidora nem por ninguém além da
-- própria RPC de validação (que roda como `service_role`, chamada só pela
-- Edge Function de ingestão) — mesmo tratamento de segredo que `products.custo`.
-- ============================================================================

create table public.distributor_api_keys (
  id             uuid primary key default gen_random_uuid(),
  distributor_id uuid not null references public.distributors (id) on delete cascade,
  nome           text not null check (char_length(btrim(nome)) between 2 and 60),
  key_prefix     text not null,
  key_hash       text not null unique,
  criado_em      timestamptz not null default now(),
  revogado_em    timestamptz,
  last_used_at   timestamptz
);

comment on table public.distributor_api_keys is
  'Credencial server-to-server pra distribuidora sincronizar catálogo via API. Sem RLS de insert/update/delete: todo o ciclo de vida passa pelas RPCs SECURITY DEFINER abaixo — nunca por escrita direta na tabela.';
comment on column public.distributor_api_keys.key_hash is
  'sha256 da chave, hex. A chave crua nunca é persistida — só existe na resposta de criar_chave_api_distribuidora, uma única vez.';

create index idx_distributor_api_keys_dist on public.distributor_api_keys (distributor_id);

alter table public.distributor_api_keys enable row level security;

/* Só SELECT tem policy — nenhuma de insert/update/delete. Mesmo raciocínio de
   `purchase_orders` (20260812260000): "sem policy de insert, a porta fica
   fechada". Toda mutação é via RPC. */
create policy "distributor_api_keys_read" on public.distributor_api_keys
  for select using (distributor_id = auth.uid() or public.eh_admin());

/* Allowlist por coluna: `key_hash` nunca sai daqui, nem pra o dono da chave.
   Ela mostra o `key_prefix` (primeiros caracteres, só pra reconhecer qual é
   qual) — igual a um cartão terminando em ****1234. */
revoke all on public.distributor_api_keys from anon, authenticated;
grant select (id, distributor_id, nome, key_prefix, criado_em, revogado_em, last_used_at)
  on public.distributor_api_keys to authenticated;

-- ---------------------------------------------------------------------------
-- Criar chave — devolve a chave crua uma única vez.
-- ---------------------------------------------------------------------------
create or replace function public.criar_chave_api_distribuidora(p_nome text)
returns table(id uuid, chave text)
language plpgsql
security definer
-- pgcrypto (gen_random_bytes/digest) mora no schema `extensions`, não em
-- `public`, neste projeto — confirmado rodando local (`pg_extension`/`pg_namespace`).
-- `gen_random_uuid()` não precisa disso porque é builtin do Postgres 13+,
-- diferente de gen_random_bytes/digest, que são mesmo da extensão.
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_chave  text;
  v_prefix text;
  v_id     uuid;
begin
  if v_uid is null or not exists (
    select 1 from public.profiles p where p.id = v_uid and p.role = 'distribuidora'
  ) then
    raise exception 'Apenas distribuidoras podem criar chaves de API.';
  end if;

  if nullif(btrim(p_nome), '') is null then
    raise exception 'Informe um nome para identificar a chave.';
  end if;

  if (
    select count(*) from public.distributor_api_keys k
     where k.distributor_id = v_uid and k.revogado_em is null
  ) >= 5 then
    raise exception 'Limite de 5 chaves ativas por distribuidora — revogue uma chave antiga antes de criar outra.';
  end if;

  v_chave  := 'fh_live_' || encode(gen_random_bytes(32), 'hex');
  v_prefix := left(v_chave, 12);

  insert into public.distributor_api_keys (distributor_id, nome, key_prefix, key_hash)
  values (v_uid, btrim(p_nome), v_prefix, encode(digest(v_chave, 'sha256'), 'hex'))
  returning distributor_api_keys.id into v_id;

  return query select v_id, v_chave;
end;
$$;

revoke all on function public.criar_chave_api_distribuidora(text) from public, anon;
grant execute on function public.criar_chave_api_distribuidora(text) to authenticated;

comment on function public.criar_chave_api_distribuidora(text) is
  'Devolve a chave crua na resposta desta chamada, uma única vez. Depois disso só o hash é recuperável.';

-- ---------------------------------------------------------------------------
-- Revogar chave — a distribuidora derruba uma chave que vazou ou não usa mais.
-- ---------------------------------------------------------------------------
create or replace function public.revogar_chave_api_distribuidora(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.distributor_api_keys
     set revogado_em = now()
   where id = p_id and distributor_id = auth.uid() and revogado_em is null;

  if not found then
    raise exception 'Chave não encontrada.';
  end if;
end;
$$;

revoke all on function public.revogar_chave_api_distribuidora(uuid) from public, anon;
grant execute on function public.revogar_chave_api_distribuidora(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Validar chave — usada pela Edge Function a cada request recebido do ERP.
-- Só service_role executa: nunca é chamável por uma sessão de usuário comum
-- (a própria chave de API não deveria conseguir se autovalidar por aqui).
--
-- Bloqueia distribuidora não verificada/inativa — mesma trava de negócio que
-- já impede produto dela de aparecer na vitrine pública
-- (`distribuidora_ativa`, 20260812260000).
-- ---------------------------------------------------------------------------
create or replace function public.validar_chave_api(p_chave text)
returns table(distributor_id uuid, api_key_id uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_key  public.distributor_api_keys%rowtype;
  v_dist public.distributors%rowtype;
begin
  if nullif(p_chave, '') is null then
    return;
  end if;
  v_hash := encode(digest(p_chave, 'sha256'), 'hex');

  select * into v_key from public.distributor_api_keys k where k.key_hash = v_hash;
  if not found or v_key.revogado_em is not null then
    return;
  end if;

  select * into v_dist from public.distributors d where d.id = v_key.distributor_id;
  if not found or not v_dist.ativo or v_dist.verification_status <> 'verificado' then
    return;
  end if;

  update public.distributor_api_keys set last_used_at = now() where id = v_key.id;

  return query select v_key.distributor_id, v_key.id;
end;
$$;

revoke all on function public.validar_chave_api(text) from public, anon, authenticated;
grant execute on function public.validar_chave_api(text) to service_role;

comment on function public.validar_chave_api(text) is
  'Sem linha de volta = chave inválida/revogada OU distribuidora não verificada/inativa. A Edge Function trata os dois casos como 401/403 sem distinguir motivo na resposta (não vazar se a chave existe).';

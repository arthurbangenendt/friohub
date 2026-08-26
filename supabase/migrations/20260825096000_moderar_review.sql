-- ============================================================================
-- Moderação de avaliação, auditada
-- ============================================================================
--
-- SECURITY_PERMISSION_MATRIX.md promete "Moderar auditado" pra reputação de
-- profissional e de cliente — mas não existia coluna de visibilidade, policy
-- de admin nem RPC nenhuma pra isso. Uma avaliação abusiva ou fraudulenta hoje
-- só sai do ar com DELETE direto no banco, sem rastro.
--
-- Ocultar preserva a linha (auditoria, e a nota volta se a decisão for
-- revertida) em vez de apagar. `oculta_em is null` é a condição de
-- visibilidade nas duas tabelas — quem já lia continua lendo o que não foi
-- ocultado; admin sempre vê tudo, oculto ou não.

alter table public.reviews
  add column if not exists oculta_em timestamptz,
  add column if not exists oculta_motivo text,
  add column if not exists oculta_por uuid references public.profiles (id) on delete set null;

alter table public.client_reviews
  add column if not exists oculta_em timestamptz,
  add column if not exists oculta_motivo text,
  add column if not exists oculta_por uuid references public.profiles (id) on delete set null;

-- ---------------------------------------------------------------------------
-- `reviews`: leitura pública vira "leitura pública do que não foi ocultado,
-- mais admin vê tudo".
-- ---------------------------------------------------------------------------
drop policy if exists "reviews_read_all" on public.reviews;
create policy "reviews_read_all" on public.reviews for select
  using (oculta_em is null or (select public.eh_admin()));

-- ---------------------------------------------------------------------------
-- `client_reviews`: mesma ideia, mas a base já era restrita (só o
-- profissional que atendeu aquele cliente, mais admin) — a condição de
-- ocultação entra só no lado do profissional; admin continua vendo tudo.
-- ---------------------------------------------------------------------------
drop policy if exists "client_reviews_pro_read" on public.client_reviews;
create policy "client_reviews_pro_read" on public.client_reviews for select
  using (
    (
      exists (
        select 1 from public.jobs j
         where j.cliente_id = client_reviews.cliente_id
           and j.profissional_id = auth.uid()
      )
      and client_reviews.oculta_em is null
    )
    or (select public.eh_admin())
  );

-- ---------------------------------------------------------------------------
-- RPC: mesma forma de `definir_verificacao` — SECURITY DEFINER, admin
-- obrigatório, justificativa obrigatória, uma função pra duas tabelas-irmãs
-- em vez de duplicar a lógica pra divergirem depois.
-- ---------------------------------------------------------------------------
create or replace function public.moderar_review(
  p_tabela text,
  p_id uuid,
  p_ocultar boolean,
  p_motivo text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ja_oculta boolean;
  v_reason text := nullif(btrim(p_motivo), '');
begin
  if v_uid is null or not public.eh_admin() then
    raise exception 'Acesso restrito a administradores.';
  end if;

  if p_tabela not in ('reviews', 'client_reviews') then
    raise exception 'Tabela inválida.';
  end if;

  if v_reason is null or char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Informe uma justificativa entre 5 e 500 caracteres.';
  end if;

  if p_tabela = 'reviews' then
    select (oculta_em is not null) into v_ja_oculta from public.reviews where id = p_id for update;
  else
    select (oculta_em is not null) into v_ja_oculta from public.client_reviews where id = p_id for update;
  end if;
  if not found then
    raise exception 'Avaliação não encontrada.';
  end if;

  if p_tabela = 'reviews' then
    update public.reviews
       set oculta_em = case when p_ocultar then now() else null end,
           oculta_motivo = case when p_ocultar then v_reason else null end,
           oculta_por = case when p_ocultar then v_uid else null end
     where id = p_id;
  else
    update public.client_reviews
       set oculta_em = case when p_ocultar then now() else null end,
           oculta_motivo = case when p_ocultar then v_reason else null end,
           oculta_por = case when p_ocultar then v_uid else null end
     where id = p_id;
  end if;

  insert into public.admin_audit_log (
    actor_id, action, entity_type, entity_id, old_values, new_values, reason
  ) values (
    v_uid, 'review_moderated', p_tabela, p_id,
    jsonb_build_object('oculta', v_ja_oculta),
    jsonb_build_object('oculta', p_ocultar),
    v_reason
  );
end;
$$;

revoke all on function public.moderar_review(text, uuid, boolean, text)
  from public, anon;
grant execute on function public.moderar_review(text, uuid, boolean, text)
  to authenticated;

comment on function public.moderar_review(text, uuid, boolean, text) is
  'Oculta/restaura avaliação (reviews ou client_reviews) com autorização, justificativa obrigatória e auditoria. Preserva a linha — nunca deleta.';

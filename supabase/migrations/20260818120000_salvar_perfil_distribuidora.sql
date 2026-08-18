-- ============================================================================
-- Conserta o salvamento do perfil da distribuidora — bug pré-existente
--
-- `salvarPerfilDistribuidora` (painel/distribuidora/actions.ts) faz
-- `supabase.from("distributors").upsert({..., cnpj, ...})`. Desde
-- 20260813160000 (que escondeu `cnpj` do grant de SELECT, de propósito, pra
-- não vazar o documento pra terceiros), esse upsert quebrou: `INSERT ...
-- ON CONFLICT DO UPDATE SET cnpj = excluded.cnpj` exige privilégio de SELECT
-- na coluna referenciada no SET/EXCLUDED, e `cnpj` nunca teve esse grant pra
-- authenticated. O Postgres recusa com "permission denied for table
-- distributors" — mensagem confusa (parece a tabela inteira), mas o problema
-- é só essa coluna. Confirmado reproduzindo o upsert direto no banco: sem
-- `cnpj` no SET, funciona; com `cnpj`, falha sempre.
--
-- Correção: a distribuidora pode gravar o PRÓPRIO cnpj (é o dono do dado, não
-- um terceiro lendo) — só não pode ser lido de volta por qualquer um via
-- REST, que é o que o grant restrito já garante. Mesmo padrão de
-- `obter_cnpj_distribuidora` (leitura), mas para escrita: função
-- SECURITY DEFINER que ignora o grant restrito da coluna.
--
-- Por ser SECURITY DEFINER, esta função também passa batido pela trigger
-- `protege_confianca_distributor` (ela só age quando `current_user in
-- ('authenticated','anon')`) — por isso a função só grava as 4 colunas que a
-- distribuidora tem permissão de escolher (razao_social, cnpj, cidade,
-- prazo_entrega_dias); verification_status/verified_at/ativo nunca aparecem
-- no INSERT nem no SET, então ficam no default ('pendente') ou intocados,
-- preservando a mesma garantia que a trigger dava.
-- ============================================================================
create or replace function public.salvar_perfil_distribuidora(
  p_razao_social text,
  p_cnpj text,
  p_cidade text,
  p_prazo_entrega_dias int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_razao text := nullif(btrim(coalesce(p_razao_social, '')), '');
begin
  if v_uid is null then
    raise exception 'Não autenticado.';
  end if;
  if v_razao is null or char_length(v_razao) < 3 then
    raise exception 'Informe a razão social.';
  end if;

  insert into public.distributors (id, razao_social, cnpj, cidade, prazo_entrega_dias)
  values (
    v_uid, v_razao, nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), ''),
    coalesce(nullif(btrim(p_cidade), ''), 'São Paulo'),
    least(90, greatest(0, coalesce(p_prazo_entrega_dias, 5)))
  )
  on conflict (id) do update set
    razao_social       = excluded.razao_social,
    cnpj               = excluded.cnpj,
    cidade             = excluded.cidade,
    prazo_entrega_dias = excluded.prazo_entrega_dias;
end;
$$;

revoke all on function public.salvar_perfil_distribuidora(text, text, text, int) from public, anon;
grant execute on function public.salvar_perfil_distribuidora(text, text, text, int) to authenticated;

comment on function public.salvar_perfil_distribuidora is
  'Upsert do perfil da distribuidora, incluindo o próprio CNPJ. SECURITY DEFINER porque cnpj não tem grant de SELECT (upsert direto pela API falharia com permission denied) — a distribuidora só grava a própria linha, via auth.uid().';

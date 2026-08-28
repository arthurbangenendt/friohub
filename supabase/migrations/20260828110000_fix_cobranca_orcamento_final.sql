-- ============================================================================
-- Corrige ambiguidade de order na cobrança de serviço
--
-- Desde 20260817130000_orcamento_final_pos_visita.sql, um job pode ter DUAS
-- orders (`origem in ('aceite_quote', 'orcamento_final')`). A versão anterior
-- de `preparar_cobranca_servico` (20260819150000_cobranca_servico.sql) buscava
-- a order só por `job_id`, sem `strict`, sem filtro de `origem`, sem
-- `order by`/`limit` — com duas orders no mesmo job, o Postgres escolhe uma
-- linha não determinística, podendo cobrar (ou reemitir o link de) o valor
-- errado.
--
-- Correção: a função passa a receber o `order_id` diretamente, eliminando a
-- ambiguidade na origem — quem chama já sabe qual order está cobrando (a tela
-- já renderiza um bloco de pagamento por order, ver
-- src/app/servico/[id]/page.tsx). A checagem de dono (cliente do job) continua
-- igual, só que via join a partir da order.
-- ============================================================================

-- `create or replace` não permite renomear parâmetro de entrada — precisa
-- dropar antes (mesma assinatura de tipos, uuid/uuid, mas o nome muda de
-- p_job_id para p_order_id).
drop function if exists public.preparar_cobranca_servico(uuid, uuid);

create function public.preparar_cobranca_servico(p_order_id uuid, p_cliente_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select o.id into v_order_id
    from public.orders o
    join public.jobs j on j.id = o.job_id
   where o.id = p_order_id and j.cliente_id = p_cliente_id;

  if v_order_id is null then
    raise exception 'Serviço não encontrado para este cliente.';
  end if;

  return public.preparar_cobranca_order(
    v_order_id, 'asaas', 'UNDEFINED', format('order:%s:cobranca-servico', v_order_id)
  );
end;
$$;

revoke all on function public.preparar_cobranca_servico(uuid, uuid) from public, anon, authenticated;
grant execute on function public.preparar_cobranca_servico(uuid, uuid) to service_role;

comment on function public.preparar_cobranca_servico is
  'Prepara a cobrança de UMA order de serviço específica (id explícito, não mais derivado por job_id) — um job pode ter até duas orders (aceite_quote + orcamento_final) e a ambiguidade anterior podia cobrar a errada.';

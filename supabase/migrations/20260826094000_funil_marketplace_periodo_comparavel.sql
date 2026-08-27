-- ============================================================================
-- Funil comparável com o período anterior
-- ============================================================================
--
-- `obter_funil_marketplace` sempre calculava a janela como `now() - p_days`
-- até `now()` — sem âncora, não dava pra pedir "os 30 dias anteriores aos
-- últimos 30" sem chamar duas vezes com janelas SOBREPOSTAS e tentar
-- subtrair uma da outra, o que já nasce errado pra `avg_first_response_minutes`
-- (é média, não soma) e pra `repeat_customers` (contagem distinta — subtrair
-- dois `count(distinct ...)` não dá o terceiro conjunto).
--
-- `p_end_date` novo resolve isso sem precisar subtrair nada: duas chamadas
-- com janelas de 30 dias que NÃO se sobrepõem (uma com p_end_date=now(),
-- outra com p_end_date=now()-30d) — cada uma já vem correta por construção.
--
-- A janela continua `>= since and <= until` (inclusiva nas duas pontas,
-- igual sempre foi) — cheguei a trocar pra meio-aberta (`< until`) pra evitar
-- que duas chamadas encostadas contem o instante exato da borda nas duas,
-- mas isso quebrou testes existentes: dentro de uma transação (é assim que
-- pgTAP roda, e como qualquer função `stable` se comporta) `now()` fica
-- congelado — uma linha inserida com `created_at default now()` e consultada
-- depois com `p_end_date` default `now()` tem os dois timestamps
-- IDÊNTICOS, e `<` estrito passou a excluir a própria linha que acabou de
-- ser criada. Fora de teste isso não acontece (duas chamadas de `now()` em
-- transações/requisições diferentes nunca empatam no microssegundo), mas
-- ainda assim é um risco maior que o problema que resolvia. Mantido como
-- estava: um pedido bem no instante exato da borda entre dois períodos
-- adjacentes pode, em teoria, contar nos dois — probabilidade desprezível
-- (empate de timestamp ao microssegundo entre duas chamadas HTTP
-- independentes), não vale a troca de comportamento testado.

-- `create or replace` não substitui uma função com lista de parâmetros
-- diferente — cria uma SOBRECARGA nova, e uma chamada de 2 argumentos passa
-- a ser ambígua entre a antiga e a nova (erro real, batido rodando o teste
-- antes de publicar: "function ... is not unique"). Precisa dropar a
-- assinatura antiga explicitamente.
drop function if exists public.obter_funil_marketplace(integer, text);

create or replace function public.obter_funil_marketplace(
  p_days integer default 30,
  p_city text default null,
  p_end_date timestamptz default now()
)
returns table (
  period_start timestamptz,
  period_end timestamptz,
  requested bigint,
  responded bigint,
  accepted bigint,
  started bigint,
  completed bigint,
  repeat_customers bigint,
  avg_first_response_minutes numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (select public.eh_admin()) then
    raise exception 'Acesso restrito a administradores.';
  end if;

  return query
  with params as (
    select coalesce(p_end_date, now()) - make_interval(days => least(365, greatest(1, coalesce(p_days, 30)))) as since,
           coalesce(p_end_date, now()) as until
  ), cohort as (
    select q.id, q.cliente_id, q.created_at,
           min(qu.created_at) as first_response_at,
           bool_or(qu.status = 'aceita') as was_accepted,
           bool_or(j.status in ('em_execucao', 'concluido', 'avaliado')) as was_started,
           bool_or(j.status in ('concluido', 'avaliado')) as was_completed
      from public.quote_requests q
      cross join params p
      left join public.quotes qu on qu.quote_request_id = q.id
      left join public.jobs j on j.quote_request_id = q.id
     where q.created_at >= p.since and q.created_at <= p.until
       and (nullif(btrim(coalesce(p_city, '')), '') is null
            or lower(q.cidade) = lower(btrim(p_city)))
     group by q.id, q.cliente_id, q.created_at
  )
  select
    p.since,
    p.until,
    count(c.id),
    count(c.id) filter (where c.first_response_at is not null),
    count(c.id) filter (where c.was_accepted),
    count(c.id) filter (where c.was_started),
    count(c.id) filter (where c.was_completed),
    count(distinct c.cliente_id) filter (where exists (
      select 1 from public.quote_requests previous
       where previous.cliente_id = c.cliente_id
         and previous.created_at < c.created_at
    )),
    round(avg(extract(epoch from (c.first_response_at - c.created_at)) / 60)
      filter (where c.first_response_at is not null), 1)
  from params p
  left join cohort c on true
  group by p.since, p.until;
end;
$$;

revoke all on function public.obter_funil_marketplace(integer, text, timestamptz)
  from public, anon;
grant execute on function public.obter_funil_marketplace(integer, text, timestamptz)
  to authenticated;

comment on function public.obter_funil_marketplace(integer, text, timestamptz) is
  'Funil administrativo por coorte de pedidos, incluindo resposta, aceite, execução, conclusão e recorrência. p_end_date permite pedir um período anterior (ex.: os 30 dias antes dos últimos 30) sem sobrepor janelas.';

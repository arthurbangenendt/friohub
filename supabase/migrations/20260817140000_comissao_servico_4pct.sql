-- ============================================================================
-- Comissão da plataforma: 7% -> 4%
--
-- Mesmo padrão de 20260814210000_comissao_servico_7pct: update na linha
-- singleton + novo default, para o valor seguir correto mesmo se a linha for
-- recriada. `orders` já criadas mantêm a comissão gravada em reais — não muda
-- retroativamente (ver comentário de platform_config.comissao_servico_pct).
-- ============================================================================
update public.platform_config
   set comissao_servico_pct = 0.04,
       updated_at           = now()
 where id;

alter table public.platform_config
  alter column comissao_servico_pct set default 0.04;

comment on column public.platform_config.comissao_servico_pct is
  'Percentual cobrado sobre a mão de obra/serviço, aplicado na criação da order (aceite da proposta ou orçamento final pós-visita). 4% desde 2026-08-17 (antes: 7% desde 2026-08-14, e 15% até então). Orders já criadas mantêm a comissão gravada em reais.';

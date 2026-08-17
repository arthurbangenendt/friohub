-- ---------------------------------------------------------------------------
-- Comissão de serviço: 15% -> 7%
--
-- A taxa tem uma fonte de verdade só: `platform_config.comissao_servico_pct`,
-- lida por `criar_order` e por `aceitar_proposta` no momento em que a ordem
-- nasce (ver 20260812220000_trava_jobs_reviews). O TypeScript apenas exibe o
-- percentual — `src/lib/pricing.ts` foi ajustado junto, e continua sendo só
-- vitrine.
--
-- Duas escritas, porque uma não cobre a outra:
--   1. a linha existente (id = true), que é o que de fato cobra hoje;
--   2. o `default` da coluna, que valeria se a linha precisasse ser recriada.
-- Sem a segunda, um `truncate` + reinsert em ambiente novo voltaria a 15%.
--
-- Escopo deliberado: `markup_produto_pct` (margem de equipamento) NÃO muda.
-- São duas receitas distintas e só a comissão de mão de obra foi revista.
--
-- Efeito no tempo: vale da aplicação em diante. Ordens já criadas guardam
-- `comissao_servico` em reais — snapshot, não percentual — e seguem em 15%,
-- que é o comportamento que o ledger exige ("alterações futuras de comissão
-- não reescrevem o passado", 20260813172401_financial_ledger_foundation).
-- ---------------------------------------------------------------------------

update public.platform_config
   set comissao_servico_pct = 0.07,
       updated_at           = now()
 where id;

alter table public.platform_config
  alter column comissao_servico_pct set default 0.07;

comment on column public.platform_config.comissao_servico_pct is
  'Percentual cobrado sobre a mão de obra, aplicado na criação da ordem. 7% desde 2026-08-14 (antes: 15%). Ordens anteriores mantêm o valor já gravado.';

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);

select has_function(
  'public', 'obter_funil_marketplace', array['integer', 'text', 'timestamptz'],
  'funil ganhou p_end_date pra período comparável'
);

-- ===========================================================================
-- Fixture: um cliente, quatro pedidos de orçamento com created_at controlado
-- perto da fronteira entre "período atual" (últimos 30 dias) e "período
-- anterior" (30-60 dias atrás), mas sem empatar no instante exato dela:
--   Q1 — 10 dias atrás            → só no período atual
--   Q2 — 29 dias e 23 horas atrás → só no período atual (pouco antes da borda)
--   Q3 — 30 dias e 1 hora atrás   → só no período anterior (pouco depois da borda)
--   Q4 — 59 dias atrás            → só no período anterior
-- Não uso o instante exato da borda (now() - 30 dias) de propósito: dentro
-- desta transação `now()` fica congelado (mesmo comportamento de qualquer
-- função `stable`), então o timestamp calculado no INSERT e o calculado na
-- chamada da RPC seriam bit-a-bit iguais — um empate artificial de teste que
-- não reflete duas requisições reais em momentos diferentes. O comentário da
-- migration já documenta esse caso como risco aceito, não testado aqui.
--
-- Inserção direta na tabela (não via criar_pedido_orcamento) porque só
-- created_at importa aqui — nenhuma proposta/job entra nesta contagem.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at) values
('c1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','cliente-periodo@teste.local','',now(),now()),
('c1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','admin-periodo@teste.local','',now(),now());

update public.profiles set role='cliente', nome='Cliente Periodo' where id='c1000000-0000-0000-0000-000000000001';
update public.profiles set role='admin', nome='Admin Periodo' where id='c1000000-0000-0000-0000-000000000002';

insert into public.quote_requests (id, cliente_id, job_type, cep, cidade, created_at) values
('c2000000-0000-0000-0000-000000000001','c1000000-0000-0000-0000-000000000001','limpeza','01001000','São Paulo', now() - interval '10 days'),
('c2000000-0000-0000-0000-000000000002','c1000000-0000-0000-0000-000000000001','limpeza','01001000','São Paulo', now() - interval '29 days 23 hours'),
('c2000000-0000-0000-0000-000000000003','c1000000-0000-0000-0000-000000000001','limpeza','01001000','São Paulo', now() - interval '30 days 1 hour'),
('c2000000-0000-0000-0000-000000000004','c1000000-0000-0000-0000-000000000001','limpeza','01001000','São Paulo', now() - interval '59 days');

-- ---------------------------------------------------------------------------
-- Não-admin não lê o funil.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000001',true);
select throws_ok(
  $$select * from public.obter_funil_marketplace(30, 'São Paulo', now())$$,
  'Acesso restrito a administradores.',
  'cliente não lê o funil administrativo'
);
reset role;

-- ---------------------------------------------------------------------------
-- Período atual (p_end_date=now()) pega Q1 e Q2.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-0000-0000-000000000002',true);
select is(
  (select requested from public.obter_funil_marketplace(30, 'São Paulo', now())),
  2::bigint,
  'período atual conta só Q1 e Q2'
);

-- ---------------------------------------------------------------------------
-- Período anterior (p_end_date=now()-30d) pega Q3 e Q4 — sem sobreposição.
-- ---------------------------------------------------------------------------
select is(
  (select requested from public.obter_funil_marketplace(30, 'São Paulo', now() - interval '30 days')),
  2::bigint,
  'período anterior conta só Q3 e Q4'
);

-- ---------------------------------------------------------------------------
-- Os dois períodos juntos somam exatamente os 4 pedidos — nem duplica, nem
-- perde nenhum entre as duas janelas adjacentes.
-- ---------------------------------------------------------------------------
select is(
  (select requested from public.obter_funil_marketplace(30, 'São Paulo', now()))
  + (select requested from public.obter_funil_marketplace(30, 'São Paulo', now() - interval '30 days')),
  4::bigint,
  'período atual + anterior somam os 4 pedidos, sem duplicar nem perder nenhum'
);

-- ---------------------------------------------------------------------------
-- Omitir p_end_date continua se comportando como antes (default now()) —
-- regressão do único jeito que o resto do sistema já chama essa função.
-- ---------------------------------------------------------------------------
select is(
  (select requested from public.obter_funil_marketplace(30, 'São Paulo')),
  (select requested from public.obter_funil_marketplace(30, 'São Paulo', now())),
  'omitir p_end_date continua equivalente a passar now() explicitamente'
);
reset role;

select * from finish();
rollback;

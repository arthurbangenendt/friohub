begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

-- ===========================================================================
-- Fixture: um profissional comprando peça avulsa (sem cliente, sem RFQ) e uma
-- distribuidora com um produto com estoque controlado.
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-tecnico@teste.local','',now(),now()),
('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-dist@teste.local','',now(),now()),
('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ca-admin@teste.local','',now(),now());

update public.profiles set role='profissional', nome='Técnico Compra Avulsa' where id='c0000000-0000-0000-0000-000000000001';
update public.profiles set role='distribuidora',nome='Distribuidora Compra Avulsa' where id='c0000000-0000-0000-0000-000000000002';
update public.profiles set role='admin',        nome='Admin Compra Avulsa'   where id='c0000000-0000-0000-0000-000000000003';

insert into public.professionals(id,tipo,cidade,estado)
values ('c0000000-0000-0000-0000-000000000001','autonomo','São Paulo','SP');

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo)
values ('c0000000-0000-0000-0000-000000000002','Dist Compra Avulsa LTDA','São Paulo','SP',5,'verificado',true);

insert into public.products(id,marca,modelo,btu,categoria,preco_venda,custo,distributor_id,ativo,estoque_disponivel,estoque_quantidade,preco_manual) values
('c0000000-0000-0000-0000-0000000000d1','Marca Z','Peça de reposição',9000,'split',300.00,180.00,'c0000000-0000-0000-0000-000000000002',true,true,1,true);

-- ===========================================================================
-- Profissional sem endereço é rejeitado antes de tocar em produto
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.criar_compra_avulsa(
      '[{"produtoId":"c0000000-0000-0000-0000-0000000000d1","quantidade":1}]'::jsonb,
      '01310-100','São Paulo', ''
    )$$,
  'Informe o endereço completo de entrega.',
  'compra avulsa sem endereço é rejeitada'
);

-- ===========================================================================
-- Fluxo feliz: profissional compra 1 unidade (todo o estoque disponível)
-- ===========================================================================
select lives_ok(
  $$select public.criar_compra_avulsa(
      '[{"produtoId":"c0000000-0000-0000-0000-0000000000d1","quantidade":1}]'::jsonb,
      '01310-100','São Paulo','Rua Teste, 400'
    )$$,
  'profissional compra peça avulsa sem passar por pedido de orçamento'
);

reset role;

select is(
  (select job_type from public.jobs where cliente_id = 'c0000000-0000-0000-0000-000000000001' and job_type = 'compra_equipamento'),
  'compra_equipamento',
  'job nasce com job_type compra_equipamento'
);
select is(
  (select profissional_id from public.jobs where cliente_id = 'c0000000-0000-0000-0000-000000000001' and job_type = 'compra_equipamento'),
  null::uuid,
  'job de compra avulsa não tem profissional — quem comprou é o "cliente" da linha'
);
select is(
  (select produto_id from public.jobs where cliente_id = 'c0000000-0000-0000-0000-000000000001' and job_type = 'compra_equipamento'),
  'c0000000-0000-0000-0000-0000000000d1'::uuid,
  'jobs.produto_id espelha o primeiro item — sem isso o card "Detalhes" fica vazio numa compra de item único'
);
select is(
  (select status from public.jobs where cliente_id = 'c0000000-0000-0000-0000-000000000001' and job_type = 'compra_equipamento'),
  'aberto',
  'job nasce aberto'
);
select is(
  (select o.origem from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = 'c0000000-0000-0000-0000-000000000001' and j.job_type = 'compra_equipamento'),
  'compra_avulsa',
  'order de compra avulsa tem origem própria, não reaproveita aceite_quote'
);
select is(
  (select o.preco_servico from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = 'c0000000-0000-0000-0000-000000000001' and j.job_type = 'compra_equipamento'),
  0.00::numeric(10,2),
  'compra avulsa não tem mão de obra — preco_servico = 0'
);
select is(
  (select estoque_quantidade from public.products where id = 'c0000000-0000-0000-0000-0000000000d1'),
  0,
  'estoque foi decrementado de 1 para 0'
);
select is(
  (select count(*)::integer from public.purchase_orders po
     join public.orders o on o.id = po.order_id
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = 'c0000000-0000-0000-0000-000000000001' and j.job_type = 'compra_equipamento'),
  1,
  'gerou ordem de repasse para a distribuidora'
);

-- ===========================================================================
-- Estoque zerado agora: segunda compra do mesmo produto é reprovada
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.criar_compra_avulsa(
      '[{"produtoId":"c0000000-0000-0000-0000-0000000000d1","quantidade":1}]'::jsonb,
      '01310-100','São Paulo','Rua Teste, 400'
    )$$,
  'Estes itens não estão mais disponíveis: Marca Z Peça de reposição.',
  'segunda compra é reprovada — estoque já foi todo vendido'
);

reset role;

-- ===========================================================================
-- Conclusão automática: avançar o repasse até 'entregue' conclui o job
-- sozinho, sem profissional envolvido.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);

select lives_ok(
  $$select public.avancar_purchase_order(
      (select po.id from public.purchase_orders po
        where po.distributor_id = 'c0000000-0000-0000-0000-000000000002'),
      'confirmado'
    )$$,
  'distribuidora confirma o repasse'
);

reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','c0000000-0000-0000-0000-000000000002',true);

select lives_ok(
  $$select public.avancar_purchase_order(
      (select po.id from public.purchase_orders po
        where po.distributor_id = 'c0000000-0000-0000-0000-000000000002'),
      'faturado'
    )$$,
  'distribuidora fatura o repasse'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po
    where po.distributor_id = 'c0000000-0000-0000-0000-000000000002'),
  'enviado', null, null, 'https://rastreio.exemplo.com/abc'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po
    where po.distributor_id = 'c0000000-0000-0000-0000-000000000002'),
  'entregue'
);

reset role;

select is(
  (select status from public.jobs where cliente_id = 'c0000000-0000-0000-0000-000000000001' and job_type = 'compra_equipamento'),
  'concluido',
  'job vira concluido sozinho quando a entrega chega em entregue — sem profissional pra clicar em nada'
);

select * from finish();
rollback;

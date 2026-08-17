begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

-- ===========================================================================
-- Fixture: um cliente, um técnico com raio de atendimento, e DUAS
-- distribuidoras — porque o caso que quebra o modelo antigo é justamente o
-- pedido cujos aparelhos vêm de fornecedores diferentes.
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('96000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ma-cliente@teste.local','',now(),now()),
('96000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ma-tecnico@teste.local','',now(),now()),
('96000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ma-dist-a@teste.local','',now(),now()),
('96000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ma-dist-b@teste.local','',now(),now()),
('96000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ma-intruso@teste.local','',now(),now());

update public.profiles set role='cliente',      nome='Cliente Multi'   where id='96000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Técnico Multi'   where id='96000000-0000-0000-0000-000000000002';
update public.profiles set role='distribuidora',nome='Distribuidora A' where id='96000000-0000-0000-0000-000000000003';
update public.profiles set role='distribuidora',nome='Distribuidora B' where id='96000000-0000-0000-0000-000000000004';
update public.profiles set role='cliente',      nome='Intruso'         where id='96000000-0000-0000-0000-000000000005';

insert into public.professionals(id,tipo,cidade,estado)
values ('96000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

insert into public.professional_skills(professional_id,specialty)
values ('96000000-0000-0000-0000-000000000002','instalacao');

-- Raio grande o bastante para o CEP do teste cair dentro sem depender de
-- geocodificação externa.
insert into public.professional_service_radius(professional_id,latitude,longitude,radius_km,location_label)
values ('96000000-0000-0000-0000-000000000002',-23.550000,-46.633000,50,'Base Centro');

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo) values
('96000000-0000-0000-0000-000000000003','Dist A LTDA','São Paulo','SP',3,'verificado',true),
('96000000-0000-0000-0000-000000000004','Dist B LTDA','São Paulo','SP',9,'verificado',true);

-- Três aparelhos: dois da distribuidora A, um da B.
insert into public.products(id,marca,modelo,btu,preco_venda,custo,distributor_id,ativo,estoque_disponivel,preco_manual) values
('96000000-0000-0000-0000-0000000000a1','Marca A','Split 9k', 9000,2000.00,1400.00,'96000000-0000-0000-0000-000000000003',true,true,true),
('96000000-0000-0000-0000-0000000000a2','Marca A','Split 12k',12000,2500.00,1800.00,'96000000-0000-0000-0000-000000000003',true,true,true),
('96000000-0000-0000-0000-0000000000b1','Marca B','Split 18k',18000,3200.00,2300.00,'96000000-0000-0000-0000-000000000004',true,true,true);

-- ===========================================================================
-- Contrato de schema
-- ===========================================================================
select has_table('public','quote_request_itens','pedido tem itens por ambiente');
select has_table('public','job_itens','job congela o escopo contratado');
select has_column('public','job_itens','preco_venda_snapshot','item contratado congela o preço de venda');
select has_column('public','job_itens','custo_snapshot','item contratado congela o custo');

select ok(
  not exists (
    select 1 from pg_constraint
     where conname = 'purchase_orders_order_id_key'
       and conrelid = 'public.purchase_orders'::regclass
  ),
  'purchase_orders não é mais limitada a uma por order'
);
select ok(
  exists (
    select 1 from pg_constraint
     where conname = 'purchase_orders_order_distribuidora_key'
       and conrelid = 'public.purchase_orders'::regclass
  ),
  'purchase_orders é única por (order, distribuidora)'
);

/* O backfill precisa ter deixado o schema num estado em que TODA leitura pode
   assumir pelo menos um item — senão as telas precisariam de dois caminhos. */
select ok(
  not exists (
    select 1 from public.quote_requests q
     where not exists (
       select 1 from public.quote_request_itens i where i.quote_request_id = q.id
     )
  ),
  'nenhum pedido ficou sem ambiente depois do backfill'
);

-- ===========================================================================
-- Criação: três ambientes num pedido só
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.criar_pedido_orcamento(
      'instalacao_com_equipamento','01310-100','São Paulo','Bela Vista',
      1,'proximos_dias','Casa inteira','{}'::jsonb,'',0,
      array['96000000-0000-0000-0000-000000000002'::uuid],
      '{}'::text[], -23.5505, -46.6333,
      '[{"ambiente":"Sala","area_m2":"28","num_pessoas":"4","btu_recomendado":"18000","produto_id":"96000000-0000-0000-0000-0000000000b1","quantidade":1},
        {"ambiente":"Quarto casal","area_m2":"14","num_pessoas":"2","btu_recomendado":"9000","produto_id":"96000000-0000-0000-0000-0000000000a1","quantidade":1},
        {"ambiente":"Suíte","area_m2":"18","num_pessoas":"2","btu_recomendado":"12000","produto_id":"96000000-0000-0000-0000-0000000000a2","quantidade":2}]'::jsonb
    )$$,
  'cliente cria um pedido com três ambientes'
);

select is(
  (select count(*)::integer from public.quote_request_itens i
     join public.quote_requests q on q.id = i.quote_request_id
    where q.cliente_id = '96000000-0000-0000-0000-000000000001'),
  3,
  'os três ambientes foram gravados'
);

/* `quantidade` do pedido deixou de ser um número digitado e passou a ser a soma
   real: 1 + 1 + 2 aparelhos. */
select is(
  (select quantidade from public.quote_requests
    where cliente_id = '96000000-0000-0000-0000-000000000001'),
  4,
  'quantidade do pedido é a soma dos aparelhos dos ambientes'
);

-- As colunas singulares seguem espelhando o primeiro ambiente — é o que
-- mantém as telas antigas funcionando.
select is(
  (select produto_id from public.quote_requests
    where cliente_id = '96000000-0000-0000-0000-000000000001'),
  '96000000-0000-0000-0000-0000000000b1'::uuid,
  'coluna singular espelha o aparelho do primeiro ambiente'
);
select is(
  (select detalhes->>'ambiente' from public.quote_requests
    where cliente_id = '96000000-0000-0000-0000-000000000001'),
  'Sala',
  'detalhes espelham o nome do primeiro ambiente'
);

select throws_ok(
  $$select public.criar_pedido_orcamento(
      'instalacao_com_equipamento','01310-100','São Paulo','Bela Vista',
      1,'proximos_dias','x','{}'::jsonb,'',0,
      array['96000000-0000-0000-0000-000000000002'::uuid],
      '{}'::text[], -23.5505, -46.6333,
      '[{"ambiente":"","area_m2":"20"}]'::jsonb
    )$$,
  'Cada ambiente precisa ter um nome.',
  'ambiente sem nome é rejeitado'
);

-- ===========================================================================
-- Visibilidade dos ambientes
-- ===========================================================================
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000002',true);
select is(
  (select count(*)::integer from public.quote_request_itens),
  3,
  'profissional destinatário enxerga os três ambientes do pedido'
);

select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000005',true);
select is(
  (select count(*)::integer from public.quote_request_itens),
  0,
  'quem não é dono nem destinatário não enxerga ambiente nenhum'
);

-- ===========================================================================
-- Proposta única pelo pacote e aceite
-- ===========================================================================
reset role;
insert into public.quotes(id,quote_request_id,professional_id,tipo,valor_mao_obra,valor_materiais,validade_ate)
select '96000000-0000-0000-0000-0000000000c1', q.id,
       '96000000-0000-0000-0000-000000000002','preco_fechado',1500.00,300.00, current_date + 7
  from public.quote_requests q
 where q.cliente_id = '96000000-0000-0000-0000-000000000001';

update public.platform_config set comissao_servico_pct = 0.07;

set local role authenticated;
select set_config('request.jwt.claim.sub','96000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.aceitar_quote(
      '96000000-0000-0000-0000-0000000000c1',
      'Rua Teste, 100 — apto 42',
      '{}'::jsonb
    )$$,
  'cliente aceita a proposta do pacote'
);

reset role;

select is(
  (select count(*)::integer from public.job_itens ji
     join public.jobs j on j.id = ji.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'),
  3,
  'o escopo contratado congelou os três ambientes'
);

/* Aritmética do dinheiro, item a item:
     Sala   : 3200 × 1 = 3200 (custo 2300)
     Quarto : 2000 × 1 = 2000 (custo 1400)
     Suíte  : 2500 × 2 = 5000 (custo 3600)
     produto = 10200 · custo = 7300 · margem = 2900
     serviço = 1500 + 300 = 1800 · comissão 7% = 126 */
select is(
  (select preco_produto from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'),
  10200.00::numeric(10,2),
  'preço de produto é a soma dos três ambientes'
);
select is(
  (select margem_produto from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'),
  2900.00::numeric(10,2),
  'margem de produto é a soma das margens por ambiente'
);
select is(
  (select comissao_servico from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'),
  126.00::numeric(10,2),
  'comissão continua incidindo só sobre a mão de obra'
);
select is(
  (select total from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'),
  12000.00::numeric(10,2),
  'total soma produto e serviço'
);

-- Duas distribuidoras envolvidas = duas ordens de compra.
select is(
  (select count(*)::integer from public.purchase_orders po
     join public.orders o on o.id = po.order_id
     join public.jobs j   on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'),
  2,
  'cada distribuidora recebe a própria ordem de compra'
);
select is(
  (select custo_snapshot from public.purchase_orders po
     join public.orders o on o.id = po.order_id
     join public.jobs j   on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'
      and po.distributor_id = '96000000-0000-0000-0000-000000000003'),
  5000.00::numeric(10,2),
  'ordem da distribuidora A soma o custo dos dois aparelhos dela'
);
select is(
  (select custo_snapshot from public.purchase_orders po
     join public.orders o on o.id = po.order_id
     join public.jobs j   on j.id = o.job_id
    where j.cliente_id = '96000000-0000-0000-0000-000000000001'
      and po.distributor_id = '96000000-0000-0000-0000-000000000004'),
  2300.00::numeric(10,2),
  'ordem da distribuidora B carrega só o custo do aparelho dela'
);

-- Um job só, como antes: o serviço é um, executado numa visita.
select is(
  (select count(*)::integer from public.jobs
    where cliente_id = '96000000-0000-0000-0000-000000000001'),
  1,
  'três ambientes continuam gerando um único serviço'
);

select * from finish();
rollback;

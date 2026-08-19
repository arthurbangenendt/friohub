begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(21);

-- ===========================================================================
-- Fixture: um cliente, um técnico, uma distribuidora com dois produtos de
-- categorias diferentes — o produto "errado" é o que prova que a trava de
-- categoria funciona, não só a de "tem produto ou não".
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('a0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ac-cliente@teste.local','',now(),now()),
('a0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ac-tecnico@teste.local','',now(),now()),
('a0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ac-dist@teste.local','',now(),now());

update public.profiles set role='cliente',      nome='Cliente Aparelho'   where id='a0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Técnico Aparelho'   where id='a0000000-0000-0000-0000-000000000002';
update public.profiles set role='distribuidora',nome='Distribuidora Teste' where id='a0000000-0000-0000-0000-000000000003';

insert into public.professionals(id,tipo,cidade,estado)
values ('a0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

insert into public.professional_skills(professional_id,specialty)
values ('a0000000-0000-0000-0000-000000000002','instalacao');

insert into public.professional_service_radius(professional_id,latitude,longitude,radius_km,location_label)
values ('a0000000-0000-0000-0000-000000000002',-23.550000,-46.633000,50,'Base Centro');

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo)
values ('a0000000-0000-0000-0000-000000000003','Dist Teste LTDA','São Paulo','SP',5,'verificado',true);

-- Split (categoria pedida) e Janela (categoria errada, para provar a trava).
insert into public.products(id,marca,modelo,btu,categoria,preco_venda,custo,distributor_id,ativo,estoque_disponivel,preco_manual) values
('a0000000-0000-0000-0000-0000000000a1','Marca X','Split 9k', 9000,'split', 2000.00,1400.00,'a0000000-0000-0000-0000-000000000003',true,true,true),
('a0000000-0000-0000-0000-0000000000a2','Marca X','Janela 9k',9000,'janela',1000.00, 600.00,'a0000000-0000-0000-0000-000000000003',true,true,true);

-- ===========================================================================
-- Contrato de schema
-- ===========================================================================
select has_column('public','quote_requests','sabe_aparelho','pedido registra se o cliente sabia o aparelho');
select has_column('public','quote_request_itens','categoria_desejada','ambiente pode pedir só uma categoria');
select has_column('public','quotes','produto_id','proposta pode escolher o produto');
select has_column('public','quotes','valor_equipamento','proposta pode precificar o produto escolhido');

-- ===========================================================================
-- Fluxo "não sabe o aparelho": cliente só informa a categoria
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.criar_pedido_orcamento(
      'instalacao_com_equipamento','01310-100','São Paulo','Bela Vista',
      1,'proximos_dias','Sala sem aparelho definido','{}'::jsonb,'',0,
      array['a0000000-0000-0000-0000-000000000002'::uuid],
      '{}'::text[], -23.5505, -46.6333,
      '[{"ambiente":"Sala","area_m2":"20","num_pessoas":"3","btu_recomendado":"9000","categoria_desejada":"split","quantidade":1}]'::jsonb,
      false
    )$$,
  'cliente cria pedido sem saber o aparelho, só a categoria'
);

select is(
  (select sabe_aparelho from public.quote_requests where cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  false,
  'pedido gravou sabe_aparelho = false'
);
select is(
  (select categoria_desejada from public.quote_request_itens i
     join public.quote_requests q on q.id = i.quote_request_id
    where q.cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  'split',
  'ambiente gravou a categoria pedida, sem produto'
);

reset role;

select throws_ok(
  $$insert into public.quotes(quote_request_id, professional_id, tipo, valor_mao_obra, valor_materiais, validade_ate)
    select id, 'a0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00, 0, current_date + 7
      from public.quote_requests where cliente_id = 'a0000000-0000-0000-0000-000000000001'$$,
  'Escolha o aparelho e informe o preço que vai cobrar por ele antes de enviar uma proposta de preço fechado.',
  'proposta de preço fechado sem produto é rejeitada quando o cliente não sabia o aparelho'
);

select throws_ok(
  $$insert into public.quotes(quote_request_id, professional_id, tipo, valor_mao_obra, produto_id, valor_equipamento, validade_ate)
    select id, 'a0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00,
           'a0000000-0000-0000-0000-0000000000a2', 1200.00, current_date + 7
      from public.quote_requests where cliente_id = 'a0000000-0000-0000-0000-000000000001'$$,
  'O aparelho escolhido não é da categoria pedida pelo cliente.',
  'produto de categoria diferente da pedida é rejeitado'
);

select lives_ok(
  $$insert into public.quotes(id, quote_request_id, professional_id, tipo, valor_mao_obra, produto_id, valor_equipamento, validade_ate)
    select 'a0000000-0000-0000-0000-0000000000c1', id, 'a0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00,
           'a0000000-0000-0000-0000-0000000000a1', 2500.00, current_date + 7
      from public.quote_requests where cliente_id = 'a0000000-0000-0000-0000-000000000001'$$,
  'proposta com produto certo e preço livre é aceita — a margem do profissional é 2500 - 1400 de custo'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.aceitar_quote(
      'a0000000-0000-0000-0000-0000000000c1',
      'Rua Teste, 200',
      '{}'::jsonb
    )$$,
  'cliente aceita a proposta com o aparelho escolhido pelo profissional'
);

reset role;

select is(
  (select ji.produto_id from public.job_itens ji
     join public.jobs j on j.id = ji.job_id
    where j.cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  'a0000000-0000-0000-0000-0000000000a1'::uuid,
  'job_itens usa o produto escolhido pelo PROFISSIONAL, não um produto do cliente'
);
select is(
  (select ji.preco_venda_snapshot from public.job_itens ji
     join public.jobs j on j.id = ji.job_id
    where j.cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  2500.00::numeric(10,2),
  'preço cobrado do cliente é o que o profissional definiu, não o preco_venda do catálogo'
);
select is(
  (select ji.custo_snapshot from public.job_itens ji
     join public.jobs j on j.id = ji.job_id
    where j.cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  1400.00::numeric(10,2),
  'custo congelado é o custo real da distribuidora, não o preço livre do profissional'
);
select is(
  (select o.margem_produto from public.orders o
     join public.jobs j on j.id = o.job_id
    where j.cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  1100.00::numeric(10,2),
  'margem_produto = 2500 (cobrado) - 1400 (custo real) = 1100'
);
select is(
  (select count(*)::integer from public.purchase_orders po
     join public.orders o on o.id = po.order_id
     join public.jobs j   on j.id = o.job_id
    where j.cliente_id = 'a0000000-0000-0000-0000-000000000001'),
  1,
  'aceite gerou ordem de compra na distribuidora mesmo sem o cliente ter escolhido o produto'
);

-- ===========================================================================
-- Fluxo "já sabe o aparelho": preço vem 100%% do catálogo, profissional não
-- pode mexer nele.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','a0000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.criar_pedido_orcamento(
      'instalacao_com_equipamento','01310-100','São Paulo','Bela Vista',
      1,'proximos_dias','Quarto com aparelho escolhido','{}'::jsonb,'',0,
      array['a0000000-0000-0000-0000-000000000002'::uuid],
      '{}'::text[], -23.5505, -46.6333,
      '[{"ambiente":"Quarto","area_m2":"14","num_pessoas":"2","btu_recomendado":"9000","produto_id":"a0000000-0000-0000-0000-0000000000a1","quantidade":1}]'::jsonb,
      true
    )$$,
  'cliente cria pedido já sabendo o aparelho'
);

reset role;

select throws_ok(
  $$insert into public.quotes(quote_request_id, professional_id, tipo, valor_mao_obra, produto_id, valor_equipamento, validade_ate)
    select id, 'a0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00,
           'a0000000-0000-0000-0000-0000000000a1', 100.00, current_date + 7
      from public.quote_requests
     where cliente_id = 'a0000000-0000-0000-0000-000000000001' and sabe_aparelho = true$$,
  'O aparelho deste pedido já foi escolhido pelo cliente com preço de catálogo — sua proposta cobre apenas a mão de obra.',
  'profissional não pode definir produto/preço quando o cliente já escolheu o aparelho'
);

select lives_ok(
  $$insert into public.quotes(quote_request_id, professional_id, tipo, valor_mao_obra, validade_ate)
    select id, 'a0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00, current_date + 7
      from public.quote_requests
     where cliente_id = 'a0000000-0000-0000-0000-000000000001' and sabe_aparelho = true$$,
  'proposta só de mão de obra é aceita quando o cliente já escolheu o aparelho'
);

-- ===========================================================================
-- Catálogo sem preço não vaza `preco_venda`
-- ===========================================================================
select ok(
  not exists (
    select 1
      from public.buscar_produtos_marketplace_sem_preco(p_categoria => 'split') t
     where to_jsonb(t) ? 'preco_venda'
  ),
  'RPC sem preço não retorna a coluna preco_venda em nenhuma linha'
);
select is(
  (select categoria from public.buscar_produtos_marketplace_sem_preco(p_categoria => 'split') limit 1),
  'split',
  'catálogo sem preço filtra por categoria corretamente'
);

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(9);

-- ===========================================================================
-- Fixture: um cliente, um técnico, uma distribuidora com três produtos —
-- um com quantidade controlada (2 unidades), um com quantidade zerada, e um
-- em modo booleano legado (estoque_quantidade null).
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('e0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','eq-cliente@teste.local','',now(),now()),
('e0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','eq-tecnico@teste.local','',now(),now()),
('e0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','eq-dist@teste.local','',now(),now());

update public.profiles set role='cliente',      nome='Cliente Estoque'      where id='e0000000-0000-0000-0000-000000000001';
update public.profiles set role='profissional', nome='Técnico Estoque'      where id='e0000000-0000-0000-0000-000000000002';
update public.profiles set role='distribuidora',nome='Distribuidora Estoque' where id='e0000000-0000-0000-0000-000000000003';

insert into public.professionals(id,tipo,cidade,estado)
values ('e0000000-0000-0000-0000-000000000002','autonomo','São Paulo','SP');

insert into public.professional_skills(professional_id,specialty)
values ('e0000000-0000-0000-0000-000000000002','instalacao');

insert into public.professional_service_radius(professional_id,latitude,longitude,radius_km,location_label)
values ('e0000000-0000-0000-0000-000000000002',-23.550000,-46.633000,50,'Base Centro');

-- Verificado só DEPOIS de skills/raio: os dois disparam
-- `trg_skills_revalidacao`/`trg_areas_revalidacao`, que rebaixam de volta pra
-- 'em_analise' quando o dado relacionado muda depois da aprovação.
update public.professionals set verification_status = 'verificado'
 where id = 'e0000000-0000-0000-0000-000000000002';

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo)
values ('e0000000-0000-0000-0000-000000000003','Dist Estoque LTDA','São Paulo','SP',5,'verificado',true);

insert into public.products(id,marca,modelo,btu,categoria,preco_venda,custo,distributor_id,ativo,estoque_disponivel,estoque_quantidade,preco_manual) values
('e0000000-0000-0000-0000-0000000000b1','Marca Y','Split 9k com 2un', 9000,'split',2000.00,1400.00,'e0000000-0000-0000-0000-000000000003',true,true,2,true),
('e0000000-0000-0000-0000-0000000000b2','Marca Y','Split 9k zerado',  9000,'split',2000.00,1400.00,'e0000000-0000-0000-0000-000000000003',true,false,0,true),
('e0000000-0000-0000-0000-0000000000b3','Marca Y','Split 9k booleano',9000,'split',2000.00,1400.00,'e0000000-0000-0000-0000-000000000003',true,true,null,true);

-- ===========================================================================
-- `protege_produto` deriva o booleano a partir da quantidade
-- ===========================================================================
select is(
  (select estoque_disponivel from public.products where id = 'e0000000-0000-0000-0000-0000000000b2'),
  false,
  'produto com quantidade 0 nasce com estoque_disponivel = false, derivado pelo trigger'
);

-- ===========================================================================
-- Produto com quantidade insuficiente não sai da busca por engano, mas o
-- aceite reprova: pedido de 3 unidades de um produto com só 2 em estoque.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.criar_pedido_orcamento(
      'instalacao_com_equipamento','01310-100','São Paulo','Bela Vista',
      1,'proximos_dias','Sala com 3 unidades','{}'::jsonb,'',0,
      array['e0000000-0000-0000-0000-000000000002'::uuid],
      '{}'::text[], -23.5505, -46.6333,
      '[{"ambiente":"Sala","area_m2":"20","num_pessoas":"3","btu_recomendado":"9000","produto_id":"e0000000-0000-0000-0000-0000000000b1","quantidade":3}]'::jsonb,
      true
    )$$,
  'cliente pede 3 unidades de um produto com 2 em estoque (o catálogo não bloqueia isso na hora do pedido)'
);

reset role;

select lives_ok(
  $$insert into public.quotes(id, quote_request_id, professional_id, tipo, valor_mao_obra, validade_ate)
    select 'e0000000-0000-0000-0000-0000000000c1', id, 'e0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00, current_date + 7
      from public.quote_requests
     where cliente_id = 'e0000000-0000-0000-0000-000000000001' and descricao = 'Sala com 3 unidades'$$,
  'profissional propõe preço fechado (só mão de obra, aparelho já escolhido pelo cliente)'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);

select throws_ok(
  $$select public.aceitar_quote('e0000000-0000-0000-0000-0000000000c1', 'Rua Teste, 300', '{}'::jsonb)$$,
  'O equipamento escolhido para Sala não tem quantidade suficiente em estoque.',
  'aceite é reprovado quando a quantidade pedida excede o estoque controlado'
);

reset role;

select is(
  (select estoque_quantidade from public.products where id = 'e0000000-0000-0000-0000-0000000000b1'),
  2,
  'aceite reprovado não decrementa nada — estoque continua em 2'
);

-- ===========================================================================
-- Mesmo produto, pedido de 2 unidades (dentro do estoque): aceite passa e
-- decrementa exatamente a quantidade vendida.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.criar_pedido_orcamento(
      'instalacao_com_equipamento','01310-100','São Paulo','Bela Vista',
      1,'proximos_dias','Quarto com 2 unidades','{}'::jsonb,'',0,
      array['e0000000-0000-0000-0000-000000000002'::uuid],
      '{}'::text[], -23.5505, -46.6333,
      '[{"ambiente":"Quarto","area_m2":"14","num_pessoas":"2","btu_recomendado":"9000","produto_id":"e0000000-0000-0000-0000-0000000000b1","quantidade":2}]'::jsonb,
      true
    )$$,
  'cliente pede exatamente as 2 unidades disponíveis'
);

reset role;

select lives_ok(
  $$insert into public.quotes(id, quote_request_id, professional_id, tipo, valor_mao_obra, validade_ate)
    select 'e0000000-0000-0000-0000-0000000000c2', id, 'e0000000-0000-0000-0000-000000000002', 'preco_fechado', 500.00, current_date + 7
      from public.quote_requests
     where cliente_id = 'e0000000-0000-0000-0000-000000000001' and descricao = 'Quarto com 2 unidades'$$,
  'profissional propõe preço fechado para o segundo pedido'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-0000-0000-000000000001',true);

select lives_ok(
  $$select public.aceitar_quote('e0000000-0000-0000-0000-0000000000c2', 'Rua Teste, 300', '{}'::jsonb)$$,
  'aceite passa quando a quantidade pedida cabe no estoque'
);

reset role;

select is(
  (select estoque_quantidade from public.products where id = 'e0000000-0000-0000-0000-0000000000b1'),
  0,
  'estoque foi decrementado de 2 para 0 após a venda das 2 unidades'
);

select * from finish();
rollback;

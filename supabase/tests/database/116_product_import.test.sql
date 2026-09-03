begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(41);

-- ===========================================================================
-- Fixture: duas distribuidoras verificadas (A, B) e uma não verificada (C).
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('f1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pi-dist-a@teste.local','',now(),now()),
('f1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pi-dist-b@teste.local','',now(),now()),
('f1000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','pi-dist-c@teste.local','',now(),now());

update public.profiles set role='distribuidora', nome='Distribuidora Import A' where id='f1000000-0000-0000-0000-000000000001';
update public.profiles set role='distribuidora', nome='Distribuidora Import B' where id='f1000000-0000-0000-0000-000000000002';
update public.profiles set role='distribuidora', nome='Distribuidora Import C' where id='f1000000-0000-0000-0000-000000000003';

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo) values
('f1000000-0000-0000-0000-000000000001','Dist Import A LTDA','São Paulo','SP',5,'verificado',true),
('f1000000-0000-0000-0000-000000000002','Dist Import B LTDA','São Paulo','SP',5,'verificado',true),
('f1000000-0000-0000-0000-000000000003','Dist Import C LTDA','São Paulo','SP',5,'em_analise',true);

create temporary table t_chaves (rotulo text primary key, id uuid, chave text);
grant select, insert on t_chaves to authenticated;

-- ===========================================================================
-- Grants — a porta de escrita direta fica fechada; só RPC mexe nessas tabelas.
-- ===========================================================================
select ok(
  not has_table_privilege('authenticated', 'public.product_import_batches', 'INSERT'),
  'authenticated não insere direto em product_import_batches'
);
select ok(
  not has_table_privilege('authenticated', 'public.product_import_items', 'INSERT'),
  'authenticated não insere direto em product_import_items'
);
select ok(
  not has_column_privilege('authenticated', 'public.distributor_api_keys', 'key_hash', 'SELECT'),
  'key_hash nunca é legível, nem pelo dono da chave'
);

-- ===========================================================================
-- Chave de API: criação, validação, e verificação bloqueando distribuidora
-- não verificada.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$insert into t_chaves(rotulo, id, chave) select 'A', id, chave from public.criar_chave_api_distribuidora('ERP teste A')$$,
  'distribuidora A cria uma chave de API'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$insert into t_chaves(rotulo, id, chave) select 'C', id, chave from public.criar_chave_api_distribuidora('ERP teste C')$$,
  'distribuidora C (não verificada) também consegue criar uma chave — o bloqueio é na validação, não na criação'
);
reset role;

select is(
  (select distributor_id from public.validar_chave_api((select chave from t_chaves where rotulo = 'A'))),
  'f1000000-0000-0000-0000-000000000001'::uuid,
  'validar_chave_api resolve a distribuidora dona da chave'
);
select is(
  (select count(*) from public.validar_chave_api('fh_live_chave-que-nao-existe')),
  0::bigint,
  'chave inexistente não valida'
);
select is(
  (select count(*) from public.validar_chave_api((select chave from t_chaves where rotulo = 'C'))),
  0::bigint,
  'distribuidora não verificada não consegue sincronizar — mesma trava de distribuidora_ativa'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.revogar_chave_api_distribuidora((select id from t_chaves where rotulo = 'A'))$$,
  'distribuidora A revoga a própria chave'
);
reset role;

select is(
  (select count(*) from public.validar_chave_api((select chave from t_chaves where rotulo = 'A'))),
  0::bigint,
  'chave revogada para de validar'
);

-- ===========================================================================
-- Ingestão: idempotência de reenvio e SKU duplicado no mesmo payload.
-- ===========================================================================
select lives_ok(
  $$select public.ingerir_lote_produtos(
      'f1000000-0000-0000-0000-000000000001'::uuid,
      'sync-1',
      '[
        {"sku_distribuidor":"SKU-1","marca":"Midea","modelo":"Springer 9000 BTU Inverter","btu":9000,"categoria":"inverter","custo":1450.00,"estoque_quantidade":10,"ativo":true},
        {"sku_distribuidor":"SKU-2","marca":"Midea","modelo":"Sem custo informado","btu":9000,"categoria":"inverter","estoque_quantidade":5,"ativo":true}
      ]'::jsonb
    )$$,
  'ingerir_lote_produtos grava o lote cru (batch1)'
);

-- Guarda o id do batch1 num lugar que não depende de RLS pra ser lido: os
-- testes de autorização abaixo chamam `aplicar_lote_importacao` como
-- distribuidora B, que não ENXERGA a linha de A (RLS) — sem isso, o id
-- resolveria pra NULL antes mesmo de chegar na função, e o teste acabaria
-- checando "lote não encontrado" em vez da recusa de autorização de verdade.
create temporary table t_lotes (rotulo text primary key, id uuid);
grant select on t_lotes to authenticated;
insert into t_lotes(rotulo, id)
select 'batch1', id from public.product_import_batches
 where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1';

select is(
  (select public.ingerir_lote_produtos('f1000000-0000-0000-0000-000000000001'::uuid, 'sync-1', '[{"sku_distribuidor":"outro"}]'::jsonb)),
  (select id from t_lotes where rotulo = 'batch1'),
  'reenvio do mesmo idempotency_key devolve o batch já criado, não duplica'
);
select is(
  (select count(*) from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'só existe um batch pra distribuidora A até aqui'
);

select throws_ok(
  $$select public.ingerir_lote_produtos(
      'f1000000-0000-0000-0000-000000000001'::uuid, 'sync-dup',
      '[{"sku_distribuidor":"SKU-X","custo":1},{"sku_distribuidor":"SKU-X","custo":2}]'::jsonb
    )$$,
  'Código de produto duplicado dentro do mesmo lote.',
  'SKU repetido no mesmo payload é rejeitado na ingestão'
);

-- ===========================================================================
-- Validação item a item.
-- ===========================================================================
select lives_ok(
  $$select public.validar_item_importacao((
      select id from public.product_import_items
       where sku_distribuidor = 'SKU-1'
         and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1')
    ))$$,
  'valida o item SKU-1'
);
select lives_ok(
  $$select public.validar_item_importacao((
      select id from public.product_import_items
       where sku_distribuidor = 'SKU-2'
         and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1')
    ))$$,
  'valida o item SKU-2'
);

select is(
  (select status from public.product_import_items
    where sku_distribuidor = 'SKU-1' and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1')),
  'valid',
  'SKU-1 (dados completos) fica válido'
);
select is(
  (select action from public.product_import_items
    where sku_distribuidor = 'SKU-1' and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1')),
  'insert',
  'SKU-1 é reconhecido como produto novo (sem produto existente com esse SKU ainda)'
);
select is(
  (select status from public.product_import_items
    where sku_distribuidor = 'SKU-2' and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1')),
  'error',
  'SKU-2 (sem custo) fica com erro'
);

select lives_ok(
  $$select public.fechar_validacao_lote((select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1'))$$,
  'fecha a validação do batch1'
);
select is(
  (select status from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1'),
  'ready_for_review',
  'batch1 pronto pra revisão'
);
select is(
  (select valid_items from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1'),
  1,
  'batch1 com 1 item válido'
);
select is(
  (select error_items from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1'),
  1,
  'batch1 com 1 item com erro'
);

-- ===========================================================================
-- Aplicação: isolamento entre distribuidoras, e só o item válido vira produto.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.aplicar_lote_importacao((select id from t_lotes where rotulo = 'batch1'))$$,
  'Você não tem acesso a este lote.',
  'distribuidora B não consegue aplicar o lote de A'
);
select is(
  (select count(*) from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1'),
  0::bigint,
  'RLS já esconde o lote de A antes mesmo da RPC recusar — B não enxerga a linha'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.aplicar_lote_importacao((select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-1'))$$,
  'distribuidora A aplica o próprio lote'
);
reset role;

select is(
  (select count(*) from public.products where sku_distribuidor = 'SKU-1' and distributor_id = 'f1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'item válido (SKU-1) virou produto'
);
select is(
  (select count(*) from public.products where sku_distribuidor = 'SKU-2'),
  0::bigint,
  'item com erro (SKU-2) não virou produto'
);
select is(
  (select preco_venda from public.products where sku_distribuidor = 'SKU-1' and distributor_id = 'f1000000-0000-0000-0000-000000000001'),
  (select round(1450.00 * (1 + coalesce((select markup_produto_pct from public.platform_config), 0.25)), 2)),
  'preço de venda derivado do custo pelo markup da plataforma, igual ao cadastro manual'
);

-- ===========================================================================
-- Segundo sync do mesmo SKU: atualiza o produto existente, não duplica.
-- ===========================================================================
select lives_ok(
  $$select public.ingerir_lote_produtos(
      'f1000000-0000-0000-0000-000000000001'::uuid, 'sync-2',
      '[{"sku_distribuidor":"SKU-1","marca":"Midea","modelo":"Springer 9000 BTU Inverter","btu":9000,"categoria":"inverter","custo":1600.00,"estoque_quantidade":8,"ativo":true}]'::jsonb
    )$$,
  'ingere um segundo lote (sync-2) com o mesmo SKU-1, custo diferente'
);
select lives_ok(
  $$select public.validar_item_importacao((
      select id from public.product_import_items
       where sku_distribuidor = 'SKU-1'
         and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-2')
    ))$$,
  'valida o item do segundo sync'
);
select is(
  (select action from public.product_import_items
    where sku_distribuidor = 'SKU-1' and batch_id = (select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-2')),
  'update',
  'segundo sync do mesmo SKU é reconhecido como atualização, não produto novo'
);

select lives_ok(
  $$select public.fechar_validacao_lote((select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-2'))$$,
  'fecha a validação do batch2'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.aplicar_lote_importacao((select id from public.product_import_batches where distributor_id = 'f1000000-0000-0000-0000-000000000001' and idempotency_key = 'sync-2'))$$,
  'distribuidora A aplica o segundo lote'
);
reset role;

select is(
  (select count(*) from public.products where sku_distribuidor = 'SKU-1' and distributor_id = 'f1000000-0000-0000-0000-000000000001'),
  1::bigint,
  'ainda existe só um produto com o SKU-1 — o segundo sync atualizou, não duplicou'
);
select is(
  (select custo from public.products where sku_distribuidor = 'SKU-1' and distributor_id = 'f1000000-0000-0000-0000-000000000001'),
  1600.00::numeric,
  'custo do produto foi atualizado pelo segundo sync'
);

-- ===========================================================================
-- Upload manual (20260903150000): sessão autenticada só importa em nome de
-- si mesma — mesma trava dupla de aplicar_lote_importacao/rejeitar_lote_importacao.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.ingerir_lote_produtos(
      'f1000000-0000-0000-0000-000000000001'::uuid, 'sync-b-tentando-importar-para-a',
      '[{"sku_distribuidor":"X"}]'::jsonb
    )$$,
  'Você não tem acesso para importar em nome desta distribuidora.',
  'distribuidora B autenticada não consegue importar planilha em nome de A'
);
reset role;

select is(
  (select count(*) from public.product_import_batches where idempotency_key = 'sync-b-tentando-importar-para-a'),
  0::bigint,
  'a tentativa de B não criou nenhum batch'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.ingerir_lote_produtos(
      'f1000000-0000-0000-0000-000000000001'::uuid, 'sync-manual-a',
      '[{"sku_distribuidor":"SKU-MANUAL-1","marca":"Midea","modelo":"Upload manual teste","btu":9000,"categoria":"split","custo":900.00,"ativo":true}]'::jsonb
    )$$,
  'distribuidora A importa em nome de si mesma via sessão autenticada (upload manual)'
);
reset role;

-- ===========================================================================
-- Rate limit — reusa consume_rate_limit (20260813184012_resilience_phase5),
-- mesma função já testada em outro lugar; aqui só confirma que o escopo
-- novo (product_import_batch_hour) se comporta igual.
-- ===========================================================================
-- Função em LATERAL sem correlação com a linha externa arrisca ser
-- materializada e reaproveitada pelo planner em vez de reexecutada — a forma
-- confiável de chamar uma função volátil N vezes é no target list de uma
-- query cujo FROM tem N linhas.
select lives_ok(
  $$select public.consume_rate_limit('test_product_import_rate', 'f1000000-0000-0000-0000-000000000001'::uuid, 20, 3600) from generate_series(1,20)$$,
  'consome os 20 hits permitidos na janela'
);
select throws_ok(
  $$select public.consume_rate_limit('test_product_import_rate', 'f1000000-0000-0000-0000-000000000001'::uuid, 20, 3600)$$,
  'Limite de solicitações excedido. Aguarde antes de tentar novamente.',
  '21ª chamada na mesma janela estoura o limite'
);

select * from finish();
rollback;

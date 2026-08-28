begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(24);

select ok(
  not has_function_privilege('authenticated', 'public.preparar_repasse_distribuidora(uuid)', 'execute'),
  'preparar_repasse_distribuidora não é chamável pela Data API'
);

-- ===========================================================================
-- Fixture: um técnico comprador (compra avulsa, sem RFQ), duas distribuidoras
-- (uma com Pix, outra com TED, uma terceira sem método algum) — cada uma com
-- um produto, pra provar que o repasse é independente por distribuidora.
-- ===========================================================================
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,created_at,updated_at) values
('f1000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rd-tecnico@teste.local','',now(),now()),
('f1000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rd-dist-pix@teste.local','',now(),now()),
('f1000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rd-dist-ted@teste.local','',now(),now()),
('f1000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rd-dist-sem@teste.local','',now(),now());

update public.profiles set role='profissional', nome='Técnico Repasse Dist' where id='f1000000-0000-0000-0000-000000000001';
update public.profiles set role='distribuidora',nome='Distribuidora Pix'     where id='f1000000-0000-0000-0000-000000000002';
update public.profiles set role='distribuidora',nome='Distribuidora TED'    where id='f1000000-0000-0000-0000-000000000003';
update public.profiles set role='distribuidora',nome='Distribuidora Sem'    where id='f1000000-0000-0000-0000-000000000004';

insert into public.professionals(id,tipo,cidade,estado)
values ('f1000000-0000-0000-0000-000000000001','autonomo','São Paulo','SP');

insert into public.distributors(id,razao_social,cidade,estado,prazo_entrega_dias,verification_status,ativo) values
('f1000000-0000-0000-0000-000000000002','Dist Pix LTDA','São Paulo','SP',5,'verificado',true),
('f1000000-0000-0000-0000-000000000003','Dist TED LTDA','São Paulo','SP',5,'verificado',true),
('f1000000-0000-0000-0000-000000000004','Dist Sem Config LTDA','São Paulo','SP',5,'verificado',true);

insert into public.products(id,marca,modelo,btu,categoria,preco_venda,custo,distributor_id,ativo,estoque_disponivel,preco_manual) values
('f1000000-0000-0000-0000-0000000000a1','Marca P','Peça Pix', 9000,'split',1000.00,700.00,'f1000000-0000-0000-0000-000000000002',true,true,true),
('f1000000-0000-0000-0000-0000000000a2','Marca T','Peça TED', 9000,'split', 500.00,300.00,'f1000000-0000-0000-0000-000000000003',true,true,true),
('f1000000-0000-0000-0000-0000000000a3','Marca S','Peça Sem', 9000,'split', 400.00,250.00,'f1000000-0000-0000-0000-000000000004',true,true,true);

-- ===========================================================================
-- Cadastro de forma de repasse
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
select lives_ok(
  $$select public.salvar_repasse_pix_distribuidora('11122233344', 'cpf')$$,
  'distribuidora cadastra chave PIX própria'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000003',true);
select lives_ok(
  $$select public.salvar_repasse_bancario_distribuidora('237','1234','98765','1','conta_corrente','Empresa TED LTDA','55666777000199')$$,
  'distribuidora cadastra transferência bancária (TED) própria'
);
reset role;

select is(
  (select metodo_repasse from public.distributors where id = 'f1000000-0000-0000-0000-000000000002'),
  'pix', 'metodo_repasse gravado como pix'
);
select is(
  (select banco_conta from public.distributors where id = 'f1000000-0000-0000-0000-000000000003'),
  '98765', 'conta bancária gravada corretamente'
);

-- Trocar de método limpa o outro (CHECK de consistência no banco).
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
select lives_ok(
  $$select public.salvar_repasse_bancario_distribuidora('001','4321','11111','2','conta_poupanca','Fulano de Tal','22233344400')$$,
  'distribuidora troca de Pix pra TED'
);
reset role;
select is(
  (select chave_pix from public.distributors where id = 'f1000000-0000-0000-0000-000000000002'),
  null, 'trocar pra TED limpa a chave PIX anterior'
);

-- ===========================================================================
-- Compra avulsa com itens das TRÊS distribuidoras — prova que o repasse é
-- por distribuidora, não por order inteiro.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  $$select public.criar_compra_avulsa(
      '[{"produtoId":"f1000000-0000-0000-0000-0000000000a1","quantidade":1},
        {"produtoId":"f1000000-0000-0000-0000-0000000000a2","quantidade":1},
        {"produtoId":"f1000000-0000-0000-0000-0000000000a3","quantidade":1}]'::jsonb,
      '01310-100','São Paulo','Rua Teste, 500'
    )$$,
  'técnico compra peças de três distribuidoras diferentes numa compra só'
);
reset role;

-- Capturado agora, fora de qualquer role restrito: `purchase_orders` só tem
-- policy de SELECT para a própria distribuidora (po_dist_read) — o
-- comprador não lê a tabela direto, só via view `entregas_cliente`. Guardar
-- os ids aqui evita subquery sob RLS mais tarde, que voltaria NULL.
create temporary table rd_ids (
  order_id uuid, charge_id uuid,
  po_pix uuid, po_ted uuid, po_sem uuid
) on commit drop;
-- Lida sob `set local role authenticated` mais abaixo (contestação) — sem
-- grant explícito, um papel diferente do dono (a sessão de teste) recebe
-- "permission denied", já que privilégio de tabela comum (não RLS) não é
-- concedido por padrão a outros roles.
grant select on rd_ids to authenticated;
insert into rd_ids (order_id)
  select o.id from public.orders o
    join public.jobs j on j.id = o.job_id
   where j.cliente_id = 'f1000000-0000-0000-0000-000000000001' and j.job_type = 'compra_equipamento';

update rd_ids set
  po_pix = (select id from public.purchase_orders where distributor_id = 'f1000000-0000-0000-0000-000000000002'),
  po_ted = (select id from public.purchase_orders where distributor_id = 'f1000000-0000-0000-0000-000000000003'),
  po_sem = (select id from public.purchase_orders where distributor_id = 'f1000000-0000-0000-0000-000000000004');

update rd_ids set charge_id = public.preparar_cobranca_order(order_id, 'asaas', 'PIX', 'repasse-dist-charge-1');
select lives_ok(
  format('select public.vincular_cobranca_gateway(%L::uuid, %L, %L, current_date + 2)',
    (select charge_id from rd_ids), 'pay_repasse_dist_001', 'https://sandbox.asaas.com/i/rd1'),
  'vincula cobrança da compra avulsa ao gateway'
);
select public.processar_evento_gateway(public.registrar_evento_gateway(
  'asaas','evt_repasse_dist_001','PAYMENT_RECEIVED','pay_repasse_dist_001',1900,'{}'::jsonb, now()
));

-- ===========================================================================
-- Nada de repasse antes da entrega ser confirmada
-- ===========================================================================
select is(
  (select count(*)::integer from public.payment_transfers where purchase_order_id is not null),
  0, 'nenhum repasse de distribuidora existe antes de qualquer entrega'
);

-- ===========================================================================
-- Distribuidora com Pix (agora TED, trocou acima) confirma entrega
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000002'),
  'confirmado'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000002'),
  'faturado'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000002'),
  'enviado', null, null, 'https://rastreio.exemplo.com/rd1'
);
select lives_ok(
  $$select public.avancar_purchase_order(
      (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000002'),
      'entregue'
    )$$,
  'distribuidora confirma entrega própria'
);
reset role;

select is(
  (select status from public.payment_transfers
     where beneficiary_id = 'f1000000-0000-0000-0000-000000000002'),
  'pending_creation',
  'entrega confirmada com forma de repasse cadastrada (TED) gera transferência pendente, não confirmada direto'
);
select is(
  (select metodo from public.payment_transfers where beneficiary_id = 'f1000000-0000-0000-0000-000000000002'),
  'ted', 'transferência gravada com o método atual (TED, depois da troca)'
);
select is(
  (select amount from public.payment_transfers where beneficiary_id = 'f1000000-0000-0000-0000-000000000002'),
  700.00::numeric(12,2),
  'valor do repasse é o custo da distribuidora (o que ela recebe), não o preço de venda'
);
select ok(
  (select scheduled_for from public.payment_transfers where beneficiary_id = 'f1000000-0000-0000-0000-000000000002') > now(),
  'repasse da distribuidora também respeita a janela de contenção — não dispara na hora'
);

-- ===========================================================================
-- Distribuidora SEM forma de repasse cadastrada: transferência nasce failed,
-- sem travar a entrega em si.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000004',true);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000004'),
  'confirmado'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000004'),
  'faturado'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000004'),
  'enviado', null, null, 'https://rastreio.exemplo.com/rd2'
);
select public.avancar_purchase_order(
  (select po.id from public.purchase_orders po where po.distributor_id = 'f1000000-0000-0000-0000-000000000004'),
  'entregue'
);
reset role;

select is(
  (select status from public.payment_transfers where beneficiary_id = 'f1000000-0000-0000-0000-000000000004'),
  'failed',
  'distribuidora sem forma de repasse cadastrada gera transferência já falha, sem travar a entrega'
);
select is(
  (select last_error from public.payment_transfers where beneficiary_id = 'f1000000-0000-0000-0000-000000000004'),
  'Distribuidora sem forma de repasse cadastrada.',
  'motivo da falha é claro pro admin em /admin/repasses'
);

-- ===========================================================================
-- Contestação: cliente trava o repasse de UMA entrega específica
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  format(
    $$select public.contestar_entrega_purchase_order(%L::uuid, 'aparelho chegou quebrado')$$,
    (select po_pix from rd_ids)
  ),
  'comprador contesta a entrega da distribuidora com Pix/TED'
);
reset role;

select is(
  (select status from public.payment_transfers where beneficiary_id = 'f1000000-0000-0000-0000-000000000002'),
  'cancelled',
  'contestação cancela o repasse pendente daquela entrega específica'
);
select is(
  (select tipo from public.job_disputes where purchase_order_id = (select po_pix from rd_ids)),
  'contestacao_entrega_distribuidora',
  'disputa registrada com o tipo certo, aparece em /admin/disputas'
);
select is(
  (select situacao_repasse from public.job_disputes where purchase_order_id = (select po_pix from rd_ids)),
  'bloqueado',
  'disputa registra que o repasse foi travado com sucesso'
);

-- Contestar a entrega da distribuidora SEM repasse (falhou por falta de
-- config) não trava em exceção — fica sinalizada como sem_repasse.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000001',true);
select lives_ok(
  format(
    $$select public.contestar_entrega_purchase_order(%L::uuid, 'nada foi enviado')$$,
    (select po_sem from rd_ids)
  ),
  'contestar entrega sem repasse bloqueável não lança exceção — cria disputa sinalizada'
);
reset role;
select is(
  (select situacao_repasse from public.job_disputes where purchase_order_id = (select po_sem from rd_ids)),
  'sem_repasse',
  'disputa sem repasse bloqueável fica sinalizada, não gera erro'
);

-- Outro usuário (não é o comprador) não pode contestar.
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000002',true);
select throws_ok(
  format(
    $$select public.contestar_entrega_purchase_order(%L::uuid, 'tentativa indevida')$$,
    (select po_ted from rd_ids)
  ),
  'Entrega não encontrada.',
  'quem não é o comprador não consegue contestar a entrega'
);
reset role;

select * from finish();
rollback;

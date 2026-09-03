begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(1);

-- ============================================================================
-- Guarda-chuva de segurança: toda função `security definer` do schema
-- `public` executável por `anon`/`authenticated` precisa estar nesta lista,
-- revisada manualmente.
--
-- Motivação real: `registrar_lancamento_financeiro` (financeiro, escreve
-- direto no ledger) ganhou uma sobrecarga nova em 20260818140000 (parâmetro
-- a mais muda a identidade da função para o Postgres) e a sobrecarga nova
-- NUNCA recebeu o `revoke` que a antiga tinha — `create or replace` não
-- herda grants de uma sobrecarga diferente. Ficou aberta para `anon`/
-- `authenticated` em produção até ser corrigida em 20260825090000. Nenhum
-- teste pegava isso automaticamente; só uma varredura genérica pega.
--
-- Este teste NÃO é uma auditoria função-por-função das 85 abaixo — é uma
-- fotografia do estado revisado em 2026-08-29. Qualquer função NOVA que
-- apareça fora desta lista falha o teste até alguém revisar de propósito e
-- adicionar aqui (ou corrigir o grant, se for o próximo bug do mesmo tipo).
-- ============================================================================

create temporary table security_definer_esperado (sig text) on commit drop;
insert into security_definer_esperado (sig) values
  ('abrir_conversa(p_professional_id uuid)'),
  ('abrir_conversa_contextual(p_professional_id uuid, p_quote_request_id uuid, p_job_id uuid)'),
  ('aceitar_quote(p_quote_id uuid, p_endereco text, p_detalhes jsonb)'),
  ('adiar_follow_up(p_task_id uuid, p_due_at timestamp with time zone)'),
  ('admin_intervir_repasse(p_transfer_id uuid, p_acao text, p_motivo text)'),
  ('alterar_papel_usuario(p_user_id uuid, p_new_role text, p_reason text)'),
  ('aplicar_lote_importacao(p_batch_id uuid)'),
  ('aprovar_orcamento_final(p_job_final_quote_id uuid)'),
  ('atribuir_pmoc(p_plan_id uuid, p_professional_id uuid)'),
  ('avancar_purchase_order(p_purchase_order_id uuid, p_status text, p_codigo_rastreio text, p_nota_fiscal_url text, p_link_rastreio text)'),
  ('bump_jobs_completed()'),
  ('buscar_profissionais_marketplace(p_cep text, p_specialty text, p_query text, p_sort text, p_require_verified boolean, p_limit integer, p_offset integer, p_latitude double precision, p_longitude double precision)'),
  ('cancelar_agendamento(p_appointment_id uuid, p_reason text)'),
  ('cancelar_pedido_orcamento(p_quote_request_id uuid, p_reason text)'),
  ('cancelar_pmoc(p_plan_id uuid, p_reason text)'),
  ('checar_limite_itens_pedido()'),
  ('cliente_da_purchase_order(p_order_id uuid)'),
  ('conclui_compra_avulsa_entregue()'),
  ('concluir_follow_up(p_task_id uuid, p_outcome text, p_notes text)'),
  ('concluir_visita_pmoc(p_visit_id uuid, p_notes text)'),
  ('configurar_feature_flag(p_flag_key text, p_region_slug text, p_enabled boolean, p_rollout_percentage integer, p_reason text)'),
  ('consumir_limite_assistente()'),
  ('contestar_entrega_purchase_order(p_purchase_order_id uuid, p_motivo text)'),
  ('contestar_execucao_job(p_job_id uuid, p_motivo text)'),
  ('criar_chave_api_distribuidora(p_nome text)'),
  ('criar_compra_avulsa(p_itens jsonb, p_cep text, p_cidade text, p_endereco text)'),
  ('criar_follow_up(p_quote_request_id uuid, p_due_at timestamp with time zone, p_title text)'),
  ('criar_order(p_job_id uuid, p_preco_servico numeric)'),
  ('criar_pedido_orcamento(p_job_type text, p_cep text, p_cidade text, p_bairro text, p_quantidade integer, p_urgencia text, p_descricao text, p_detalhes jsonb, p_produto_id text, p_btu_recomendado integer, p_profissionais_ids uuid[], p_fotos text[], p_latitude double precision, p_longitude double precision, p_itens jsonb, p_sabe_aparelho boolean)'),
  ('definir_verificacao(p_entity_type text, p_entity_id uuid, p_status text, p_reason text)'),
  ('destinatario_do_pedido(p_quote_request_id uuid)'),
  ('dispara_repasse_ao_concluir()'),
  ('dispara_repasse_ao_entregar()'),
  ('distribuidora_ativa(p_distributor_id uuid)'),
  ('dono_do_lote_importacao(p_batch_id uuid)'),
  ('dono_do_pedido(p_quote_request_id uuid)'),
  ('eh_admin()'),
  ('enviar_orcamento_final(p_job_id uuid, p_valor_servico numeric, p_observacoes text)'),
  ('feature_enabled(p_flag_key text, p_region_slug text, p_subject_id text)'),
  ('finalizar_execucao_servico(p_job_id uuid)'),
  ('handle_new_user()'),
  ('handoff_liberado(p_conversation_id uuid)'),
  ('ingerir_lote_produtos(p_distributor_id uuid, p_idempotency_key text, p_itens jsonb)'),
  ('marca_job_avaliado()'),
  ('marcar_conversa_lida(p_conversation_id uuid)'),
  ('marcar_notificacao_lida(p_id uuid)'),
  ('marcar_notificacoes_lidas()'),
  ('meu_cpf_cnpj_professional()'),
  ('minha_assinatura_atual()'),
  ('minha_chave_pix()'),
  ('minha_config_repasse_distribuidora()'),
  ('moderar_review(p_tabela text, p_id uuid, p_ocultar boolean, p_motivo text)'),
  ('notifica_purchase_order_atualizada()'),
  ('notifica_purchase_order_criada()'),
  ('notificar_assinatura_vencida()'),
  ('notificar_pagamento_recebido()'),
  ('obter_cnpj_distribuidora(p_distributor_id uuid)'),
  ('obter_documento_verificacao(p_professional_id uuid)'),
  ('obter_funil_marketplace(p_days integer, p_city text, p_end_date timestamp with time zone)'),
  ('obter_receita_gmv_mensal(p_meses integer)'),
  ('obter_saude_publica()'),
  ('plano_permite(p_professional_id uuid, p_feature text)'),
  ('pode_ler_documento_verificacao(p_storage_path text)'),
  ('pode_ler_foto_orcamento(p_storage_path text)'),
  ('pode_propor(p_quote_request_id uuid)'),
  ('propor_agendamento(p_job_id uuid, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_notes text)'),
  ('propor_pmoc_profissional(p_client_id uuid, p_company_name text, p_site_name text, p_cep text, p_cidade text, p_equipment_count integer, p_interval_months integer, p_price_per_visit numeric, p_first_due_date date, p_notes text)'),
  ('recalc_skill_rating()'),
  ('recomendar_manutencao(p_equipment_id uuid, p_due_on date, p_reason text)'),
  ('recusar_orcamento_final(p_job_final_quote_id uuid, p_motivo text)'),
  ('recusar_pedido_orcamento(p_quote_request_id uuid, p_reason text)'),
  ('registrar_interesse_plano(p_slug text, p_ciclo text)'),
  ('rejeitar_lote_importacao(p_batch_id uuid)'),
  ('reputacao_distribuidora(p_distributor_id uuid)'),
  ('resolver_disputa_rejeitar(p_dispute_id uuid, p_nota_admin text)'),
  ('responder_agendamento(p_appointment_id uuid, p_accept boolean, p_reason text)'),
  ('responder_pmoc(p_plan_id uuid, p_accept boolean, p_price_per_visit numeric, p_first_due_date date)'),
  ('responder_proposta_pmoc(p_plan_id uuid, p_accept boolean, p_reason text)'),
  ('revelar_contato(p_conversation_id uuid)'),
  ('revogar_chave_api_distribuidora(p_id uuid)'),
  ('salvar_chave_pix(p_chave text, p_tipo text)'),
  ('salvar_execucao_servico(p_job_id uuid, p_checklist jsonb, p_materials jsonb, p_measurements jsonb, p_evidence_paths text[], p_notes text, p_warranty_until date, p_maintenance_due date)'),
  ('salvar_perfil_distribuidora(p_razao_social text, p_cnpj text, p_cidade text, p_prazo_entrega_dias integer)'),
  ('salvar_repasse_bancario_distribuidora(p_banco_codigo text, p_agencia text, p_conta text, p_conta_digito text, p_conta_tipo text, p_titular_nome text, p_titular_documento text)'),
  ('salvar_repasse_pix_distribuidora(p_chave text, p_tipo text)'),
  ('solicitar_cancelamento_job_pago(p_job_id uuid, p_motivo text)'),
  ('solicitar_pmoc(p_company_name text, p_site_name text, p_cep text, p_cidade text, p_equipment_count integer, p_interval_months integer, p_notes text)'),
  ('touch_conversa()'),
  ('touch_quote_request_from_item()'),
  ('valida_aparelho_da_proposta()'),
  ('vincular_equipamento_pmoc(p_equipment_id uuid, p_plan_id uuid)');

select set_eq(
  $$
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
  $$,
  $$select sig from security_definer_esperado$$,
  'toda função security definer executável por anon/authenticated está na allowlist revisada — nova função aqui exige revisão manual deliberada'
);

select * from finish();
rollback;

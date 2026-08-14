-- A policy RLS só filtra linhas depois que o papel possui privilégio SQL.
-- As migrations iniciais criaram policies, mas não materializaram os grants
-- esperados pela Data API local. Esta allowlist abre somente operações usadas
-- pela aplicação; tabelas append-only e escritas por RPC continuam fechadas.

-- Vitrine pública. `professionals.cnpj` e estado comercial da assinatura ficam
-- fora da allowlist mesmo quando a policy permite ler a linha.
grant select on public.profiles to anon, authenticated;

revoke select on public.professionals from anon, authenticated;
grant select (
  id, tipo, razao_social, bio, cidade, estado, verification_status, verified_at,
  created_at, updated_at, anos_experiencia, banner_url
) on public.professionals to anon, authenticated;

grant select on
  public.professional_skills,
  public.service_areas,
  public.portfolio_items,
  public.reviews,
  public.subscription_plans,
  public.city_billing_config,
  public.featured_placements,
  public.skill_tags,
  public.professional_tags,
  public.distributor_areas
to anon, authenticated;

-- Configuração necessária no portal da distribuidora, sem expor os demais
-- parâmetros operacionais da plataforma.
grant select (id, markup_produto_pct) on public.platform_config to authenticated;

-- Perfil e onboarding. RLS limita cada escrita ao dono; triggers preservam
-- papel, verificação, assinatura e demais colunas controladas.
grant update on public.profiles to authenticated;
grant select, insert, update on public.profile_private to authenticated;
grant insert, update on public.professionals to authenticated;
grant insert, update, delete on public.professional_skills to authenticated;
grant insert, update, delete on public.service_areas to authenticated;
grant insert, update, delete on public.portfolio_items to authenticated;
grant insert, update, delete on public.professional_tags to authenticated;

-- Jornada de contratação e atendimento.
grant select, insert, update on public.jobs to authenticated;
grant select on public.orders to authenticated;
grant insert on public.reviews to authenticated;
grant select, insert on public.client_reviews to authenticated;

grant select on public.conversations to authenticated;
grant select, insert on public.messages to authenticated;
grant select, insert, delete on public.conversation_contact_consent to authenticated;

grant select, insert, update on public.quote_requests to authenticated;
grant select, insert, update on public.quote_request_targets to authenticated;
grant select, insert, delete on public.quote_request_photos to authenticated;
grant select, insert, update on public.quotes to authenticated;

-- Operação do profissional e da distribuidora.
grant select, insert, delete on public.expenses to authenticated;
grant insert, update on public.distributors to authenticated;
grant insert, delete on public.distributor_areas to authenticated;
grant insert, update on public.products to authenticated;
grant select on public.purchase_orders to authenticated;

-- Defesas explícitas para domínios que nunca aceitam escrita genérica.
revoke insert, update, delete on
  public.orders,
  public.purchase_orders,
  public.admin_audit_log,
  public.notification_outbox,
  public.quote_request_events,
  public.job_events,
  public.operational_cases,
  public.service_checklist_templates,
  public.service_executions,
  public.service_reports,
  public.follow_up_tasks,
  public.follow_up_events
from anon, authenticated;

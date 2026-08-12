-- ============================================================================
-- TRAVA DE INTEGRIDADE DA REPUTAÇÃO
--
-- Problema encontrado: as policies `skills_write_own` e `prof_write_self` são
-- `for all`, e RLS no Postgres é por LINHA — não existe restrição por COLUNA.
-- Resultado: o profissional podia escrever, direto pela API REST, a própria
--
--   · nota (professional_skills.rating_avg)
--   · quantidade de avaliações (rating_count)
--   · serviços concluídos (jobs_completed)
--   · verificação (professionals.verification_status / verified_at)
--   · assinatura (subscription_status / subscription_plan_id)
--
-- Ou seja: a parte julgada era quem escrevia a nota. Combinado com
-- `is_featured_eligible`, que exige nota >= 4 e 5 serviços, isso também abria a
-- porta para comprar destaque sem cumprir o piso de qualidade.
--
-- Não é hipótese: o próprio `scripts/seed-pros.mjs` faz exatamente isso com a
-- chave anônima. Por isso a base tem 640 avaliações declaradas para 2 reviews
-- reais.
--
-- Correção: triggers que PRESERVAM as colunas de confiança quando quem escreve
-- é o app (roles `authenticated` / `anon`). Escritas vindas dos triggers de
-- reputação, que são SECURITY DEFINER e rodam como dono do banco, passam.
--
-- Preservar em silêncio (em vez de lançar erro) é deliberado: nenhuma tela
-- existente quebra, o valor simplesmente não muda.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Regressão minha: ao redefinir bump_jobs_completed em 20260812120200 para
--    incluir troca_equipamento, o `security definer` de 20260811160000 se
--    perdeu — `create or replace function` substitui a definição inteira.
--    Sem ele, o contador pararia de funcionar assim que a trava abaixo entrasse.
-- ----------------------------------------------------------------------------
create or replace function public.bump_jobs_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'concluido' and old.status is distinct from 'concluido'
     and new.profissional_id is not null then
    update public.professional_skills ps
       set jobs_completed = jobs_completed + 1
     where ps.professional_id = new.profissional_id
       and ps.specialty = (case
             when new.job_type = 'instalacao_com_equipamento' then 'instalacao'
             when new.job_type = 'troca_equipamento'          then 'instalacao'
             else new.job_type end);
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Reputação só é escrita pelos triggers.
--
--    A função NÃO é security definer de propósito: precisa enxergar o papel
--    real de quem executa. Dentro de uma função SECURITY DEFINER (os triggers
--    de reputação), current_user vira o dono do banco e a escrita passa.
-- ----------------------------------------------------------------------------
create or replace function public.protege_reputacao_skill()
returns trigger
language plpgsql
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;  -- triggers de reputação, service_role, manutenção
  end if;

  if tg_op = 'INSERT' then
    new.rating_avg    := 0;
    new.rating_count  := 0;
    new.jobs_completed := 0;
  else
    new.rating_avg    := old.rating_avg;
    new.rating_count  := old.rating_count;
    new.jobs_completed := old.jobs_completed;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_skills_protege on public.professional_skills;
create trigger trg_skills_protege
  before insert or update on public.professional_skills
  for each row execute function public.protege_reputacao_skill();

-- ----------------------------------------------------------------------------
-- 3. Verificação e assinatura só mudam por admin.
--
--    Regra de produto preservada: editar o perfil rebaixa quem estava
--    verificado para 'em_analise'. Rebaixar pode; promover, não.
-- ----------------------------------------------------------------------------
create or replace function public.protege_confianca_professional()
returns trigger
language plpgsql
as $$
declare
  v_admin boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
  ) into v_admin;
  if v_admin then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.verification_status  := 'em_analise';
    new.verified_at          := null;
    new.subscription_status  := 'gratis';
    new.subscription_plan_id := null;
  else
    -- rebaixar de 'verificado' para 'em_analise' é permitido; o resto congela
    if not (old.verification_status = 'verificado' and new.verification_status = 'em_analise') then
      new.verification_status := old.verification_status;
    end if;
    new.verified_at          := old.verified_at;
    new.subscription_status  := old.subscription_status;
    new.subscription_plan_id := old.subscription_plan_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_professionals_protege on public.professionals;
create trigger trg_professionals_protege
  before insert or update on public.professionals
  for each row execute function public.protege_confianca_professional();

comment on function public.protege_reputacao_skill is
  'Impede que o profissional escreva a própria nota. RLS é por linha; esta trava é por coluna.';
comment on function public.protege_confianca_professional is
  'Impede autoverificação e automudança de assinatura. Só admin promove.';

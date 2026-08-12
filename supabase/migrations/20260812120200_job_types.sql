-- ============================================================================
-- Dois tipos de serviço novos no wizard:
--   · troca_equipamento → cliente troca o aparelho antigo por um novo
--   · outros            → não se encaixa nas opções; descrição em texto livre
--
-- `job_type` tem CHECK constraint, então sem esta migration o insert do wizard
-- seria recusado pelo banco.
-- ============================================================================
alter table public.jobs drop constraint if exists jobs_job_type_check;
alter table public.jobs add constraint jobs_job_type_check
  check (job_type in ('instalacao_com_equipamento', 'manutencao', 'remanejamento',
                      'limpeza', 'conserto', 'troca_equipamento', 'outros'));

-- ----------------------------------------------------------------------------
-- O contador de serviços concluídos mapeia job_type → specialty. Os tipos novos
-- precisam entrar no mapa, senão a troca de equipamento não credita reputação
-- a ninguém.
--
-- `outros` fica de fora de propósito: é um balde genérico e não corresponde a
-- nenhuma especialidade avaliável. O update simplesmente não casa linha alguma.
-- ----------------------------------------------------------------------------
create or replace function public.bump_jobs_completed()
returns trigger language plpgsql as $$
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
end; $$;

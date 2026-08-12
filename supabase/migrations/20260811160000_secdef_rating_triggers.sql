-- Correção: os triggers que mantêm agregados de reputação precisam ignorar o RLS.
-- recalc_skill_rating roda no contexto do CLIENTE (que insere a review), mas precisa
-- atualizar a skill do PROFISSIONAL — o RLS bloqueava silenciosamente. SECURITY DEFINER
-- faz a função rodar com privilégio do dono, contornando o RLS de forma controlada.

create or replace function public.recalc_skill_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.professional_skills ps
     set rating_avg = sub.avg_rating,
         rating_count = sub.cnt
    from (
      select avg(rating)::numeric(3,2) as avg_rating, count(*) as cnt
        from public.reviews
       where professional_id = new.professional_id
         and specialty = new.specialty
    ) sub
   where ps.professional_id = new.professional_id
     and ps.specialty = new.specialty;
  return new;
end;
$$;

-- bump_jobs_completed já funciona (o profissional é quem conclui), mas por robustez
-- também roda como definer — assim não depende de quem dispara a conclusão.
create or replace function public.bump_jobs_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'concluido' and old.status <> 'concluido'
     and new.profissional_id is not null then
    update public.professional_skills ps
       set jobs_completed = jobs_completed + 1
     where ps.professional_id = new.profissional_id
       and ps.specialty = (case
             when new.job_type = 'instalacao_com_equipamento' then 'instalacao'
             else new.job_type end);
  end if;
  return new;
end;
$$;

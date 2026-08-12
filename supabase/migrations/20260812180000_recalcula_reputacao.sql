-- ============================================================================
-- Reconstrói a reputação a partir dos dados reais.
--
-- Os agregados de `professional_skills` foram gravados direto pelo seed com a
-- chave anônima (ver 20260812170000_trava_reputacao), resultando em 640
-- avaliações declaradas para 2 reviews reais. Números forjados exibidos ao
-- cliente como se fossem histórico.
--
-- Aqui não zeramos cego: recalculamos do que existe de fato.
--   · rating_avg / rating_count  ← tabela `reviews`
--   · jobs_completed             ← `jobs` efetivamente concluídos
--
-- Quem não tem review nem serviço concluído vai a zero, que é a verdade.
--
-- Esta migration roda como dono do banco, então passa pelo trigger de proteção
-- criado na migration anterior — que só barra escritas de `authenticated`/`anon`.
--
-- IRREVERSÍVEL: os valores anteriores eram fabricados e não são recuperáveis.
-- Executado com autorização explícita do time.
-- ============================================================================

update public.professional_skills ps
   set rating_avg = coalesce((
         select avg(r.rating)::numeric(3,2)
           from public.reviews r
          where r.professional_id = ps.professional_id
            and r.specialty = ps.specialty
       ), 0),
       rating_count = coalesce((
         select count(*)
           from public.reviews r
          where r.professional_id = ps.professional_id
            and r.specialty = ps.specialty
       ), 0),
       jobs_completed = coalesce((
         select count(*)
           from public.jobs j
          where j.profissional_id = ps.professional_id
            and j.status in ('concluido', 'avaliado')
            and ps.specialty = (case
                  when j.job_type in ('instalacao_com_equipamento', 'troca_equipamento') then 'instalacao'
                  else j.job_type end)
       ), 0);

-- ----------------------------------------------------------------------------
-- Destaques patrocinados concedidos sobre a reputação forjada.
--
-- `is_featured_eligible` só é verificado no INSERT, então os registros antigos
-- continuariam ativos mesmo agora que os profissionais não cumprem o piso.
-- Além disso apontam para Fortaleza, praça que não atendemos — nunca chegaram a
-- renderizar, porque a busca filtra pela cidade da operação.
--
-- Desativados, não apagados: se algum for legítimo, basta voltar `ativo` a true.
-- ----------------------------------------------------------------------------
update public.featured_placements fp
   set ativo = false
 where fp.ativo
   and not public.is_featured_eligible(fp.professional_id, fp.specialty);

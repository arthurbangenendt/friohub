-- ---------------------------------------------------------------------------
-- Diretório público de profissionais
--
-- Contexto: o marketplace não tinha vitrine navegável. Existia só
-- `/profissional/[id]` por link direto e quatro destaques na home — quem quisesse
-- "ver os profissionais antes de me cadastrar" não tinha para onde ir.
--
-- Por que uma view, e não a RPC que já existe: `buscar_profissionais_marketplace`
-- é a busca TRANSACIONAL. Ela exige CEP válido, filtra por área de cobertura e
-- tem `where auth.uid() is not null` no corpo, além de `revoke ... from anon`.
-- Abrir aquela função para anônimo mudaria a superfície de uma função
-- `security definer` que carrega o ranking quality_v1 e sinais operacionais
-- (taxa de resposta, carga ativa) que não são dado de vitrine.
--
-- Esta view NÃO amplia exposição: ela só agrega colunas que o `anon` já podia
-- ler desde 20260814114010_rest_api_role_grants.sql, e é `security_invoker`, de
-- modo que as policies de `professionals`, `profiles` e `professional_skills`
-- continuam sendo aplicadas com o papel de quem consulta. `cnpj` e o estado da
-- assinatura seguem fora — não estão no grant de coluna do anon, e a view nem os
-- referencia.
--
-- A agregação existe porque ordenar por nota exige SQL: em PostgREST não dá para
-- ordenar por agregado de tabela relacionada, e ordenar em JavaScript só a
-- página corrente produziria paginação incoerente.
--
-- Reversibilidade: `drop view public.diretorio_profissionais;`. Nenhuma tabela é
-- alterada.
-- ---------------------------------------------------------------------------

create view public.diretorio_profissionais
with (security_invoker = true) as
select
  pr.id,
  pr.tipo,
  pr.bio,
  pr.cidade,
  pr.estado,
  pr.verification_status,
  pr.anos_experiencia,
  pr.banner_url,
  pf.nome,
  pf.avatar_url,
  /* Média ponderada pelo número de avaliações. `max(rating_avg)` mostraria a
     melhor especialidade e faria um profissional com uma nota 5 isolada passar
     à frente de quem tem 4,7 em oitenta serviços. */
  coalesce(
    round(
      sum(ps.rating_avg * ps.rating_count) / nullif(sum(ps.rating_count), 0),
      2
    ),
    0
  )::numeric as nota,
  coalesce(sum(ps.rating_count), 0)::integer as avaliacoes,
  coalesce(sum(ps.jobs_completed), 0)::integer as servicos,
  coalesce(
    array_agg(distinct ps.specialty) filter (where ps.specialty is not null),
    '{}'::text[]
  ) as especialidades
from public.professionals pr
join public.profiles pf on pf.id = pr.id
left join public.professional_skills ps on ps.professional_id = pr.id
group by
  pr.id, pr.tipo, pr.bio, pr.cidade, pr.estado, pr.verification_status,
  pr.anos_experiencia, pr.banner_url, pf.nome, pf.avatar_url;

comment on view public.diretorio_profissionais is
  'Vitrine pública navegável. Não substitui buscar_profissionais_marketplace, que é o casamento por CEP com ranking quality_v1 e continua exclusivo de usuário autenticado.';

grant select on public.diretorio_profissionais to anon, authenticated;

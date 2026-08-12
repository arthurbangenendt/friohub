-- ============================================================================
-- Reputação do CLIENTE — avaliada pelo profissional.
--
-- Decisão do time: nota numérica + tags estruturadas e neutras, visíveis apenas
-- para profissionais. Sem texto livre e sem exibição pública.
--
-- O porquê importa: rótulo público de cliente ("rude") é dano à imagem, é
-- tratamento de dado pessoal com potencial discriminatório sob a LGPD, e afugenta
-- a demanda — que é o lado escasso de um marketplace novo. Tags fechadas dão ao
-- profissional a informação operacional de que ele precisa sem criar exposição:
-- "remarcou várias vezes" é um fato verificável; "cliente chato" é ofensa.
-- ============================================================================

create table if not exists public.client_reviews (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null unique references public.jobs (id) on delete cascade,
  professional_id uuid not null references public.professionals (id) on delete cascade,
  cliente_id      uuid not null references public.profiles (id) on delete cascade,
  rating          int  not null check (rating between 1 and 5),
  tags            text[] not null default '{}',
  created_at      timestamptz not null default now(),

  -- Vocabulário fechado: nada de texto livre entrando por aqui.
  constraint client_reviews_tags_validas check (
    tags <@ array[
      'pagou_em_dia', 'ambiente_preparado', 'comunicacao_clara', 'horario_respeitado',
      'remarcou_varias_vezes', 'ambiente_sem_acesso', 'demorou_a_responder', 'escopo_mudou'
    ]::text[]
  )
);

create index if not exists idx_client_reviews_cliente on public.client_reviews (cliente_id);

alter table public.client_reviews enable row level security;

/* Quem escreve: o profissional daquele job, e só depois de concluído.
   `with check` amarra o autor, o job e o cliente — não dá para avaliar um
   cliente com quem não se trabalhou. */
drop policy if exists "client_reviews_pro_insert" on public.client_reviews;
create policy "client_reviews_pro_insert" on public.client_reviews for insert
  with check (
    professional_id = auth.uid()
    and exists (
      select 1 from public.jobs j
       where j.id = job_id
         and j.profissional_id = auth.uid()
         and j.cliente_id = client_reviews.cliente_id
         and j.status in ('concluido', 'avaliado')
    )
  );

/* Quem lê: apenas profissionais e admin. O próprio cliente NÃO lê a avaliação
   que recebeu — foi decisão consciente, para a nota ser informação operacional
   entre profissionais e não virar atrito com o cliente. Visitante anônimo não
   tem acesso nenhum. */
drop policy if exists "client_reviews_pro_read" on public.client_reviews;
create policy "client_reviews_pro_read" on public.client_reviews for select
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.role in ('profissional', 'admin')
    )
  );

comment on table public.client_reviews is
  'Reputação do cliente vista pelo profissional. Nunca pública, nunca texto livre, não legível pelo próprio cliente.';

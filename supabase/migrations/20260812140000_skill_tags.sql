-- ============================================================================
-- Skills detalhadas do profissional — camada 2.
--
-- As 5 especialidades de `professional_skills` (instalacao, manutencao,
-- remanejamento, limpeza, conserto) continuam sendo o MOTOR do sistema: é por
-- elas que o wizard casa cliente e profissional, que a reputação é calculada e
-- que os destaques patrocinados são vendidos. Esta migration não encosta nelas.
--
-- O que entra aqui é a camada de DETALHE, que o profissional seleciona para se
-- diferenciar e que o cliente usa para escolher: quais equipamentos ele domina,
-- quais serviços executa, que tipo de ambiente atende e quais credenciais tem.
--
-- Um catálogo (em vez de texto livre) permite filtrar e buscar depois. Texto
-- livre viraria "cassete", "Cassete", "cassetes", "casete" e nada seria
-- agrupável.
-- ============================================================================

create table if not exists public.skill_tags (
  slug      text primary key,
  label     text not null,
  categoria text not null check (categoria in ('equipamento', 'servico', 'ambiente', 'credencial')),
  ordem     int  not null default 0,
  ativo     boolean not null default true
);

comment on table public.skill_tags is
  'Catálogo de skills detalhadas. Camada de diferenciação — o matching continua nas 5 especialidades de professional_skills.';

create table if not exists public.professional_tags (
  professional_id uuid not null references public.professionals (id) on delete cascade,
  tag_slug        text not null references public.skill_tags (slug) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (professional_id, tag_slug)
);

create index if not exists idx_professional_tags_tag on public.professional_tags (tag_slug);

alter table public.skill_tags        enable row level security;
alter table public.professional_tags enable row level security;

-- Catálogo e seleção são vitrine pública: visitante anônimo precisa ver no perfil.
create policy "skill_tags_read_all" on public.skill_tags for select using (ativo);
create policy "pro_tags_read_all"   on public.professional_tags for select using (true);
create policy "pro_tags_write_own"  on public.professional_tags for all
  using (auth.uid() = professional_id) with check (auth.uid() = professional_id);

-- ----------------------------------------------------------------------------
-- Anos de experiência geral do profissional. `professional_skills` já guarda
-- anos POR especialidade; este é o número que o parceiro informa no cadastro,
-- antes de detalhar especialidade por especialidade.
-- ----------------------------------------------------------------------------
alter table public.professionals
  add column if not exists anos_experiencia int not null default 0;

-- ----------------------------------------------------------------------------
-- Registro do aceite legal. Guardar a VERSÃO junto é o que permite provar a
-- qual texto a pessoa consentiu quando os termos mudarem.
-- ----------------------------------------------------------------------------
alter table public.profile_private
  add column if not exists termos_aceitos_em timestamptz,
  add column if not exists termos_versao     text;

-- ============================================================================
-- SEED do catálogo — vocabulário real de climatização no Brasil.
-- ============================================================================
insert into public.skill_tags (slug, label, categoria, ordem) values
  -- Equipamentos que o profissional domina
  ('split_hi_wall',      'Split Hi-Wall (parede)',        'equipamento', 10),
  ('split_piso_teto',    'Split Piso-Teto',               'equipamento', 20),
  ('cassete',            'Cassete (4 vias)',              'equipamento', 30),
  ('dutado',             'Split Dutado',                  'equipamento', 40),
  ('multi_split',        'Multi-Split',                   'equipamento', 50),
  ('vrf',                'VRF / VRV',                     'equipamento', 60),
  ('janela',             'Ar de Janela (ACJ)',            'equipamento', 70),
  ('portatil',           'Portátil',                      'equipamento', 80),
  ('self_contained',     'Self-Contained',                'equipamento', 90),
  ('chiller',            'Chiller',                       'equipamento', 100),
  ('fancoil',            'Fancoil',                       'equipamento', 110),
  ('cortina_ar',         'Cortina de Ar',                 'equipamento', 120),
  ('exaustao',           'Exaustão / ventilação mecânica','equipamento', 130),
  ('camara_fria',        'Câmara fria / refrigeração',    'equipamento', 140),

  -- Serviços que executa
  ('instalacao_completa','Instalação completa',            'servico', 10),
  ('infra_frigorigena',  'Infraestrutura / tubulação',     'servico', 20),
  ('eletrica_dedicada',  'Elétrica dedicada e disjuntor',  'servico', 30),
  ('dreno',              'Dreno: instalação e correção',   'servico', 40),
  ('carga_gas',          'Carga de gás / recolhimento',    'servico', 50),
  ('deteccao_vazamento', 'Detecção de vazamento',          'servico', 60),
  ('limpeza_filtros',    'Limpeza de filtros',             'servico', 70),
  ('higienizacao',       'Higienização profunda (química)','servico', 80),
  ('preventiva',         'Manutenção preventiva',          'servico', 90),
  ('corretiva',          'Manutenção corretiva',           'servico', 100),
  ('troca_compressor',   'Troca de compressor',            'servico', 110),
  ('placa_eletronica',   'Reparo de placa eletrônica',     'servico', 120),
  ('remanejamento_svc',  'Remanejamento de aparelho',      'servico', 130),
  ('desinstalacao',      'Desinstalação',                  'servico', 140),
  ('pmoc',               'PMOC e laudo técnico',           'servico', 150),
  ('projeto_carga',      'Projeto e cálculo de carga',     'servico', 160),
  ('automacao',          'Automação e termostato',         'servico', 170),

  -- Ambientes em que atua (os "especializados")
  ('amb_casa',           'Casa',                           'ambiente', 10),
  ('amb_apartamento',    'Apartamento',                    'ambiente', 20),
  ('amb_escritorio',     'Escritório / corporativo',       'ambiente', 30),
  ('amb_loja',           'Loja / varejo',                  'ambiente', 40),
  ('amb_restaurante',    'Restaurante / cozinha',          'ambiente', 50),
  ('amb_galpao',         'Galpão / industrial',            'ambiente', 60),
  ('amb_clinica',        'Clínica / hospitalar',           'ambiente', 70),
  ('amb_data_center',    'Data center / sala técnica',     'ambiente', 80),
  ('amb_condominio',     'Condomínio (áreas comuns)',      'ambiente', 90),

  -- Credenciais. ATENÇÃO: hoje são AUTODECLARADAS. Só viram prova quando o
  -- módulo de KYC existir e alguém conferir o documento.
  ('nr10',               'NR-10 (segurança elétrica)',     'credencial', 10),
  ('nr35',               'NR-35 (trabalho em altura)',     'credencial', 20),
  ('curso_tecnico',      'Curso técnico em refrigeração',  'credencial', 30),
  ('crea_cft',           'Registro CREA / CFT',            'credencial', 40),
  ('emite_nf',           'Emite nota fiscal',              'credencial', 50),
  ('garantia_escrita',   'Garantia por escrito',           'credencial', 60),
  ('atende_urgencia',    'Atende urgência / fim de semana','credencial', 70)
on conflict (slug) do update
  set label = excluded.label, categoria = excluded.categoria, ordem = excluded.ordem;

# FrioHub — Plano de evolução para excelência

> Documento vivo de contexto, diagnóstico e execução.
>
> Criado em 13/08/2026 a partir da auditoria técnica do repositório e do handoff do projeto.
> Atualizar este arquivo sempre que uma decisão estrutural for tomada ou uma etapa for concluída.

## 1. Objetivo

Transformar o FrioHub de um MVP funcional em uma plataforma de climatização confiável, segura,
operável e capaz de processar receita real.

“10/10” não significa ausência absoluta de bugs. Significa que cada dimensão possui critérios
objetivos de produção, testes, monitoramento, responsável operacional e mecanismo seguro de
recuperação quando algo falha.

O objetivo não é apenas entregar mais funcionalidades. A prioridade é garantir que preço,
reputação, pedidos, pagamentos, dados pessoais e estados operacionais permaneçam corretos mesmo
quando alguém usa a API diretamente, repete uma requisição ou tenta explorar o sistema.

## Status de execução

Atualizado em 14/08/2026.

| Item | Status | Evidência |
|---|---|---|
| Baseline de migrations remotas | Concluído | 30 migrations alinhadas por `supabase migration list --linked` antes das fases locais |
| Tipos TypeScript do Supabase | Concluído | `src/types/database.generated.ts` integrado aos três clientes |
| Matriz de papéis e permissões | Concluído | `docs/SECURITY_PERMISSION_MATRIX.md` |
| Contratos pgTAP | Concluído localmente | 299/299 testes passaram em `supabase/tests/database/` |
| Contratos REST por papel | Concluído localmente | 12/12 cenários passaram para anônimo, cliente, profissional, distribuidora e admin |
| CI de aplicação e banco | Implementado, execução no GitHub pendente | `.github/workflows/quality.yml` |
| Lint do schema remoto | Concluído | zero erros retornados por `supabase db lint --linked` |
| Reset local reproduzível | Validado até a Fase 4 | Fase 5 aplicada incrementalmente; repetir reset integral quando a sessão paralela liberar o banco |
| Hardening P0 / Fase 1 | Aplicado e validado localmente | migrations `20260813150445` a `20260813160000` |
| Validação da aplicação após Fase 1 | Concluída | lint, typecheck e build de produção passaram |
| Fase 2 — núcleo operacional | Implementado e validado localmente | outbox idempotente, cron, SLA, históricos, chat contextual, agenda e preferências |
| Fase 3 — fundação financeira | Implementado e validado localmente | ledger de partidas dobradas, inbox idempotente, reconciliação, lint, typecheck e build |
| Fase 4 — qualidade e PMOC | Núcleo validado localmente | ranking `quality_v1`, PMOC recorrente, métricas e destaque pago desligado |
| Fase 5 — resiliência | Fundação validada localmente | health checks, flags, rate limits, restore lógico e baseline de carga |

Os antigos testes `TODO` do P0 agora são contratos obrigatórios. As migrations incrementais e os
contratos pgTAP passaram no Supabase local. A reconstrução integral foi validada até a Fase 4; as
migrations da Fase 5 foram validadas incrementalmente para não resetar o banco compartilhado com a
outra sessão em andamento. O
gate de produção continua aberto até os testes REST/pgTAP passarem no CI remoto, antes de qualquer rollout
remoto.

## 2. Avaliação inicial

| Dimensão | Nota atual | Meta | Motivo principal |
|---|---:|---:|---|
| Produto e modelo de negócio | 7/10 | 10/10 | Proposta forte, mas receita ainda não é cobrada e faltam validações de operação real |
| Arquitetura conceitual | 8/10 | 10/10 | Boa decisão de proteger o domínio no banco; faltam fronteiras consistentes e observabilidade |
| Integridade e segurança efetiva | 4/10 | 10/10 | Existem vetores de alteração de preço, repasse, identidades e estados pela API |
| Operação do marketplace | 3/10 | 10/10 | Não há notificações, agenda, expiração automática, suporte ou gestão completa de exceções |
| Prontidão para produção | 3/10 | 10/10 | Sem testes, CI, monitoramento, recuperação operacional ou pagamentos idempotentes |

### Leitura honesta

O projeto tem uma base conceitual melhor que a média de um MVP. RLS, funções `SECURITY DEFINER`,
separação de dados sensíveis e cálculo financeiro no banco são decisões corretas.

Porém, o sistema ainda não deve receber tráfego público relevante, distribuidoras externas ou
pagamentos reais. A proteção atual é irregular: alguns fluxos são muito bem defendidos, enquanto
outros continuam dependendo da interface se comportar corretamente.

## 3. Princípios inegociáveis

1. A interface nunca é uma barreira de segurança.
2. RLS protege linhas; colunas críticas exigem RPC, privilégios específicos ou triggers seguros.
3. Operação financeira deve ser idempotente, auditável e reconciliável.
4. Toda máquina de estados crítica deve existir no banco.
5. Nenhuma alteração de schema destrutiva entra sem backup, plano de reversão e validação prévia.
6. Nenhuma feature crítica é considerada pronta sem testes automatizados de caminho feliz e abuso.
7. Dados pessoais devem ser privados por padrão e expostos apenas pelo tempo e ao ator necessários.
8. Textos comerciais e jurídicos devem descrever o comportamento real do produto.
9. Mudanças de arquitetura, dados ou produto exigem decisão explícita do time.
10. Velocidade importa, mas corrigir incidentes em produção custa mais que prevenir regressões.

## 4. Bloqueadores críticos verificados

### P0.1 — Manipulação do preço de venda

Em `20260812260000_distribuidoras.sql`, os triggers `trg_products_markup` e
`trg_products_protege` são executados em ordem alfabética. Uma escrita com `preco_manual = true`
pode fazer o trigger de markup ignorar o cálculo; o trigger seguinte volta `preco_manual` para
`false`, mas pode deixar um `preco_venda` arbitrário.

**Risco:** crítico. Afeta preço cobrado, margem, confiança e futuro pagamento.

**Correção esperada:** uma única função de proteção e cálculo, ou privilégios de coluna que tornem
`preco_venda` e `preco_manual` impossíveis de escrever pela distribuidora.

**Pronto quando:** testes REST comprovarem que apenas o admin pode fixar preço manual e que toda
alteração de custo feita pela distribuidora sempre deriva o preço pelo markup vigente.

### P0.2 — Repasse alterável pela distribuidora

A policy de `purchase_orders` permite update da linha inteira. A sequência operacional está apenas
no TypeScript.

**Risco:** crítico. `order_id`, `distributor_id`, `custo_snapshot`, prazo e status são dados de
integridade financeira.

**Correção esperada:** remover update direto, criar RPC específica para transição de estado e
congelar identidade e valores financeiros.

**Pronto quando:** tentativa REST de alterar custo, pedido ou distribuidora falhar; somente
transições válidas forem aceitas; toda transição gerar registro de auditoria.

### P0.3 — Aceite sem lock e idempotência

`aceitar_quote()` consulta pedido e proposta antes de bloquear a decisão. Chamadas concorrentes
podem criar mais de um job/order/repasse.

**Risco:** crítico agora e catastrófico após integração de pagamento.

**Correção esperada:** `SELECT ... FOR UPDATE`, constraints de unicidade ligando pedido ao job,
rechecagem após o lock e chave de idempotência.

**Pronto quando:** teste concorrente com múltiplas chamadas produzir exatamente um job, uma order,
no máximo um repasse e uma proposta vencedora.

### P0.4 — Fronteiras de papel incompletas

As policies permitem que um usuário crie para si linhas em `professionals` ou `distributors` sem
que `profiles.role` corresponda. Com `EXIGIR_VERIFICACAO = false`, isso também afeta descoberta e
reputação.

**Risco:** alto/crítico. Uma mesma identidade pode atuar em mais de um lado do marketplace fora do
fluxo aprovado.

**Correção esperada:** predicados de papel no banco, criação de entidades por RPC/onboarding e
constraints ou triggers que mantenham `profiles.role` coerente.

**Pronto quando:** cada token só conseguir executar as operações do próprio papel, inclusive via
REST direta.

### P0.5 — Fotos privadas em bucket público

Fotos de orçamento podem mostrar residência, quadro elétrico, equipamentos e outros detalhes do
cliente. O bucket `orcamentos` é público e a aplicação grava URL pública.

**Risco:** alto de privacidade e LGPD.

**Correção esperada:** bucket privado, leitura restrita aos participantes autorizados e URLs
assinadas de curta duração. Remover objetos órfãos e definir retenção.

**Pronto quando:** a URL sem sessão válida não abrir o arquivo e usuários alheios ao pedido não
conseguirem gerar URL assinada.

## 5. Outros riscos que entram no hardening

- `quote_requests` permite ao cliente alterar colunas de escopo e produto após receber propostas.
- `quote_request_targets` permite update além de `visto_em`, `recusado_em` e `motivo_recusa`.
- `conversations` permite update de participantes, `job_id` e `last_message_at`.
- O limite de cinco destinatários existe no app, não como regra garantida pelo banco.
- Profissional verificado pode mudar dados, especialidades e tags sem voltar para análise.
- A verificação administrativa não possui evidência, histórico ou trilha de decisão suficiente.
- `distributors.cnpj` está publicamente legível, contrariando a Política de Privacidade.
- Funções e policies precisam de revisão sistemática de `GRANT EXECUTE`, `search_path` e papel.
- Uploads podem deixar arquivos órfãos quando o formulário é abandonado ou uma gravação falha.
- Escritas de perfil, skills, tags e áreas são múltiplas operações não transacionais.

## 6. Roadmap obrigatório

### Fase 0 — Baseline e proteção imediata

Objetivo: impedir que novas mudanças agravem o risco.

- [x] Registrar que pagamento e distribuidoras externas estão bloqueados até o hardening.
- [x] Validar ambiente local Supabase reproduzível a partir de todas as migrations.
- [x] Gerar e integrar tipos TypeScript do schema.
- [x] Criar matriz de papéis e permissões.
- [x] Criar baseline pgTAP de contratos e regressões P0.
- [x] Complementar com testes REST para cliente, profissional, distribuidora, admin e anônimo.
- [x] Adicionar CI com lint, typecheck, build, migrations e testes de RLS.
- [x] Registrar seed local vazio e proibição de copiar dados de produção.

**Gate:** migrations reproduzíveis do zero e CI obrigatório passando.

### Fase 1 — Hardening de banco e privacidade

Objetivo: fechar todos os bloqueadores P0.

- [x] Corrigir cálculo e proteção de produto.
- [x] Substituir update direto de repasse por RPC.
- [x] Tornar aceite idempotente e concorrente-safe.
- [x] Aplicar fronteiras de papel no banco.
- [x] Tornar fotos de orçamento privadas.
- [x] Congelar identidade das conversas e destinatários.
- [x] Proteger escopo do orçamento depois do primeiro envio/proposta.
- [x] Implementar revalidação real de profissionais e distribuidoras.
- [x] Adicionar audit log para ações administrativas e transições críticas.
- [x] Corrigir exposição de CNPJ e alinhar textos jurídicos.

Implementação local concluída e ampliada em 14/08/2026. A suíte `scripts/test-rest-roles.mjs`
exercita a Data API com usuários temporários dos cinco papéis e remove os fixtures ao final. Ela
identificou grants ausentes que deixavam policies corretas inalcançáveis pelo PostgREST; a migration
`20260814114010_rest_api_role_grants.sql` criou uma allowlist por operação e coluna, mantendo CNPJ
profissional, custo de produto e escritas críticas fora do acesso genérico. O CI agora executa os
12 contratos REST depois dos 299 contratos pgTAP. As caixas não indicam deploy em produção:
ainda faltam execução do CI remoto e rollout controlado.

**Gate:** nenhuma exploração conhecida reproduzível e suíte negativa de RLS passando.

### Fase 2 — Operação mínima do marketplace

Objetivo: fazer cliente, profissional e distribuidora responderem no tempo certo.

- [ ] Entrega externa de e-mail para pedido, proposta, aceite e nova mensagem — outbox pronta;
      faltam escolha do provedor, domínio remetente, templates e worker de entrega.
- [x] Preferências de notificação e prevenção de spam/duplicidade.
- [x] Expiração automática de orçamento com job agendado/cron.
- [x] Cancelar e recusar pela interface com motivo e histórico.
- [x] Chat contextual dentro do orçamento e do serviço, aberto corretamente pelos dois papéis.
- [x] Agendamento do serviço, confirmação, cancelamento e lembretes idempotentes de 24 h/2 h.
- [x] SLA e fila operacional para pedido sem resposta e serviço sem aceite.
- [ ] Fallback “enviar a todos os elegíveis” com controle de volume — depende de decisão de
      produto sobre raio, capacidade e limite diário por profissional.
- [x] Painel administrativo de exceções de SLA.
- [ ] Fluxo formal de disputas — depende da política de cancelamento/reembolso da Fase 3.

Implementação local em 13/08/2026 nas migrations `20260813170000` e `20260813171000`.
O schema passou sem erros no lint e a suíte chegou a 78/78 testes pgTAP. A fase ainda não cruza o
gate: a outbox registra cada evento de modo idempotente, mas nenhum e-mail externo será marcado
como enviado até o provedor e o worker serem configurados. Isso é intencional para não acoplar as
transações do marketplace a uma API externa nem declarar como entregue o que apenas entrou na fila.

**Gate:** fluxo completo pode ser operado sem comunicação manual paralela obrigatória.

### Fase 3 — Pagamentos e contabilidade

Objetivo: capturar receita sem corromper saldo ou repasse.

- [x] Gateway escolhido: Asaas. Integração externa e credenciais continuam desligadas.
- [x] Separar ledger financeiro de status do serviço e da entrega.
- [x] Inbox de webhooks idempotente e reprocessável; autenticação HTTP entra com a Edge Function.
- [x] Reconciliação interna automática e relatório de divergências no painel administrativo.
- [ ] Política comercial/jurídica de cancelamento, reembolso parcial, chargeback e disputa.
      Reembolso integral já possui reversão contábil; parcial é bloqueado para análise.
- [ ] KYC/KYB de profissionais e distribuidoras.
- [ ] Testes contra o sandbox Asaas para sucesso e falhas de API. Os contratos locais já cobrem
      retry, duplicidade, reversão e evento fora de ordem.
- [x] Observabilidade interna de pagamento e fila de alertas financeiros.

Fundação local implementada em 13/08/2026 na migration `20260813172401`. `orders` permanece como
contrato comercial e projeção compatível com as telas antigas; `payment_charges` representa a
cobrança, `payment_gateway_events` preserva o evento bruto e `financial_journals` +
`financial_postings` formam o ledger imutável de partidas dobradas. A reconciliação roda a cada
hora no minuto 17. A suíte financeira cobre duplicidade, evento fora de
ordem, balanceamento e reversão integral.

O gate ainda está aberto: não existe movimentação real, checkout, segredo, webhook HTTP, repasse,
KYC/KYB ou teste sandbox. O nome comercial do produto não é necessário para validar esta fundação.

**Gate:** cada centavo recebido, retido, reembolsado e repassado pode ser explicado por eventos
imutáveis e reconciliado com o gateway.

### Fase 4 — Qualidade, confiança e crescimento

Objetivo: melhorar liquidez e retenção sem sacrificar qualidade.

- [x] Usar `service_areas` de verdade no matching e validar os destinatários novamente no banco.
- [x] Paginação e busca no servidor para produtos e profissionais.
- [x] Ranking orgânico `quality_v1`: qualidade bayesiana/histórico, resposta suavizada e carga
      ativa, sem influência de patrocínio.
- [x] Métricas de funil por coorte: solicitação, resposta, aceite, execução, conclusão e recompra.
- [ ] Assinatura profissional somente depois de existir valor recorrente comprovado. A migration
      de planos registra interesse comercial, mas não ativa cobrança nem benefício patrocinado.
- [ ] Destaque patrocinado completo. Rotulagem, janela e elegibilidade existem; escrita direta foi
      bloqueada, mas compra e auditoria administrativa ainda precisam ser criadas.
- [x] PMOC recorrente para clientes comerciais: solicitação, atribuição, aceite, visitas, conclusão,
      cancelamento, histórico, notificações internas e interface por papel.
- [ ] Programa de reativação, indicação e recorrência de manutenção.

Fundação local implementada em 13/08/2026 nas migrations `20260813180524` e `20260813182838`. A seleção deixou de
carregar catálogos inteiros e agora usa consultas paginadas. A RPC de criação rejeita IDs de
profissionais fora do CEP, cidade ou especialidade mesmo quando a interface é contornada. O painel
administrativo mostra o funil dos últimos 30 dias usando a solicitação como coorte. A suíte completa
chegou a 213/213 contratos pgTAP e o build Webpack de produção passou.

Não há geodistância real: prefixo de CEP representa cobertura, não quilômetros. Destaque pago,
assinatura e campanhas de reativação continuam desligados. PMOC está disponível no piloto como
operação, sem cobrança ou promessa de documento técnico. Os critérios estão registrados nas ADRs
002 e 003.

**Gate:** crescimento medido por conversão, retenção, margem e qualidade, não apenas cadastros.

### Fase 5 — Escala e resiliência

Objetivo: suportar falhas, aumento de volume e novas praças.

- [x] SLOs propostos, error budget e baseline local de latência documentados.
- [x] Health checks internos de banco, filas, webhooks, reconciliação, SLA e PMOC; endpoint público
      mínimo e visão administrativa.
- [x] Backup lógico testado com exercício real de restauração em banco temporário.
- [x] Runbook técnico de incidentes; responsáveis nominais e canal de plantão ainda pendentes.
- [x] Rate limiting no banco para pedidos, mensagens e PMOC; senha local mínima de oito caracteres.
- [ ] CAPTCHA: depende de domínio e credencial Turnstile/hCaptcha; não deve ser ativado com segredo
      vazio nem apenas no ambiente local.
- [x] Testes de carga reproduzíveis para banco e HTTP, com limites automáticos.
- [x] Feature flags por praça e rollout determinístico; PMOC 100%, Asaas, assinatura e patrocinado 0%.
- [x] Rollout UX por domínio, com administração auditada e preservação de execuções em andamento.
- [x] Cidade/UF/praça configuráveis por ambiente e tabela de regiões; abertura de nova praça ainda
      exige dados, operação e rollout próprios.
- [ ] Monitor externo, captura de erro frontend/backend e alertas fora da infraestrutura Supabase.
- [ ] Restore remoto de banco e Storage com volume real, depois que staging/plano forem definidos.

Fundação local implementada em `20260813184012_resilience_phase5.sql`. O exercício local restaurou
schema, Auth e dados da aplicação; Realtime/Storage continuam responsabilidade do serviço gerenciado
e precisam de ensaio remoto. Em carga local, o PostgreSQL processou 169.724 transações em 10 s sem
falha; `/api/health` processou 28.752 requisições, sem erro e com p95 de 5,1 ms. Base vazia e rede
local não representam produção. Ver `SLO_OPERACAO.md`, `RUNBOOK_INCIDENTES.md` e
`BACKUP_RESTORE.md`.

**Gate:** incidentes são detectados rapidamente, têm procedimento de recuperação e não exigem
improviso para preservar dados financeiros.

## 7. Definition of Done do “10/10”

### Produto e modelo de negócio

- Unit economics documentado por tipo de serviço e equipamento.
- Comissão e margem efetivamente cobradas e reconciliadas.
- Políticas de cancelamento, garantia, disputa e repasse definidas.
- Funil e retenção medidos por praça e por lado do marketplace.
- Notificações e SLAs sustentam a operação assíncrona.

### Arquitetura

- Domínios críticos possuem APIs/RPCs explícitas, sem escrita genérica de linha inteira.
- Migrations reproduzem a base do zero e são reversíveis quando tecnicamente possível.
- Tipos do Supabase são gerados e usados no app.
- Integrações externas são isoladas, idempotentes e observáveis.
- Decisões estruturais relevantes estão registradas em ADRs.

### Integridade e segurança

- Matriz de permissão testada para todos os papéis.
- Nenhum ator escreve preço, reputação, verificação ou saldo que não controla.
- Dados pessoais são privados por padrão.
- Auditoria administrativa e financeira é imutável.
- Revisão de segurança e teste de abuso antes de cada release crítico.

### Operação

- Nenhum pedido fica indefinidamente sem estado ou responsável.
- Notificações têm retry, deduplicação e status de entrega.
- Agenda, cancelamento, disputa e exceções possuem fluxo operacional.
- Administração consegue resolver casos sem editar SQL manualmente.
- Métricas e alertas mostram gargalos antes que virem reclamações.

### Produção

- CI bloqueia regressões.
- Ambientes de desenvolvimento, staging e produção são separados.
- Segredos não ficam no cliente ou no repositório.
- Backup e restauração são testados.
- Deploy possui rollback e smoke tests.
- SLO, logs, alertas e runbooks estão ativos.

## 8. Matriz mínima de testes de segurança

Para cada tabela/RPC crítica, testar ao menos:

| Ator | Leitura permitida | Escrita permitida | Tentativas que devem falhar |
|---|---|---|---|
| Anônimo | Catálogo e vitrine pública | Nenhuma | Custo, pedidos, mensagens, fotos privadas |
| Cliente | Próprios pedidos, propostas e jobs | Ações explícitas do próprio fluxo | Preço, reputação, papel, pedido alheio |
| Profissional | Convites, própria proposta e jobs atribuídos | Propor e transicionar serviço permitido | Proposta concorrente, reputação, verificação |
| Distribuidora | Próprio catálogo e próprios repasses | Custo/estoque e transições permitidas | Preço final, custo snapshot, order_id |
| Admin | Dados necessários à operação | Ações administrativas auditadas | Escrita sem registro de auditoria |

Também são obrigatórios testes de concorrência, repetição de webhook, UUID alheio, campos extras,
valores extremos, objeto inexistente e estado fora de ordem.

## 9. Dívida técnica e documentação

- Atualizar o `README.md`, que aponta para migration inexistente e descreve receitas não ativas.
- Dividir `SolicitarWizard.tsx` em etapas menores com regras puras testáveis.
- Reduzir casts e remover inferências frágeis de embeds PostgREST.
- Padronizar tratamento de erros; operações ignoradas não podem retornar sucesso.
- Documentar desenvolvimento local, seed, reset, deploy e recuperação.
- Manter o handoff histórico, mas tratar este documento como a fonte de prioridade futura.

## 10. Decisões pendentes do time

Estas decisões não devem ser tomadas silenciosamente durante implementação:

1. Profissionais não verificados ficam invisíveis ou aparecem com aviso explícito?
2. Qual evidência torna profissional e distribuidora “verificados”?
3. Gateway definido como Asaas; qual modelo jurídico e momento de repasse serão adotados?
4. Quem emite nota de equipamento e de serviço?
5. Qual política de cancelamento, visita técnica, reembolso e garantia?
6. Qual provedor enviará e-mail e, futuramente, WhatsApp/push?
7. Qual prazo de retenção de mensagens, fotos e documentos?
8. Admin pode ler toda conversa preventivamente ou apenas quando uma disputa é aberta?
9. Quem responde por suporte, disputa e falha de entrega no piloto?
10. Quais métricas determinam que uma nova praça pode ser aberta?

## 11. Próxima execução recomendada

Concluir as decisões de produto da **Fase 4**: pesos e política de exposição do ranking, modelo de
venda/auditoria do destaque, hipótese comercial de PMOC e critérios de reativação. Antes de
produção, voltar aos gates abertos das Fases 0–3: CI remoto, worker de e-mail,
fallback, política de disputa/repasse, KYC/KYB e integração sandbox Asaas.

O advisor local também registrou dívida anterior fora da Fase 3: as views `orders_cliente`,
`entregas_cliente` e `meus_produtos` ainda usam privilégios do dono. A nova view
`payment_status_cliente` usa `security_invoker`, mas as três legadas devem ser migradas para RLS
invoker/RPC antes do rollout de produção.

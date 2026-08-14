# FrioHub — Roadmap da experiência 10/10

> Documento vivo de produto, UI/UX e capacidades operacionais.
>
> Criado em 13/08/2026. Deve ser atualizado quando uma hipótese for validada, uma decisão de
> produto for tomada ou uma entrega mudar de escopo.

## 1. Visão

O FrioHub deve ser o lugar onde:

- o cliente encontra um profissional adequado sem depender de indicação informal, entende o que
  está contratando e acompanha tudo sem ansiedade;
- o profissional organiza oportunidades, agenda, execução, clientes e dinheiro sem precisar
  combinar WhatsApp, caderno, planilha e memória;
- cada nova tela reduz trabalho ou incerteza. Quantidade de telas não é objetivo de produto.

A reação desejada é:

> “O sistema me mostrou o que fazer agora, me ajudou a escolher melhor e não deixou nada cair no
> esquecimento.”

## 2. North stars

### Cliente

**Encontrar e contratar com confiança.** O cliente deve conseguir sair de uma necessidade pouco
estruturada para uma escolha segura, sabendo preço, escopo, próximo passo, responsável e garantia.

### Profissional

**Transformar oportunidade em serviço bem executado e receita controlada.** O profissional deve
abrir o FrioHub diariamente porque ele indica prioridades, reduz tarefas administrativas e revela
onde estão oportunidades e dinheiro.

### Marketplace

**Gerar contratações saudáveis e recorrentes.** Crescimento deve preservar tempo de resposta,
qualidade, margem, confiança e equilíbrio de oportunidades.

## 3. Princípios de experiência

1. **Próxima ação acima de estatística.** Todo dashboard deve explicar o que requer atenção agora.
2. **Uma fonte de verdade.** Agenda, proposta, serviço, pagamento e comunicação não podem divergir.
3. **Menos preenchimento, mais reaproveitamento.** Equipamento, endereço e histórico devem reduzir
   esforço em contratações futuras.
4. **Confiança explicável.** Recomendações devem mostrar motivos objetivos, sem nota mágica.
5. **Progressive disclosure.** Informação técnica aparece quando passa a ser necessária.
6. **Mobile first de verdade.** O profissional usará o sistema no deslocamento e no local do serviço.
7. **Automação com controle.** O sistema sugere e lembra; não envia comunicação comercial sensível
   sem autorização e registro.
8. **Privacidade por padrão.** Endereço, telefone, fotos, notas e documentos aparecem somente para
   quem precisa e no momento adequado.
9. **Estados vazios ajudam a agir.** Tela sem dados deve ensinar o próximo passo, não parecer quebrada.
10. **Sem promessas fictícias.** Não chamar estimativa de preço final, operação de laudo técnico ou
    status de serviço de comprovante financeiro.

## 4. O que já existe e deve ser evoluído

O sistema já possui peças importantes que não devem ser reconstruídas em paralelo:

| Capacidade existente | Evolução desejada |
|---|---|
| Dashboard por papel | Central “Meu dia”, prioridades e recomendações acionáveis |
| Pedidos e propostas | Pipeline comercial e comparador de propostas |
| Agenda | Visão semanal, disponibilidade e preparação da visita |
| Chat contextual | Follow-up, respostas salvas e lembretes sem spam |
| Serviço e agendamento | Modo de execução, checklist, evidências e relatório |
| Financeiro e despesas | Resultado por serviço, previsão, metas e inadimplência |
| Perfil, portfólio e avaliações | Assistente de perfil e insights de conversão |
| PMOC | Carteira comercial, ativos, documentos e visitas recorrentes |
| Notificações | Central de ações, preferências e entrega externa futura |
| Matching por CEP e qualidade | Explicação da recomendação e comparação transparente |

## 5. Jornada futura do profissional

### 5.1 Central “Meu dia”

**Problema:** o painel atual resume registros, mas não organiza o trabalho.

**Experiência:** ao entrar, o profissional enxerga uma fila priorizada:

- próxima visita, endereço, horário e rota;
- orçamentos novos e prazo sem resposta;
- propostas que merecem follow-up;
- horários aguardando confirmação;
- serviços que precisam de execução, conclusão ou relatório;
- mensagens não lidas ligadas ao contexto;
- valor previsto hoje/semana e valores a receber;
- manutenção recorrente próxima;
- uma ação principal recomendada.

**Telas/componentes:**

- `/painel` redesenhado como central de ações;
- card “Próximo atendimento”;
- lista “Precisa da sua atenção”;
- resumo “Hoje” e “Esta semana”;
- atalhos contextuais para proposta, chat, mapa, serviço e financeiro.

**Backend:** inicialmente pode ser composição server-side das tabelas existentes. Quando houver
volume, criar RPC/read model `obter_central_profissional` para evitar consultas fragmentadas.

**Métrica:** percentual de profissionais ativos que concluem uma ação sugerida; tempo até primeira
resposta; redução de itens vencidos.

### 5.2 Pipeline de oportunidades e follow-up

**Problema:** responder orçamento é apenas uma ação; falta visão comercial do que pode ser ganho ou
foi perdido.

**Experiência:** pipeline:

`Novo → Visualizado → Proposta enviada → Em conversa → Agendado → Ganho/Perdido`

Cada oportunidade mostra:

- tempo na etapa e SLA;
- valor proposto ou estimado;
- última interação;
- próxima ação e data de follow-up;
- prioridade baseada em sinais objetivos;
- motivo de perda;
- resposta salva, sempre revisada antes de enviar.

**Telas:**

- `/painel/oportunidades` com lista mobile e kanban em telas largas;
- detalhe contextual reaproveitando o pedido e o chat;
- criação/adiamento/conclusão de follow-up;
- visão de ganhos, perdas e motivos.

**Backend provável:**

- `follow_up_tasks`;
- `quote_opportunity_events` ou extensão segura do histórico existente;
- motivos de perda estruturados;
- RPCs para transições e tarefas, com idempotência e RLS.

**Métrica:** taxa de resposta, taxa de proposta, conversão, tempo por etapa e follow-ups vencidos.

### 5.3 Agenda inteligente

**Problema:** a agenda diária ajuda a consultar, mas ainda não auxilia capacidade, planejamento e
preparação.

**Experiência:**

- visões dia e semana;
- blocos de indisponibilidade;
- horários aguardando confirmação;
- tempo livre entre visitas;
- endereço e rota;
- checklist de preparação;
- receita prevista no período;
- alerta de conflito de horário.

**Backend provável:**

- `professional_availability`;
- `professional_time_blocks`;
- validação transacional de conflito;
- timezone explícito por praça/usuário.

**Métrica:** conflitos evitados, ocupação da agenda, cancelamentos e tempo ocioso.

### 5.4 Modo execução do serviço

**Problema:** a plataforma organiza a contratação, mas ainda entrega pouco valor durante a visita.

**Experiência mobile:**

1. iniciar atendimento;
2. confirmar equipamento e condição encontrada;
3. executar checklist por tipo de serviço;
4. registrar medições, materiais e peças;
5. anexar fotos de antes/depois;
6. documentar pendência ou recomendação;
7. apresentar resumo ao cliente;
8. concluir e gerar relatório;
9. sugerir próxima manutenção e garantia.

**Telas:**

- `/servico/[id]/executar`;
- checklist em etapas com salvamento de rascunho;
- relatório legível para cliente e profissional;
- histórico imutável de versões emitidas.

**Backend provável:**

- `service_executions`;
- `service_checklist_templates` e versões;
- `service_checklist_answers`;
- `service_materials`;
- `service_measurements`;
- `service_report_versions`;
- bucket privado para evidências.

**Risco alto:** o relatório não deve ser anunciado como laudo, ART, PMOC legal ou certificação sem
definição jurídica e responsável técnico.

**Métrica:** serviços com relatório completo, tempo de fechamento, retrabalho, disputas e retorno
para manutenção.

### 5.5 Carteira de clientes e equipamentos

**Problema:** o histórico fica espalhado por serviços; o profissional não constrói uma memória útil
da relação.

**Experiência:**

- cliente, locais e equipamentos atendidos;
- histórico de serviços e valores;
- observações privadas;
- última e próxima manutenção;
- garantias e recomendações;
- filtro “clientes que precisam de retorno este mês”.

**Backend provável:**

- `customer_sites`;
- `customer_equipment`;
- `professional_customer_notes`, privadas para o autor/equipe;
- `maintenance_recommendations`;
- vínculo explícito entre equipamento, serviço e PMOC.

**Risco alto:** notas privadas e dados de endereço exigem RLS e política de retenção específicas.

**Métrica:** recompra, manutenção recorrente, clientes ativos e tempo para criar novo pedido.

### 5.6 Financeiro gerencial

**Problema:** receita e despesa agregadas não respondem quais serviços sustentam o negócio.

**Experiência:**

- faturado, recebido, a receber e vencido claramente separados;
- lucro estimado e realizado por serviço;
- margem por especialidade;
- ticket médio;
- receita prevista pela agenda/pipeline;
- meta mensal e comparação com período anterior;
- despesas por categoria;
- exportação contábil futura.

**Backend:** preservar ledger como fonte financeira. Métricas gerenciais podem usar views/RPCs; não
duplicar saldo em tabela editável. Materiais e despesas precisam se vincular opcionalmente ao job.

**Métrica:** profissionais que registram custos, diferença entre previsto e realizado e serviços
com margem conhecida.

### 5.7 Performance e crescimento do perfil

**Problema:** o profissional vê avaliações, mas não sabe onde perde visibilidade ou conversão.

**Experiência:**

- visualizações do perfil;
- aparições no matching;
- abertura e envio de pedido;
- taxa e tempo de resposta;
- taxa de fechamento;
- completude do perfil;
- recomendações concretas: área, especialidade, portfólio, resposta e disponibilidade.

**Backend provável:** eventos first-party minimizados e métricas agregadas. Nunca expor dados
identificáveis de concorrentes ou permitir manipulação pelo navegador como fonte de conversão.

**Métrica:** melhora de perfil concluída, conversão antes/depois e justiça de exposição.

## 6. Jornada futura do cliente

### 6.1 Solicitação guiada e reaproveitável

**Objetivo:** transformar um problema descrito em linguagem comum em pedido útil, sem exigir
conhecimento técnico.

Melhorias:

- linguagem baseada em sintomas;
- estimativa de tempo de preenchimento;
- salvar e continuar;
- reaproveitar local/equipamento conhecido;
- revisão final simples;
- confirmação clara de quantos profissionais receberão e o que acontece depois.

### 6.2 Comparador de propostas

**Problema:** escolher somente olhando cartões isolados favorece preço e aumenta insegurança.

**Experiência:** comparar lado a lado:

- preço total e decomposição;
- preço fechado versus visita técnica;
- itens incluídos e excluídos;
- prazo e disponibilidade;
- garantia;
- avaliações daquela especialidade;
- experiência e serviços concluídos;
- verificação;
- motivo da recomendação;
- dúvidas que o cliente deveria esclarecer.

O sistema pode sinalizar “mais completa”, “melhor histórico” ou “menor preço”, mas não declarar
“melhor profissional” sem contexto.

**Métrica:** tempo até escolha, propostas comparadas, conversão e cancelamentos após aceite.

### 6.3 Timeline do pedido e serviço

**Experiência:**

`Pedido → Propostas → Escolha → Agendamento → Execução → Pagamento → Relatório/Garantia`

Cada etapa informa:

- estado atual em linguagem humana;
- quem precisa agir;
- prazo esperado;
- próxima ação;
- histórico de alterações;
- acesso ao chat e documentos corretos.

**Métrica:** contatos de suporte “qual é o status?”, tempo parado e abandono.

### 6.4 Meus locais e equipamentos

**Experiência:** uma carteira do imóvel ou empresa:

- locais cadastrados;
- equipamentos por ambiente;
- marca, modelo, BTU e data de instalação;
- fotos, manual, nota e garantia;
- histórico de manutenção;
- próxima manutenção recomendada;
- “contratar novamente” com dados preenchidos.

**Métrica:** pedidos recorrentes, tempo de solicitação e equipamentos com histórico completo.

### 6.5 Pós-serviço e garantia

**Experiência:** após a conclusão, entregar:

- resumo do que foi encontrado e executado;
- fotos autorizadas;
- materiais utilizados;
- recomendações;
- período e escopo da garantia;
- avaliação contextual;
- próxima manutenção;
- recontratação.

**Métrica:** avaliações concluídas, retorno, disputa e recompra.

## 7. Arquitetura de informação proposta

### Navegação do profissional

1. Hoje
2. Oportunidades
3. Agenda
4. Serviços
5. Clientes
6. Financeiro
7. Desempenho
8. Perfil

Mensagens e notificações devem ser acessíveis globalmente, sem competir com destinos principais.
PMOC pode aparecer dentro de “Clientes/Recorrência” quando a arquitetura amadurecer.

### Navegação do cliente

1. Início
2. Pedidos
3. Equipamentos
4. Financeiro
5. Perfil

Mensagens e notificações também ficam globais. PMOC aparece apenas para clientes/regiões elegíveis.

**Decisão pendente:** fazer essa reorganização imediatamente ou após as novas telas existirem. A
recomendação é migrar gradualmente, sem publicar links vazios.

## 8. Roadmap de implementação

### Fase UX 0 — Pesquisa e baseline

- [x] Auditar as jornadas internas atuais e separar capacidade existente de lacuna de experiência.
- [ ] Entrevistar ao menos 5 profissionais autônomos, 3 empresas HVAC e 8 clientes recentes.
- [ ] Mapear a jornada atual fora do sistema: WhatsApp, planilha, caderno, agenda e cobrança.
- [ ] Registrar top 10 tarefas, perdas de tempo, objeções e momentos de ansiedade.
- [ ] Medir baseline: resposta, conversão, conclusão, recorrência e tempo parado.
- [x] Definir eventos e métricas com privacidade; implementação aguarda escolha de analytics.
- [ ] Criar protótipos mobile e testar linguagem antes do schema definitivo.

Preparação interna registrada em `docs/UX_FASE_0_PESQUISA_E_BASELINE.md`. O gate permanece aberto:
auditoria de código não substitui entrevistas, testes de usabilidade ou baseline com tráfego real.

**Gate:** problemas prioritários confirmados por usuários, não apenas pela equipe.

### Fase UX 1 — Central de ação

- [x] Redesenhar dashboard profissional como “Meu dia”.
- [x] Adicionar próxima visita e rota.
- [x] Criar fila unificada de ações prioritárias derivada das fontes transacionais.
- [x] Exibir previsão financeira curta, sem confundir com recebido.
- [x] Melhorar dashboard do cliente com status e próxima ação.
- [x] Instrumentar cliques e conclusão das ações sugeridas.

Primeira versão implementada em 13/08/2026 sem alteração de schema. `CentralAcoes.tsx` compõe
orçamentos, propostas, mensagens, agenda, serviços e ordens já protegidos por RLS. Lint, TypeScript
e build de produção passaram. A instrumentação PostHog opt-in está documentada em
`docs/ANALYTICS_POSTHOG.md`; o gate de compreensão ainda depende do teste de usabilidade definido
na Fase UX 0 e de tráfego real suficiente.

**Gate:** usuários entendem em menos de dez segundos o que precisam fazer.

### Fase UX 2 — Pipeline e confiança na escolha

- [x] Criar pipeline de oportunidades.
- [x] Criar tarefas de follow-up e motivos de perda.
- [x] Adicionar respostas salvas revisáveis.
- [x] Criar comparador de propostas para o cliente.
- [x] Criar timeline compartilhada de pedido/serviço.
- [x] Garantir notificações idempotentes das mudanças relevantes.

Entregue em 13/08/2026. O pipeline deriva pedido/proposta/job em vez de duplicar estados. Follow-ups
têm RPCs, RLS, índice de unicidade e eventos imutáveis; respostas rápidas sempre exigem revisão no
campo do chat. Lembretes são internos e nenhuma mensagem comercial é enviada automaticamente.
O gate de conversão depende de analytics e uso real.

**Gate:** redução do tempo de resposta e aumento de conversão sem aumento de spam.

### Fase UX 3 — Execução profissional

- [x] Criar templates versionados de checklist por serviço.
- [x] Implementar rascunho e retomada no modo execução.
- [x] Registrar materiais, medições e evidências privadas.
- [x] Gerar relatório pós-serviço versionado.
- [x] Registrar garantia e recomendação de manutenção.
- [x] Projetar funcionamento sob conexão instável antes de prometer modo offline.

Entregue em 13/08/2026 como modo execução server-backed. Relatórios finalizados são snapshots
imutáveis e evidências ficam em bucket privado. A decisão para conexão instável foi preservar e
retomar rascunhos no servidor; modo offline real não é prometido e exigirá fila local e política de
conflitos antes de existir.

**Gate:** serviço pode ser executado e entregue com histórico sem depender de papel ou mensagens
soltas.

### Fase UX 4 — Carteira e recorrência

- [x] Criar locais e equipamentos do cliente.
- [x] Vincular serviços, garantias e PMOC aos equipamentos.
- [x] Criar carteira de clientes do profissional com notas privadas protegidas.
- [x] Criar manutenção recomendada e lembretes consentidos.
- [x] Permitir nova solicitação reaproveitando dados.

Entregue em 13/08/2026: cadastro de patrimônio, carteira e recomendação consentida estão prontos.
Um pedido aberto a partir do equipamento reaproveita CEP, descrição e contexto técnico; quando a
proposta vira serviço, o vínculo é preservado automaticamente. O cliente também pode associar seu
equipamento a um plano PMOC, e garantia/manutenção permanecem conectadas pelo serviço.

**Gate:** recorrência acontece com contexto e consentimento, não com campanha indiscriminada.

### Fase UX 5 — Gestão e crescimento

- [x] Evoluir financeiro para margem por serviço e previsão.
- [x] Criar metas e comparação entre períodos.
- [x] Criar desempenho do perfil e funil profissional.
- [x] Criar assistente de melhoria do perfil.
- [ ] Validar valor recorrente antes de atrelar recursos a planos pagos.

Entregue em 13/08/2026: margem usa apenas pagamentos liquidados e custos registrados; funil usa
uma coorte mensal coerente; ausência de amostra e de evento de visualização é exibida, nunca
estimada. A validação de valor recorrente continua aberta por ser uma decisão de produto baseada
em uso e entrevistas, não uma tarefa que código possa comprovar.

**Gate:** profissionais ativos conseguem apontar decisões que tomaram usando os insights.

## 9. Modelo de dados candidato

Não é autorização para criar todas as tabelas. Cada grupo exige ADR e migration própria.

| Domínio | Entidades candidatas | Risco principal |
|---|---|---|
| Follow-up | `follow_up_tasks`, motivos de perda | spam e duplicidade de estado |
| Disponibilidade | `professional_availability`, `professional_time_blocks` | timezone e conflito |
| Execução | templates, respostas, materiais, medições, relatórios | integridade e uso jurídico |
| Equipamentos | `customer_sites`, `customer_equipment` | endereço e propriedade dos dados |
| Relacionamento | `professional_customer_notes` | notas privadas e LGPD |
| Recorrência | `maintenance_recommendations` | consentimento e comunicação |
| Analytics | eventos e agregados first-party | rastreamento excessivo e fraude |

Regras obrigatórias:

- migrations aditivas e reversíveis quando possível;
- RLS e privilégios testados por papel;
- comandos críticos por RPC;
- documentos/evidências em Storage privado;
- histórico imutável para relatório e garantia emitidos;
- nenhuma métrica financeira fora do ledger como fonte contábil;
- feature flag para rollout de cada domínio.

Rollout implementado localmente em 13/08/2026 com flags regionais determinísticas e auditáveis para
`ux_pipeline`, `ux_execution`, `ux_portfolio` e `ux_growth`. O piloto começa em 100% para preservar
o comportamento atual. Menu, rotas e Server Actions respeitam a configuração; execuções já
iniciadas podem ser concluídas mesmo após redução da flag. Procedimento e limites em
`docs/ROLLOUT_UX.md`. Flags controlam exposição do produto e não substituem RLS ou autorização.

## 10. Sistema de design e qualidade de UI

Antes de multiplicar telas:

- consolidar tokens de cor, espaço, tipografia, raio e sombra;
- criar componentes de estado: vazio, carregando, erro, sucesso, bloqueado e offline;
- padronizar cards de ação, status, timeline, filtros e formulários;
- garantir foco visível, teclado, contraste e labels acessíveis;
- usar skeleton somente quando preservar o layout; não esconder erro com loading infinito;
- limitar ação primária a uma por contexto;
- testar nos tamanhos comuns de celular usados em campo;
- manter linguagem curta, humana e específica de HVAC;
- validar datas, moedas, CEP e timezone brasileiros;
- usar animação apenas para orientar mudança de estado.

## 11. Métricas de sucesso

### Aquisição e ativação

- cliente que conclui a primeira solicitação;
- profissional que completa perfil, área e primeira proposta;
- tempo até primeiro valor percebido por papel.

### Liquidez e conversão

- pedidos com ao menos uma resposta;
- tempo de primeira resposta;
- propostas por pedido;
- aceite por pedido e por profissional;
- motivos de perda.

### Operação

- ações vencidas;
- agendamentos confirmados;
- serviços concluídos com relatório;
- tempo entre aceite e conclusão;
- cancelamentos, retrabalho e disputas.

### Valor do profissional

- frequência semanal;
- oportunidades respondidas;
- agenda ocupada;
- receita/margem conhecida;
- clientes recorrentes;
- tarefas administrativas eliminadas.

### Confiança do cliente

- tempo para escolher;
- comparação de propostas utilizada;
- avaliações concluídas;
- suporte por dúvida de status;
- recompra e recomendação.

Toda métrica deve ser segmentada por praça, tipo de serviço e papel quando houver volume suficiente,
sem expor indivíduos.

## 12. Riscos e antídotos

| Risco | Severidade | Antídoto |
|---|---|---|
| Criar muitas telas sem uso | Alta | pesquisa, protótipo e métrica antes do backend completo |
| Dashboard virar mural de cards | Alta | priorização e uma ação principal |
| Duplicar estados entre pipeline e orçamento | Crítica | derivar estado e registrar eventos, não copiar verdade |
| Follow-up virar spam | Alta | consentimento, limite, revisão humana e preferências |
| Relatório ser interpretado como laudo legal | Crítica | escopo jurídico, texto preciso e responsável técnico |
| Notas privadas vazarem | Crítica | RLS, auditoria, retenção e testes negativos |
| Métrica financeira incorreta | Crítica | ledger como fonte e distinção previsto/realizado |
| Mobile ruim no campo | Alta | protótipo/teste em dispositivo e conexão limitada |
| Navegação crescer indefinidamente | Média | arquitetura por tarefas e progressive disclosure |
| Automação errada prejudicar confiança | Alta | sugestão explicável, confirmação e reversibilidade |

## 13. Definition of Done de uma experiência

Uma tela não está pronta somente porque renderiza. Ela precisa:

- resolver uma tarefa observada de cliente ou profissional;
- funcionar em celular e desktop;
- ter estados vazio, loading, erro, sucesso e sem permissão;
- possuir acessibilidade mínima e linguagem validada;
- respeitar RLS, privacidade e auditoria;
- reutilizar a fonte de verdade existente;
- ter telemetria de resultado, não apenas pageview;
- possuir teste do caminho feliz e casos de abuso relevantes;
- estar atrás de flag quando introduzir domínio novo;
- ter mecanismo de rollback;
- atualizar este documento com evidência e aprendizado.

## 14. Decisões que o time precisa tomar

1. O primeiro público do piloto será autônomo, empresa HVAC ou ambos?
2. O profissional opera sozinho ou haverá equipe, atendente e técnicos com permissões diferentes?
3. O FrioHub pode enviar follow-up em nome do profissional? Por quais canais e com qual consentimento?
4. Quais checklists e medições são necessários por tipo de serviço?
5. Qual documento pós-serviço pode ser emitido sem se apresentar como laudo técnico?
6. Quem é dono dos dados de equipamento quando cliente e profissional contribuem?
7. Qual garantia mínima existe e quem responde por ela?
8. Quais métricas podem influenciar plano pago sem prejudicar o ranking orgânico?
9. Quanto tempo fotos, relatórios, notas e conversas devem ser retidos?
10. Quais métricas definem sucesso do piloto antes de ampliar a praça?

## 15. Próxima execução recomendada

1. Validar este roadmap com entrevistas curtas.
2. Desenhar o wireframe mobile da Central “Meu dia” usando somente dados que já existem.
3. Implementar a primeira versão sem mudança de schema, por composição server-side.
4. Medir uso e entendimento.
5. Só então criar o domínio de pipeline/follow-up com migration, RLS e testes.

Essa sequência entrega valor visível cedo e evita construir um CRM completo antes de comprovar que
ele resolve a principal dor dos profissionais do piloto.

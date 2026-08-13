# FrioHub — Fase UX 0: pesquisa e baseline

> Status: preparação interna concluída; pesquisa com usuários pendente.
>
> Criado em 13/08/2026. Este documento é a evidência de entrada para a Fase UX 1 e deve receber
> resultados reais, não opiniões atribuídas a usuários que não foram entrevistados.

## 1. Objetivo da fase

Confirmar quais problemas mais prejudicam o dia a dia de clientes e profissionais antes de alterar
navegação, schema ou automações. A fase existe para impedir que o FrioHub construa um grande conjunto
de telas coerentes tecnicamente, mas pouco usado na prática.

## 2. Gate

A Fase UX 0 só termina quando:

- 5 profissionais autônomos forem entrevistados;
- 3 responsáveis por empresas HVAC forem entrevistados;
- 8 clientes que contrataram ou tentaram contratar serviço forem entrevistados;
- pelo menos 5 profissionais e 5 clientes testarem um protótipo mobile;
- as três principais dores de cada lado aparecerem em mais de uma entrevista;
- o baseline transacional for coletado de um ambiente com uso real ou staging representativo;
- hipóteses confirmadas, refutadas e inconclusivas forem registradas;
- o escopo da Fase UX 1 for ajustado com base nas evidências.

Sem isso, podemos preparar e prototipar, mas não afirmar que a pesquisa foi concluída.

## 3. Auditoria interna do produto atual

### 3.1 Profissional

| Momento | O que existe | Valor atual | Lacuna observável no produto |
|---|---|---|---|
| Entrada | KPIs e lista de serviços | visão resumida | não prioriza próxima ação nem reúne propostas, agenda e mensagens |
| Oportunidade | pedidos recebidos e detalhe | permite enviar/recusar proposta | não há pipeline, tempo na etapa, follow-up ou motivo estruturado de perda |
| Comunicação | chat contextual | preserva conversa no sistema | não há lembrete de retorno nem respostas salvas |
| Agenda | visão diária e próximos 14 dias | horário, rota, cliente e valor previsto | não há semana, disponibilidade ou conflito de capacidade |
| Execução | status e ações do serviço | permite avançar a máquina de estados | não há checklist, medições, materiais, fotos de execução ou relatório |
| Relacionamento | histórico por job | contexto de um atendimento | não há carteira consolidada de clientes/equipamentos |
| Financeiro | recebido, comissão, despesa e resultado | separa liquidação de status operacional | não mostra margem por serviço, previsão nem meta |
| Reputação | avaliações e dados por especialidade | mostra prova social | não explica visualização, conversão ou ação recomendada |

### 3.2 Cliente

| Momento | O que existe | Valor atual | Lacuna observável no produto |
|---|---|---|---|
| Descoberta | wizard por necessidade e sintomas | reduz conhecimento técnico exigido | não reaproveita equipamentos/locais já conhecidos |
| Matching | profissionais por CEP e qualidade | elegibilidade territorial real | justificativa da recomendação ainda é pouco explícita |
| Propostas | lista de propostas e chat | permite avaliar preço, escopo e perfil | não existe comparação lado a lado nem auxílio de decisão |
| Contratação | aceite cria serviço de forma segura | transação consistente | transição pedido → serviço pode parecer troca de contexto |
| Acompanhamento | detalhe e histórico | status e eventos disponíveis | falta timeline clara com responsável, prazo e próxima ação |
| Execução | agenda e conversa | cliente acompanha combinação | não recebe checklist/relatório do que foi realizado |
| Pós-serviço | avaliação | fecha reputação | não há garantia estruturada, recomendação ou recontratação rápida |
| Recorrência | PMOC | atende operação comercial recorrente | cliente residencial não possui carteira de equipamentos |

## 4. Hipóteses a validar

Hipóteses não são fatos. Cada uma deve terminar como `confirmada`, `refutada` ou `inconclusiva`.

### Profissionais

| ID | Hipótese | Evidência necessária |
|---|---|---|
| P1 | oportunidades e retornos se perdem entre WhatsApp, memória e agenda | exemplos recentes, frequência e impacto financeiro |
| P2 | a primeira necessidade diária é saber o que exige ação agora | ordem espontânea das tarefas ao começar o dia |
| P3 | relatório simples com fotos aumenta percepção de profissionalismo | uso atual de papel/PDF/WhatsApp e reação ao protótipo |
| P4 | registrar material/despesa por serviço ajuda a entender lucro | como calcula preço e margem hoje; frequência de cálculo |
| P5 | histórico de equipamentos gera manutenção recorrente | forma atual de lembrar clientes e taxa de retorno |
| P6 | profissionais aceitariam centralizar chat se houver ganho operacional | canais usados, urgência, objeções e dependência do WhatsApp |
| P7 | uma agenda semanal é mais valiosa que mais KPIs | tarefas de planejamento e reação comparativa ao protótipo |

### Clientes

| ID | Hipótese | Evidência necessária |
|---|---|---|
| C1 | escolher profissional gera mais ansiedade que preencher o pedido | relato da última contratação e dúvidas antes do aceite |
| C2 | garantia, escopo e avaliações específicas importam além do menor preço | ranking espontâneo de critérios e teste do comparador |
| C3 | cliente não entende quem deve agir em cada etapa | teste do fluxo atual sem instrução |
| C4 | histórico do equipamento reduz esforço e incentiva manutenção | existência de notas/manuais e reação à carteira |
| C5 | relatório pós-serviço aumenta confiança e facilita disputa/garantia | documentos recebidos hoje e valor percebido |
| C6 | cliente quer prazo de resposta previsível | tolerância declarada e comportamento enquanto espera |

## 5. Recrutamento

### 5.1 Profissional autônomo — 5 participantes

Critérios de variedade:

- instalação, manutenção/limpeza e conserto;
- iniciante e experiente;
- agenda baixa e agenda cheia;
- trabalha sozinho;
- usa combinações diferentes de WhatsApp, agenda, papel e planilha.

### 5.2 Empresa HVAC — 3 participantes

Entrevistar quem distribui serviço ou acompanha operação. Buscar empresas com:

- ao menos dois técnicos;
- alguém responsável por atendimento/orçamento;
- contratos recorrentes ou PMOC quando possível;
- rotina de fechamento financeiro.

### 5.3 Cliente — 8 participantes

Incluir:

- instalação e manutenção/conserto;
- residencial e pequeno negócio;
- quem contratou por indicação e por busca online;
- quem teve boa experiência e quem abandonou/teve problema;
- diferentes níveis de familiaridade técnica.

Não recrutar somente amigos muito próximos ou usuários entusiasmados com a ideia. O grupo precisa
conter pessoas capazes de criticar o produto.

## 6. Roteiro de entrevista — profissional

Duração: 35 a 45 minutos. Pedir exemplos reais e recentes. Não apresentar a solução antes de
entender o comportamento atual.

1. Conte como começou seu dia de trabalho ontem.
2. Onde você vê quais clientes precisam de resposta?
3. Mostre, se estiver confortável, como organiza agenda e conversas.
4. Conte a última vez em que esqueceu ou demorou a responder alguém.
5. Como decide qual orçamento responder primeiro?
6. O que precisa descobrir antes de passar um preço?
7. Como acompanha proposta enviada e cliente que ficou em silêncio?
8. Como planeja deslocamentos e horários da semana?
9. O que registra durante a execução de instalação, limpeza, manutenção ou conserto?
10. O que entrega ao cliente depois do serviço?
11. Como controla garantia e retorno?
12. Como sabe se ganhou dinheiro em um serviço específico?
13. Como lembra um cliente de fazer nova manutenção?
14. Que tarefa administrativa mais atrapalha seu trabalho técnico?
15. Se um sistema resolvesse somente uma dessas tarefas, qual deveria ser?

Perguntas de aprofundamento:

- “Quando foi a última vez?”
- “O que aconteceu depois?”
- “Quanto tempo ou dinheiro isso custou?”
- “Pode me mostrar como faz hoje?”
- “O que faz quando isso dá errado?”

Evitar perguntas como “você usaria uma tela de pipeline?”. Elas induzem aprovação sem comprovar
comportamento.

## 7. Roteiro de entrevista — cliente

Duração: 25 a 35 minutos.

1. Conte sobre a última vez que precisou de um profissional de ar-condicionado.
2. Como encontrou os candidatos?
3. O que fez alguém parecer confiável ou arriscado?
4. Quais informações faltaram para comparar?
5. Você recebeu mais de uma proposta? Como escolheu?
6. Houve diferença entre o combinado e o executado?
7. Em algum momento você não sabia o que estava acontecendo ou quem deveria agir?
8. Como combinou data, endereço e contato?
9. O que recebeu depois do serviço: fotos, garantia, nota, orientação?
10. Você sabe quando deve fazer a próxima manutenção?
11. Onde guarda informações do aparelho?
12. O que tornaria uma contratação futura muito mais fácil?

## 8. Teste de usabilidade do protótipo

O protótipo deve ser mobile e clicável, mas pode usar dados fictícios claramente identificados.
O moderador não deve explicar onde clicar.

### 8.1 Tarefas do profissional

1. “Você acabou de abrir o sistema às 7h30. Diga o que faria primeiro.”
2. “Um pedido urgente chegou há 20 minutos. Encontre e responda.”
3. “Você enviou uma proposta ontem e o cliente não respondeu. Programe um retorno.”
4. “Veja seu próximo atendimento e abra a rota.”
5. “Descubra quanto espera receber nesta semana.”

Critérios:

- identifica a ação prioritária em até 10 segundos;
- conclui cada tarefa sem ajuda crítica;
- entende diferença entre previsto, contratado e recebido;
- não confunde oportunidade com serviço confirmado;
- consegue explicar com palavras próprias o que ocorrerá depois.

### 8.2 Tarefas do cliente

1. “Duas propostas chegaram. Escolha qual investigaria primeiro e explique por quê.”
2. “Compare garantia, escopo e valor das propostas.”
3. “Descubra quem precisa agir agora.”
4. “Veja quando será o atendimento e como falar com o profissional.”
5. “Após o serviço, encontre o que foi feito e a garantia.”

Critérios:

- encontra comparação sem instrução;
- não interpreta recomendação como garantia absoluta de qualidade;
- identifica preço total e itens excluídos;
- compreende status, responsável e próxima ação;
- encontra documento/garantia sem depender do chat.

## 9. Baseline quantitativo

### 9.1 Métricas deriváveis hoje das fontes transacionais

| Métrica | Fonte | Fórmula | Situação |
|---|---|---|---|
| solicitações | `quote_requests` | pedidos criados na coorte | já existe na RPC administrativa |
| pedidos respondidos | `quotes` | coorte com ao menos uma proposta | já existe |
| primeira resposta | `quotes.created_at` | primeira proposta menos criação do pedido | já existe |
| aceites | `quotes.status`/job | coorte com proposta aceita | já existe |
| início | `jobs.status`/eventos | coorte que chegou a execução | já existe |
| conclusão | `jobs.status`/eventos | coorte concluída/avaliada | já existe |
| recorrência | pedidos anteriores do cliente | cliente da coorte com pedido anterior | já existe |
| propostas por pedido | `quotes` | quantidade por solicitação | derivável, ainda não exibida |
| cancelamento/expiração | pedido e eventos | coorte por estado final | derivável |
| tempo aceite → agenda | job e appointment | primeiro agendamento menos aceite/criação | derivável |
| tempo aceite → conclusão | eventos do job | conclusão menos criação/aceite | derivável |
| avaliação | `reviews` | concluídos que receberam avaliação | derivável |

`obter_funil_marketplace()` já entrega o núcleo correto por coorte. Não criar eventos de navegador
para substituir esses fatos.

### 9.2 Métricas que ainda exigem instrumentação mínima

| Evento de produto | Finalidade | Dados mínimos | Não registrar |
|---|---|---|---|
| `dashboard_action_opened` | saber se prioridade gerou ação | papel, tipo de ação, origem, versão da experiência | texto da mensagem, endereço, telefone |
| `proposal_comparison_opened` | adoção do comparador | pedido, quantidade de opções, versão | valores em texto livre ou dados de outros usuários |
| `proposal_comparison_decision` | relação entre comparação e aceite | pedido, dimensão destacada, resultado | “motivo psicológico” inferido |
| `timeline_action_opened` | entender utilidade da próxima ação | agregado, etapa e ação | conteúdo privado |
| `follow_up_completed` | medir trabalho organizado | tarefa, atraso, resultado estruturado | conversa completa |

Antes de criar tabela própria, avaliar PostHog ou ferramenta equivalente com consentimento,
retenção, região e mascaramento definidos. Eventos de negócio continuam no PostgreSQL; analytics de
interação não deve contaminar as máquinas de estado.

### 9.3 Planilha de baseline a preencher

| Período | Praça | Pedidos | Respondidos | p50 1ª resposta | p90 1ª resposta | Aceitos | Concluídos | Recorrentes | Cancelados/expirados |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A coletar | São Paulo | — | — | — | — | — | — | — | — |

Não preencher com o banco local vazio nem inventar meta como desempenho histórico.

## 10. Como sintetizar as entrevistas

Para cada sessão, registrar:

- perfil do participante sem dado pessoal desnecessário;
- ferramentas atuais;
- tarefas frequentes;
- problema observado;
- frequência;
- impacto em tempo, dinheiro ou confiança;
- solução improvisada atual;
- citação curta, com consentimento;
- hipótese relacionada;
- evidência a favor/contra;
- severidade e confiança do achado.

Priorizar usando:

`pontuação = frequência × impacto × confiança da evidência`

Escala de 1 a 3 para cada fator. A pontuação ajuda a ordenar; não substitui julgamento de produto,
risco jurídico ou dependências técnicas.

## 11. Top tarefas candidatas para validação

Estas tarefas vieram da auditoria do produto, não de entrevistas:

1. profissional identificar o que precisa fazer agora;
2. profissional responder oportunidade rapidamente;
3. profissional lembrar e executar follow-up;
4. profissional planejar agenda e deslocamento;
5. profissional registrar o serviço e entregar evidência;
6. profissional saber o lucro de um atendimento;
7. cliente descrever a necessidade sem conhecimento técnico;
8. cliente comparar propostas além do preço;
9. cliente entender status, responsável e próximo passo;
10. cliente acessar histórico, garantia e próxima manutenção.

O ranking definitivo só deve ser fechado após a pesquisa.

## 12. Decisões que a fase precisa produzir

1. Autônomo e empresa terão a mesma Central “Meu dia” no primeiro piloto?
2. Qual é a ação mais valiosa na primeira dobra do dashboard profissional?
3. O primeiro protótipo do cliente deve focar comparador ou timeline?
4. Follow-up será apenas lembrete interno ou também envio de mensagem?
5. Qual vocabulário os usuários já usam para oportunidade, orçamento, visita e serviço?
6. Qual informação financeira pode aparecer sem criar expectativa falsa de recebimento?
7. Quais informações técnicas realmente são coletadas no local por tipo de serviço?

## 13. Estado atual da execução

| Entrega | Estado | Evidência |
|---|---|---|
| auditoria interna das jornadas | concluída | seções 3 e 11 |
| hipóteses de pesquisa | concluída | seção 4 |
| amostra de recrutamento | definida | seção 5 |
| roteiros de entrevista | concluídos | seções 6 e 7 |
| tarefas de usabilidade | definidas | seção 8 |
| mapa de métricas e privacidade | concluído | seção 9 |
| entrevistas | pendentes | dependem de participantes reais |
| protótipo mobile | pendente | deve refletir resultados iniciais ou hipóteses claramente marcadas |
| baseline com tráfego real | pendente | banco local vazio não é evidência de uso |
| síntese e priorização final | pendente | depende das entrevistas/testes |

## 14. Próxima ação segura

Recrutar primeiro 2 autônomos e 2 clientes para entrevistas exploratórias. Com os padrões iniciais,
criar duas variações mobile da Central “Meu dia” e uma do acompanhamento do cliente. Testar antes de
alterar a navegação ou criar schema.


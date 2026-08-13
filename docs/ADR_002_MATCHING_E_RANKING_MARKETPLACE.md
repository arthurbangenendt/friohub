# ADR 002 — Matching territorial e sinais de ranking

- Status: aceito; ranking `quality_v1` aprovado
- Data: 13/08/2026

## Contexto

O produto permitia cadastrar `service_areas`, mas a seleção de profissionais filtrava apenas por
cidade e aceitava os IDs enviados pela interface sem validar cobertura territorial no banco. Ao
mesmo tempo, a UI promovia destaques patrocinados antes dos resultados orgânicos, embora ainda não
exista compra, cobrança ou auditoria desse produto.

O schema só conhece prefixos de CEP. Ele não possui latitude/longitude confiáveis; portanto, não é
tecnicamente correto chamar a especificidade do prefixo de “distância”.

## Decisão

1. Área de atendimento é uma regra de elegibilidade. Um profissional sem prefixo compatível não
   aparece e não pode ser incluído no pedido por chamada direta à RPC.
2. Prefixos aceitos pelo matching contêm de dois a cinco dígitos. Valores históricos inválidos são
   ignorados, sem mutação destrutiva automática.
3. A consulta paginada retorna sinais objetivos separados: nota por especialidade, trabalhos
   concluídos, taxa de resposta, quantidade de serviços ativos e especificidade da cobertura.
4. A ordenação padrão é orgânica, determinística e versionada como `quality_v1`: 60% qualidade,
   25% resposta e 15% disponibilidade por carga ativa. Qualidade combina nota bayesiana (prior
   4,0 com cinco avaliações) e histórico de serviços concluídos. Perfis não verificados recebem
   redutor de 15%. Ordenações explícitas por nota, experiência e trabalhos continuam disponíveis.
5. “Patrocinado” não altera a ordem orgânica. Escrita direta em `featured_placements` fica fechada
   até existir compra, janela contratada e auditoria administrativa.
6. Funil é derivado das fontes transacionais por coorte de solicitação; eventos enviados pelo
   navegador não são a fonte de verdade de conversão.
7. Produtos e profissionais são paginados no banco, com limite máximo por chamada.

## Consequências

- O cadastro da área passa a ter efeito operacional real.
- Perfis sem área válida não recebem solicitações; o onboarding deve explicar isso claramente.
- Taxa de resposta e carga ativa podem ser exibidas sem inventar disponibilidade de agenda.
- Distância em quilômetros permanece pendente de geocodificação confiável e PostGIS.
- A venda de destaque exige uma futura RPC administrativa, vínculo financeiro e histórico
  imutável antes de ser habilitada.
- Os pesos deverão ser avaliados contra conversão, qualidade e justiça de exposição antes de uma
  futura versão. Mudança de fórmula exige nova versão e comparação observável; destaque nunca entra
  no score orgânico.

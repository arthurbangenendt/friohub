# Analytics de produto — PostHog

Implementado em 13/08/2026. Esta integração mede resultado de experiência sem transformar o
PostHog em fonte transacional. Pedidos, propostas, pagamentos, relatórios e estados continuam no
PostgreSQL.

## Configuração

1. Criar um projeto no PostHog e escolher conscientemente a região de hospedagem.
2. Copiar `.env.local.example` para o ambiente desejado.
3. Definir `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` e `NEXT_PUBLIC_POSTHOG_HOST`.
4. Configurar no projeto PostHog o descarte de IP e a retenção aprovada pelo responsável LGPD.
5. Publicar primeiro em ambiente de teste e conferir os eventos no Live Events.

Sem token, o SDK não inicializa e o banner não aparece. O token de projeto é público por natureza;
nenhuma chave pessoal ou administrativa do PostHog deve usar prefixo `NEXT_PUBLIC_`.

## Privacidade aplicada no código

- opt-out por padrão e consentimento explícito;
- preferência revogável na interface;
- autocapture, replay, surveys, heatmaps, dead clicks, performance e exceções desativados;
- pageview manual sem query string;
- UUIDs presentes no caminho são substituídos por `[id]`;
- identificação apenas pelo UUID técnico do Auth;
- sem e-mail, nome, telefone, endereço, CEP, mensagem, foto, observação ou valor financeiro;
- evento não é enviado quando o token falta ou o consentimento não está ativo.

## Contrato inicial de eventos

| Evento | Quando | Propriedades permitidas |
|---|---|---|
| `$pageview` | navegação consentida | `route_pattern`, URL normalizada |
| `dashboard_action_opened` | ação da Central aberta | papel, tipo, prioridade, origem, versão |
| `proposal_comparison_opened` | comparador aberto | quantidade de propostas, versão |
| `proposal_comparison_decision` | proposta aceita | quantidade, tipo da proposta, resultado, versão |
| `follow_up_completed` | follow-up concluído | resultado estruturado, vencido, versão |
| `request_created` | pedido criado | tipo de serviço, número de destinatários, recorrência, versão |
| `execution_draft_saved` | rascunho técnico salvo | quantidade de evidências, versão |
| `execution_finalized` | relatório finalizado | versão |
| `analytics_consent_updated` | consentimento concedido ou revogado | estado booleano |

Novas propriedades devem ser incluídas primeiro no tipo `Events` de `src/lib/analytics.ts`. Texto
livre e identificadores de entidades não são aceitos como conveniência.

## Funis recomendados

1. Cliente: `request_created` → `proposal_comparison_opened` → `proposal_comparison_decision`.
2. Profissional: `$pageview(/painel)` → `dashboard_action_opened` → `follow_up_completed`.
3. Execução: `$pageview(/servico/[id]/executar)` → `execution_draft_saved` → `execution_finalized`.

Comparar por papel, tipo de serviço e `experience_version`, somente quando a amostra for suficiente.
Valores de conversão transacional devem ser conciliados com as tabelas/RPCs do banco; PostHog mede
interação e não substitui o ledger nem os eventos imutáveis.

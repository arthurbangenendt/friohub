# FrioHub — Matriz de papéis e permissões

> Fonte de verdade para testes de autorização. Mudança nesta matriz é decisão de produto e
> segurança; deve vir acompanhada de migration, teste e atualização deste documento.

## Regras globais

- `anon` acessa somente vitrine e catálogo público.
- `cliente` acessa somente recursos próprios e ações explícitas do funil de contratação.
- `profissional` acessa convites recebidos, própria proposta e serviços atribuídos.
- `distribuidora` acessa próprio catálogo e repasses destinados a ela.
- `admin` executa ações administrativas explícitas e auditadas; não simula outro participante.
- `service_role` é exclusivo de rotinas confiáveis no servidor e nunca aparece no navegador.

## Matriz resumida

| Recurso | Anônimo | Cliente | Profissional | Distribuidora | Admin |
|---|---|---|---|---|---|
| Perfil público profissional | Ler | Ler | Ler/editar próprio | Ler | Ler/moderar |
| Dados pessoais privados | Não | Próprios | Próprios | Próprios | Ler para suporte/KYC |
| Produto público | Ler sem custo | Ler sem custo | Ler sem custo | Ler próprios com custo | Ler/curar |
| Preço final do produto | Ler | Ler | Ler | Não escrever | Escrever override |
| Pedido de orçamento | Não | Criar/ler/cancelar próprio | Ler se convidado | Não | Ler para suporte |
| Proposta | Não | Ler recebidas/aceitar | Criar/retirar própria | Não | Ler para disputa |
| Job | Não | Ler próprio/cancelar antes do início | Ler e transicionar atribuído | Ler entrega necessária | Ler para suporte |
| Order | Não | Ler visão sem margem | Ler valores do serviço | Não | Ler completa |
| Repasse | Não | Ler visão da entrega | Ler visão da entrega | Ler e avançar por RPC | Ler/intervir auditado |
| Conversa/mensagem | Não | Próprias | Próprias | Não | Ler para suporte/disputa |
| Reputação profissional | Ler | Criar após conclusão | Ler, nunca escrever a própria | Não | Moderar auditado |
| Reputação de cliente | Não | Não | Ler somente clientes atendidos | Não | Ler para suporte |

## Colunas que nunca aceitam escrita genérica

| Tabela | Colunas protegidas |
|---|---|
| `profiles` | `id`, `role` |
| `professionals` | `id`, verificação, assinatura e campos auditados |
| `distributors` | `id`, verificação, `ativo` |
| `products` | `distributor_id`, `preco_venda`, `preco_manual` |
| `quote_requests` | dono, produto e escopo depois do envio |
| `quote_request_targets` | chaves; profissional só altera visto/recusa |
| `quotes` | chaves, vencedor e `job_id`; conteúdo congela após decisão |
| `jobs` | participantes, tipo, produto e transições fora da máquina de estados |
| `orders` | todas; criação e alteração somente por funções financeiras |
| `purchase_orders` | chaves e valores financeiros; status somente por RPC |
| `conversations` | participantes, vínculo e timestamps derivados |
| `messages` | todas após envio, exceto leitura por RPC autorizada |

## Exceções explícitas de dados sensíveis

| Dado | Regra |
|---|---|
| CNPJ da distribuidora | Sem `SELECT` genérico; somente a própria distribuidora ou admin pela RPC `obter_cnpj_distribuidora` |
| Fotos de orçamento | Bucket privado; somente cliente, destinatários e admin recebem URL assinada de 10 minutos |
| Decisão de verificação | Somente RPC `definir_verificacao`, com justificativa obrigatória e registro em `admin_audit_log` |
| Transição de repasse | Somente RPC `avancar_purchase_order`, com evento append-only em `purchase_order_events` |

## Testes obrigatórios por operação

Cada permissão deve ser testada com:

1. dono legítimo;
2. usuário do mesmo papel sem vínculo;
3. usuário de papel diferente;
4. anônimo;
5. UUID inexistente;
6. alteração de coluna extra pela REST API;
7. repetição da mesma requisição;
8. duas requisições concorrentes para decisões exclusivas.

## Evidência executável

- `supabase/tests/database/15_rest_api_grants.test.sql` fixa os grants mínimos da Data API.
- `scripts/test-rest-roles.mjs` usa Auth e PostgREST locais com os cinco papéis, valida 12 cenários
  de acesso/abuso e remove todos os usuários temporários ao final.
- `.github/workflows/quality.yml` executa pgTAP e a suíte REST após reconstruir o Supabase do zero.

Uma policy RLS sem `GRANT` correspondente bloqueia também o uso legítimo; um `GRANT` sem policy
adequada amplia a superfície sem isolamento. Os dois contratos devem sempre evoluir juntos.

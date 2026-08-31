# ADR 004 — Chatwoot como motor omnichannel, com frontend próprio

- Status: aceito, em rollout por flag
- Data: 15/08/2026
- Instância: Chatwoot 4.15.1 self-hosted, conta 16
- Flag: `chatwoot_messaging` (nasce `enabled=false, rollout=0`)

## Contexto

O chat interno (`conversations` / `messages`, migration 20260812230000) resolve exatamente um caso:
cliente e profissional trocando texto dentro do app. Não há WhatsApp, e-mail, Instagram, fila de
atendimento nem time de suporte. A `notification_outbox` foi desenhada como fila de entrega e
nunca teve consumidor — o canal de e-mail continua desligado desde que foi projetado.

Construir tudo isso do zero significaria escrever integração com a Cloud API da Meta, IMAP/SMTP,
caixa de entrada com atribuição, automação de roteamento, respostas prontas e relatórios. É muita
superfície para um problema que já tem solução madura e auto-hospedável.

## Decisão

**O Chatwoot é o motor. O frontend continua sendo nosso.**

1. Cliente e profissional conversam pela tela do FrioHub. Só a equipe interna usa o painel do
   Chatwoot.
2. `public.messages` deixa de ser a fonte de verdade e passa a ser **espelho de leitura**,
   alimentado pelo webhook.
3. O profissional é um `User` do Chatwoot que **nunca entra no Chatwoot**: existe para ser
   `assignee`.
4. Toda escrita de mensagem passa pelo Chatwoot e volta pelo webhook. O app não insere mais em
   `messages` quando a flag está ligada.
5. Telefone e e-mail **não** vão para o contato do Chatwoot na criação.
6. Automação do Chatwoot cuida de roteamento e rotulagem. Regra que depende de estado do FrioHub
   fica em código nosso.

## Por que o frontend não pode ser o do Chatwoot

Este é o ponto que decidiu o desenho, e vale registrar com a evidência.

**Isolamento entre técnicos não existe no Chatwoot sem licença Enterprise.**
`User#assigned_inboxes` (app/models/user.rb) devolve `Current.account.inboxes` para administrador e
`inboxes.where(account_id:)` para os demais; o `ConversationFinder` recorta a lista por `inbox_id`.
Ou seja: agente membro de uma inbox vê **todas** as conversas dela, não só as atribuídas a ele.
Restringir por conversa é `custom_role`, recurso pago. Um técnico com acesso ao painel enxergaria a
conversa de clientes de todos os outros técnicos.

**O painel de contato mostra a ficha inteira.** Telefone e e-mail aparecem para qualquer agente da
inbox. Sincronizar `profile_private.telefone` anularia na prática o duplo consentimento que
/privacidade 4.1 promete.

**As regras que o produto promete vivem em RLS e RPC.** `handoff_liberado()`, `revelar_contato()`,
a leitura de auditoria do admin e o recorte por participante são policies no Postgres. Nada disso
atravessa para dentro do Chatwoot.

## Por que `messages` continua existindo

Não é redundância. Quatro coisas dependem de `messages` estar no Postgres, e as quatro já têm teste:

1. `handoff_liberado()` conta dias distintos de troca em cima da tabela;
2. o Supabase Realtime que a thread consome — só `messages` está na publication;
3. o contador de não lidas do menu, que roda em toda navegação do painel;
4. a leitura de admin por RLS, que é o que /termos 6.1 promete.

Ler direto da API do Chatwoot a cada render trocaria RLS por checagem em código de aplicação, mataria
o Realtime, deixaria o handoff sem fonte de dados e colocaria um serviço externo no caminho de toda
navegação. O espelho custa um webhook.

## As três proteções do usuário sem acesso

O profissional precisa ser `User` para que atribuição, automação de roteamento e relatório por agente
funcionem. Ele não pode, em hipótese alguma, conseguir olhar o painel. Três mecanismos independentes,
todos verificados na 4.15.1:

| Proteção | Onde |
|---|---|
| Atribuir não exige ser membro da inbox | `Conversations::AssignmentService#assignee` busca em `account.users`, sem checar membership |
| Criado sem confirmação e com senha aleatória | `POST /platform/api/v1/users` chama `skip_confirmation!`; `User` tem `devise :confirmable` |
| Membro de zero inboxes | `assigned_inboxes` vazio ⇒ `ConversationFinder` não devolve conversa nenhuma |

**Ao atualizar o Chatwoot, reconferir as três.** Se uma cair numa versão nova, o isolamento passa a
depender só das outras duas.

Por isso a criação usa a Platform API e não `POST /agents`: o `AgentBuilder` cria o usuário sem
confirmar, e como `User` é `confirmable`, cada técnico cadastrado receberia um "confirme sua conta
Chatwoot".

## Consequências

- **`messages.sender_id` passou a ser nullable** (20260815092000). Equipe, automação e sistema não
  têm perfil no FrioHub. Quem decide handoff e destinatário de notificação passou a ser
  `sender_kind`, não `sender_id` — sem isso, resposta do suporte contaria como "os dois lados
  falaram" e anteciparia a revelação do telefone.
- **O rate limit mudou de lugar.** `enforce_marketplace_rate_limits()` só age quando há `auth.uid()`,
  e a escrita passou a ser de `service_role`. O teto de 30/min e 500/dia foi para a borda, em
  `consumir_limite_mensagem()` chamada pela Edge Function (20260815096000).
- **Três contadores de não lidas usavam `.neq("sender_id", ...)`**, que descarta NULL — mensagem da
  equipe nunca apareceria no badge. Trocados por `.or("sender_id.is.null,sender_id.neq...")`.
- **Um canal novo não pode herdar fila acumulada.** `whatsapp_allowed` nasceu com `default true` e
  marcou retroativamente notificações enfileiradas antes de o canal existir; no dia em que o
  WhatsApp subisse, todas dispararariam de uma vez. Corrigido em 20260817090000.
- Fora da janela de 24h a Meta exige template aprovado, e o Chatwoot repassa a regra em vez de
  contorná-la: sem `template_params` a mensagem grava como `failed`.
- O webhook responde 200 mesmo quando o processamento falha. O Chatwoot **não** reentrega webhook de
  conta em erro (`Webhooks::Trigger` só faz retry para agent_bot), então um 500 seria mensagem
  perdida. A linha fica em `error` e o health check `chatwoot_webhooks` denuncia.
- `supabase/functions` ficou fora do `tsconfig` e do ESLint: é Deno, não Next. Quem valida é o bundle
  do `supabase functions deploy`.

## Onde roda

Contrariando a letra do ADR 001 — que previa Edge Function para o gateway e worker fora do Next —,
mas seguindo o mesmo espírito: **tudo em Supabase, Vercel só hospeda o app**.

| Componente | Papel |
|---|---|
| `chatwoot-webhook` | ingresso único, verifica HMAC, grava em `chatwoot_events`, espelha |
| `chatwoot-outbound` | escrita do app, com verificação de participação e rate limit |
| `chatwoot-dispatch` | consumidor da outbox, acordado por `pg_cron` + `pg_net` |
| `chatwoot-provision` | cria contato/usuário, idempotente por `chatwoot_identities` |

Segredos no Vault, nunca em migration. O recorte da fila fica em
`reservar_notificacoes_whatsapp()`, no banco, e não dentro da function — é lá que dá para revisar e
testar, que foi a lição escrita no cabeçalho de `src/lib/notificacoes-canal.ts`.

## Addendum — worker de sync de PII e widget do site (31/08/2026)

Duas peças que ficaram só no schema/documentadas em comentário ganharam código:

- **`chatwoot-pii-sync`** (migration `20260831100000`): worker acordado por
  `pg_cron` a cada 5 minutos, que lê `conversas_pendentes_sync_pii()` (nova
  função — conversa com `chatwoot_conversation_id`, `handoff_liberado()` e pelo
  menos um participante com `chatwoot_identities.pii_synced_at is null`),
  chama `pii_liberado_para_chatwoot()` por conversa e faz `PUT /contacts/{id}`
  com telefone/e-mail antes de `marcar_pii_sincronizado_chatwoot()`. Até aqui
  essas duas RPCs (de 15/08) não tinham consumidor — handoff liberado e duplo
  consentimento não bastavam para o contato do Chatwoot receber o telefone.
  Configuração manual (uma vez, como o `chatwoot_dispatch_url`):
  ```
  select vault.create_secret(
    'https://<ref>.supabase.co/functions/v1/chatwoot-pii-sync',
    'chatwoot_pii_sync_url', 'URL da Edge Function de sync de PII');
  ```
  Reutiliza o secret `chatwoot_worker_key` já existente. Ganhou health check
  próprio (`chatwoot_pii_sync` em `avaliar_saude_sistema()`) e cobertura pgTAP
  em `92_chatwoot.test.sql`.

- **Widget do site** (`src/components/ChatwootWidget.tsx`, montado em
  `src/app/layout.tsx`): sobe em toda página pública quando
  `NEXT_PUBLIC_CHATWOOT_BASE_URL`/`NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN` existem;
  some em `/painel/**` e `/admin/**` (o painel já tem o chat próprio). Roda em
  modo **anônimo/não-verificado** — não implementa `identifier_hash`
  (`_shared/assinatura.ts` já tem a função pronta, mas sem caller). Fica
  independente da flag `chatwoot_messaging`: o comentário original da migration
  `20260815095000` previa "widget subir identificado" como algo que a flag
  governaria, mas como o `identifier_hash` não foi implementado nesta rodada,
  essa parte do contrato original não está coberta. **Endurecer o widget**
  (`identifier_hash` + `--endurecer-widget` do `chatwoot-setup.mjs`) continua
  pendente como trabalho futuro — sem ele, um visitante poderia teoricamente se
  passar por outro contato existente no widget, mas o risco só é real depois
  que o widget também tiver `setUser()` identificando um usuário logado, o que
  não é o caso hoje.

## Limites conhecidos

- **Uma conversa por par cliente↔profissional.** `conversations` tem `unique (cliente_id,
  professional_id)` e isso não mudou. Todo contexto (pedido, serviço) cai na mesma thread.
- **Edição de mensagem não é espelhada.** `messages` não tem policy de UPDATE porque mensagem
  enviada não se altera — é o registro que sustenta a arbitragem. `message_updated` é ignorado.
- **Conversa iniciada no Chatwoot não vira conversa no FrioHub.** Atendimento que chega pelo widget
  ou pelo WhatsApp do suporte vive só lá; não há par cliente↔profissional para espelhar.
- **Instagram e Facebook exigem OAuth** e não podem ser criados por API.

## Alternativas rejeitadas

- **Técnico usando o painel do Chatwoot** (com uma inbox por profissional para isolar): funciona,
  mas o painel de administração degrada acima de algumas centenas de inboxes, e o telefone do
  cliente fica visível na ficha do contato. Foi o desenho inicial, descartado.
- **Ler direto da API do Chatwoot, sem espelho**: perde Realtime, RLS, handoff e auditoria.
- **Evolution API / Baileys**: `Channel::Whatsapp::PROVIDERS` é `%w[default whatsapp_cloud]` — não há
  suporte nativo, exigiria bridge própria, e o número pode ser banido pela Meta, derrubando o canal
  principal da operação.
- **Regra de negócio nas automações do Chatwoot**: elas não alcançam estado do FrioHub e falham em
  silêncio quando a condição não casa. Ficam com roteamento e rotulagem.

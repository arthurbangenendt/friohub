/* Configuração declarativa da conta do Chatwoot.
 *
 * Roda quantas vezes for preciso: cada etapa consulta o que já existe e só cria
 * o que falta. A segunda execução não deve criar nada — é assim que se verifica
 * que o script está correto.
 *
 * O que ele NÃO faz, porque a API não permite:
 *   · vincular a conta ao PlatformApp (só console Rails no servidor — ver
 *     docs/ADR_004_CHATWOOT.md, Fase 0);
 *   · criar inbox de Instagram/Facebook (exige OAuth, só pelo painel);
 *   · aprovar template de WhatsApp (é no WhatsApp Business Manager, da Meta).
 *
 * Uso:
 *   CHATWOOT_BASE_URL=https://chat.exemplo.site \
 *   CHATWOOT_ACCOUNT_ID=16 \
 *   CHATWOOT_API_TOKEN=... \
 *   CHATWOOT_WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/chatwoot-webhook \
 *   node scripts/chatwoot-setup.mjs [--dry-run]
 */

const BASE_URL = process.env.CHATWOOT_BASE_URL?.replace(/\/+$/, "");
const ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID;
const API_TOKEN = process.env.CHATWOOT_API_TOKEN;
const WEBHOOK_URL = process.env.CHATWOOT_WEBHOOK_URL;
const DRY_RUN = process.argv.includes("--dry-run");
/* Passo separado de propósito: exige que o app já mande identifier_hash.
   Ver o comentário no bloco do widget. */
const ENDURECER_WIDGET = process.argv.includes("--endurecer-widget");

/* Fuso e domínio da praça. `NEXT_PUBLIC_*` porque são os mesmos valores que o
   app já usa em src/lib/regiao.ts — não inventamos uma segunda fonte. */
const TIMEZONE = process.env.CHATWOOT_TIMEZONE ?? "America/Sao_Paulo";
const SITE_URL = process.env.CHATWOOT_SITE_URL ?? "https://friohub.vercel.app";

if (!BASE_URL || !ACCOUNT_ID || !API_TOKEN) {
  console.error(
    "Faltam variáveis: CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID e CHATWOOT_API_TOKEN são obrigatórias.",
  );
  process.exit(1);
}

const criados = [];
const mantidos = [];

async function api(method, path, body) {
  const res = await fetch(`${BASE_URL}/api/v1/accounts/${ACCOUNT_ID}${path}`, {
    method,
    headers: { "Content-Type": "application/json", api_access_token: API_TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const texto = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status} ${texto.slice(0, 400)}`);
  }
  return texto ? JSON.parse(texto) : null;
}

/* As coleções do Chatwoot não têm formato único: umas devolvem array puro
   (teams, agents), outras embrulham em `payload` (labels, automation_rules,
   inboxes) e webhooks embrulha duas vezes. */
function lista(resposta, chave) {
  if (Array.isArray(resposta)) return resposta;
  if (Array.isArray(resposta?.payload)) return resposta.payload;
  if (chave && Array.isArray(resposta?.payload?.[chave])) return resposta.payload[chave];
  return [];
}

async function garantir({ rotulo, existente, criar }) {
  if (existente) {
    mantidos.push(rotulo);
    return existente;
  }
  if (DRY_RUN) {
    criados.push(`${rotulo} (dry-run)`);
    return null;
  }
  const novo = await criar();
  criados.push(rotulo);
  return novo;
}

// ---------------------------------------------------------------------------
// Estado desejado
// ---------------------------------------------------------------------------

/* As réguas de atendimento. Um time por régua, e não um por pessoa: a fila é
   do processo, não de quem está de plantão. */
const TIMES = [
  ["Pré-venda", "Visitante e cliente novo, antes do primeiro pedido de orçamento."],
  ["Onboarding de técnico", "Cadastro, verificação e primeira proposta do profissional."],
  ["Pós-venda — cliente", "Dúvida ou problema do consumidor final depois do serviço fechado."],
  ["Pós-venda — técnico", "Dúvida do parceiro sobre pedido, repasse, avaliação e agenda."],
  ["Suporte da plataforma", "Bug, acesso, conta e cobrança — o que é do produto, não do serviço."],
  ["Distribuidoras", "Terceiro lado do marketplace: catálogo, custo e repasse."],
];

const LABELS = [
  ["pre-venda", "Conversa anterior ao primeiro pedido", "#1F93FF"],
  ["onboarding", "Jornada de cadastro do técnico", "#7C3AED"],
  ["pos-venda", "Atendimento depois do serviço fechado", "#059669"],
  ["suporte", "Problema de produto, acesso ou conta", "#DC2626"],
  ["financeiro", "Cobrança, repasse e nota", "#D97706"],
  ["cliente", "Consumidor final", "#0EA5E9"],
  ["profissional", "Técnico parceiro", "#8B5CF6"],
  ["distribuidora", "Parceiro distribuidor", "#0F766E"],
  ["urgente", "Precisa de resposta hoje", "#B91C1C"],
  ["handoff-whatsapp", "Conversa migrou para o WhatsApp", "#22C55E"],
];

/* attribute_model: 0 = conversa, 1 = contato.
   attribute_display_type: 0 = text, 6 = list.
   Valores de lista em MINÚSCULAS: o filtro de automação compara com LOWER(). */
const ATRIBUTOS = [
  // Quem é a pessoa — vive no contato, acompanha todas as conversas dela.
  ["friohub_profile_id", "ID FrioHub", 0, 1, [], "UUID em public.profiles."],
  ["friohub_papel", "Papel", 6, 1, ["cliente", "profissional", "distribuidora", "visitante"], "Papel na plataforma."],
  ["friohub_jornada", "Jornada", 6, 1, ["visitante", "cadastro", "onboarding", "ativo", "inativo"], "Ponto da jornada — é o que decide a régua."],
  ["friohub_verificacao", "Verificação", 6, 1, ["pendente", "em_analise", "verificado", "rejeitado"], "Espelha professionals.verification_status."],
  ["friohub_plano", "Plano", 6, 1, ["gratis", "trial", "ativa", "inadimplente", "cancelada"], "Espelha professionals.subscription_status."],
  ["friohub_cidade", "Cidade", 0, 1, [], "Praça de atendimento."],
  // Sobre o que é a conversa — vive na conversa.
  ["friohub_contexto", "Contexto", 6, 0, ["pre_venda", "cadastro", "orcamento", "servico", "pos_venda", "suporte", "financeiro"], "Assunto desta conversa."],
  ["friohub_job_id", "Serviço", 0, 0, [], "UUID em public.jobs."],
  ["friohub_quote_request_id", "Pedido", 0, 0, [], "UUID em public.quote_requests."],
  ["friohub_profissional_id", "Profissional", 0, 0, [], "UUID do profissional responsável."],
];

const RESPOSTAS_PRONTAS = [
  ["ola", "Olá! Aqui é a FrioHub. Em que posso ajudar com sua climatização?"],
  ["prazo-orcamento", "Assim que um técnico da sua região responder, você recebe o orçamento por aqui. Costuma levar algumas horas em horário comercial."],
  ["cadastro-docs", "Para concluir seu cadastro de técnico, complete o perfil com especialidades, cidade e raio de atendimento. A verificação é feita pela nossa equipe."],
  ["visita-tecnica", "Nesse caso o profissional precisa fazer uma visita técnica para medir o ambiente antes de fechar o valor. A visita costuma ser abatida do serviço."],
  ["garantia", "Todo serviço fechado pela FrioHub tem a garantia informada na proposta. Se algo saiu do combinado, me conte o que aconteceu que eu abro um chamado."],
];

// ---------------------------------------------------------------------------
async function main() {
  console.log(`Conta ${ACCOUNT_ID} em ${BASE_URL}${DRY_RUN ? " (dry-run)" : ""}\n`);

  // --- Times -----------------------------------------------------------
  /* O Chatwoot minúscula o nome do time na gravação ("Pré-venda" volta como
     "pré-venda"), então comparar exato faria o script recriar tudo a cada
     execução — e o POST falha com 422 "Name has already been taken". Labels,
     atributos e automações preservam a grafia; só times normalizam. */
  const chaveTime = (nome) => nome.toLocaleLowerCase("pt-BR");
  const timesExistentes = lista(await api("GET", "/teams"));
  const timePorNome = new Map(timesExistentes.map((t) => [chaveTime(t.name), t]));

  for (const [name, description] of TIMES) {
    const time = await garantir({
      rotulo: `time "${name}"`,
      existente: timePorNome.get(chaveTime(name)),
      criar: () => api("POST", "/teams", { name, description, allow_auto_assign: true }),
    });
    if (time) timePorNome.set(chaveTime(name), time);
  }

  // --- Labels ----------------------------------------------------------
  const labelsExistentes = lista(await api("GET", "/labels"));
  const labelPorTitulo = new Set(labelsExistentes.map((l) => l.title));

  for (const [title, description, color] of LABELS) {
    await garantir({
      rotulo: `label "${title}"`,
      existente: labelPorTitulo.has(title) || null,
      criar: () => api("POST", "/labels", { title, description, color, show_on_sidebar: true }),
    });
  }

  // --- Atributos customizados ------------------------------------------
  /* A listagem é filtrada por modelo; sem o parâmetro o Chatwoot devolve só o
     modelo padrão e o script recriaria os do outro a cada execução. */
  const atributosExistentes = [
    ...lista(await api("GET", "/custom_attribute_definitions?attribute_model=0")),
    ...lista(await api("GET", "/custom_attribute_definitions?attribute_model=1")),
  ];
  const chavesExistentes = new Set(atributosExistentes.map((a) => a.attribute_key));

  for (const [key, nome, tipo, modelo, valores, descricao] of ATRIBUTOS) {
    await garantir({
      rotulo: `atributo "${key}"`,
      existente: chavesExistentes.has(key) || null,
      criar: () =>
        api("POST", "/custom_attribute_definitions", {
          attribute_key: key,
          attribute_display_name: nome,
          attribute_display_type: tipo,
          attribute_model: modelo,
          attribute_values: valores,
          attribute_description: descricao,
        }),
    });
  }

  // --- Inboxes ---------------------------------------------------------
  const inboxes = lista(await api("GET", "/inboxes"));

  /* Uma única inbox de API para todo o peer-to-peer. O isolamento entre
     técnicos NÃO depende dela: o profissional entra como assignee e não é
     membro de inbox nenhuma. Ver a migration 20260815090000. */
  const NOME_MARKETPLACE = "FrioHub — Marketplace";
  const marketplace = await garantir({
    rotulo: `inbox "${NOME_MARKETPLACE}"`,
    existente: inboxes.find((i) => i.name === NOME_MARKETPLACE),
    criar: () =>
      api("POST", "/inboxes", {
        name: NOME_MARKETPLACE,
        channel: { type: "api" },
        lock_to_single_conversation: true,
      }),
  });

  /* Ajustes do widget que já existia: horário, idioma, CSAT. São seguros de
     aplicar a qualquer momento.

     `hmac_mandatory` NÃO entra aqui. Ele é o ajuste que mais importa — sem ele
     qualquer visitante chama setUser() com o id de outra pessoa e assume a
     identidade dela —, mas ligá-lo antes de o app calcular `identifier_hash`
     derruba o widget que está no ar hoje. Fica em `--endurecer-widget`, para
     rodar depois que a Fase 4 estiver publicada. */
  const widget = inboxes.find((i) => i.channel_type === "Channel::WebWidget");
  if (widget && !DRY_RUN) {
    await api("PATCH", `/inboxes/${widget.id}`, {
      timezone: TIMEZONE,
      working_hours_enabled: true,
      csat_survey_enabled: true,
      greeting_enabled: true,
      greeting_message: "Oi! Somos a FrioHub. Conta pra gente o que você precisa que a gente te direciona.",
      out_of_office_message:
        "Recebemos sua mensagem fora do horário de atendimento. Respondemos no próximo dia útil, por aqui mesmo.",
      working_hours: [
        { day_of_week: 0, closed_all_day: true },
        ...[1, 2, 3, 4, 5].map((d) => ({
          day_of_week: d,
          closed_all_day: false,
          open_hour: 8,
          open_minutes: 0,
          close_hour: 18,
          close_minutes: 0,
        })),
        { day_of_week: 6, closed_all_day: false, open_hour: 8, open_minutes: 0, close_hour: 12, close_minutes: 0 },
      ],
      channel: {
        allowed_domains: new URL(SITE_URL).host,
        website_url: SITE_URL,
        welcome_title: "Bem-vindo(a) à FrioHub",
        welcome_tagline: "Ar-condicionado com técnico verificado, do orçamento à garantia.",
        reply_time: "in_a_few_minutes",
      },
    });
    mantidos.push(`inbox do site ajustada (id ${widget.id})`);

    if (ENDURECER_WIDGET) {
      await api("PATCH", `/inboxes/${widget.id}`, { channel: { hmac_mandatory: true } });
      criados.push(`validação de identidade obrigatória no widget (id ${widget.id})`);
    } else if (!widget.hmac_mandatory) {
      console.warn(
        `  ! widget ${widget.id} aceita identidade não validada. Rode com --endurecer-widget depois que o app enviar identifier_hash.`,
      );
    }
  }

  // --- Automações ------------------------------------------------------
  const idDoTime = (nome) => timePorNome.get(chaveTime(nome))?.id;
  const idsWidget = widget ? [widget.id] : [];

  /* Regra de ouro do formato, aprendida no código do Chatwoot:
     · `custom_attribute_type` é OBRIGATÓRIO em condição de atributo. O default
       interno é 'contact_attribute'; omitir num atributo de conversa faz a
       busca cair no modelo errado, não achar a definição e devolver fragmento
       vazio — a regra passa a nunca casar, sem erro nenhum.
     · No máximo UMA condição pode ter query_operator nulo, e ela é a última
       (AutomationRule#query_operator_presence).
     · Valores de texto/lista em minúsculas: a comparação usa LOWER(). */
  const contato = (key, values, query_operator = "and") => ({
    attribute_key: key,
    filter_operator: "equal_to",
    values,
    custom_attribute_type: "contact_attribute",
    query_operator,
  });
  const naInbox = (ids) => ({
    attribute_key: "inbox_id",
    filter_operator: "equal_to",
    values: ids,
    query_operator: "and",
  });

  const REGRAS = [
    {
      name: "Roteamento: visitante para Pré-venda",
      description: "Quem chega sem sessão identificada cai na fila comercial.",
      event_name: "conversation_created",
      conditions: [naInbox(idsWidget), contato("friohub_papel", ["visitante"], null)],
      actions: [
        { action_name: "assign_team", action_params: [idDoTime("Pré-venda")] },
        { action_name: "add_label", action_params: ["pre-venda"] },
      ],
    },
    {
      name: "Roteamento: técnico em cadastro para Onboarding",
      description: "Profissional que ainda não terminou o cadastro fala com quem cuida de verificação.",
      event_name: "conversation_created",
      conditions: [
        contato("friohub_papel", ["profissional"]),
        contato("friohub_jornada", ["cadastro", "onboarding"], null),
      ],
      actions: [
        { action_name: "assign_team", action_params: [idDoTime("Onboarding de técnico")] },
        { action_name: "add_label", action_params: ["onboarding"] },
        { action_name: "add_label", action_params: ["profissional"] },
      ],
    },
    {
      name: "Roteamento: técnico ativo para Pós-venda técnico",
      description: "Parceiro já operando: dúvida de pedido, repasse, agenda ou avaliação.",
      event_name: "conversation_created",
      conditions: [contato("friohub_papel", ["profissional"]), contato("friohub_jornada", ["ativo"], null)],
      actions: [
        { action_name: "assign_team", action_params: [idDoTime("Pós-venda — técnico")] },
        { action_name: "add_label", action_params: ["pos-venda"] },
        { action_name: "add_label", action_params: ["profissional"] },
      ],
    },
    {
      name: "Roteamento: cliente ativo para Pós-venda cliente",
      description: "Consumidor final que já tem pedido ou serviço na plataforma.",
      event_name: "conversation_created",
      conditions: [contato("friohub_papel", ["cliente"]), contato("friohub_jornada", ["ativo"], null)],
      actions: [
        { action_name: "assign_team", action_params: [idDoTime("Pós-venda — cliente")] },
        { action_name: "add_label", action_params: ["pos-venda"] },
        { action_name: "add_label", action_params: ["cliente"] },
      ],
    },
    {
      name: "Roteamento: distribuidora",
      description: "Terceiro lado do marketplace tem fila própria.",
      event_name: "conversation_created",
      conditions: [contato("friohub_papel", ["distribuidora"], null)],
      actions: [
        { action_name: "assign_team", action_params: [idDoTime("Distribuidoras")] },
        { action_name: "add_label", action_params: ["distribuidora"] },
      ],
    },
    {
      /* Palavra-chave é heurística grosseira e assumidamente falível: serve
         para priorizar, nunca para fechar ou responder sozinha. */
      name: "Triagem: sinal de problema de plataforma",
      description: "Marca e prioriza quem descreve falha de acesso ou erro do produto.",
      event_name: "message_created",
      conditions: [
        {
          attribute_key: "message_type",
          filter_operator: "equal_to",
          values: ["incoming"],
          query_operator: "and",
        },
        {
          attribute_key: "content",
          filter_operator: "contains",
          values: ["senha", "não consigo entrar", "erro", "bug", "travou", "fora do ar"],
          query_operator: null,
        },
      ],
      actions: [
        { action_name: "add_label", action_params: ["suporte"] },
        { action_name: "change_priority", action_params: ["high"] },
      ],
    },
  ];

  const regrasExistentes = lista(await api("GET", "/automation_rules"));
  const regraPorNome = new Set(regrasExistentes.map((r) => r.name));

  for (const regra of REGRAS) {
    /* Regra que aponta para um time inexistente casaria e não atribuiria nada,
       o que é pior que não existir: a conversa ficaria sem dono, marcada como
       roteada. */
    const alvoInvalido = regra.actions.some(
      (a) => a.action_name === "assign_team" && !a.action_params[0],
    );
    const semInbox = regra.conditions.some(
      (c) => c.attribute_key === "inbox_id" && c.values.length === 0,
    );

    if (alvoInvalido || semInbox) {
      const motivo = alvoInvalido ? "time de destino" : "inbox de origem";
      /* Em dry-run isso é esperado: os times e a inbox seriam criados agora e
         ainda não têm id. Numa execução real, é problema de verdade. */
      console.warn(
        DRY_RUN
          ? `  · "${regra.name}" será criada depois que o ${motivo} existir`
          : `  ! pulando "${regra.name}": ${motivo} não existe`,
      );
      continue;
    }

    await garantir({
      rotulo: `automação "${regra.name}"`,
      existente: regraPorNome.has(regra.name) || null,
      criar: () => api("POST", "/automation_rules", { ...regra, active: true }),
    });
  }

  // --- Respostas prontas ------------------------------------------------
  const respostasExistentes = lista(await api("GET", "/canned_responses"));
  const codigosExistentes = new Set(respostasExistentes.map((r) => r.short_code));

  for (const [short_code, content] of RESPOSTAS_PRONTAS) {
    await garantir({
      rotulo: `resposta pronta "/${short_code}"`,
      existente: codigosExistentes.has(short_code) || null,
      criar: () => api("POST", "/canned_responses", { short_code, content }),
    });
  }

  // --- Webhook ----------------------------------------------------------
  let segredoWebhook = null;
  if (WEBHOOK_URL) {
    const webhooksExistentes = lista(await api("GET", "/webhooks"), "webhooks");
    const jaExiste = webhooksExistentes.find((w) => w.url === WEBHOOK_URL);

    const webhook = await garantir({
      rotulo: `webhook ${WEBHOOK_URL}`,
      existente: jaExiste,
      criar: () =>
        api("POST", "/webhooks", {
          url: WEBHOOK_URL,
          subscriptions: [
            "conversation_created",
            "conversation_updated",
            "conversation_status_changed",
            "message_created",
            "message_updated",
            "contact_updated",
          ],
        }),
    });
    segredoWebhook = webhook?.payload?.secret ?? webhook?.secret ?? null;
  } else {
    console.warn("  ! CHATWOOT_WEBHOOK_URL não informada — webhook não configurado.\n");
  }

  // --- Resumo -----------------------------------------------------------
  console.log(`Criados (${criados.length}):`);
  criados.forEach((c) => console.log(`  + ${c}`));
  console.log(`\nJá existiam (${mantidos.length}):`);
  mantidos.forEach((m) => console.log(`  = ${m}`));

  if (marketplace) {
    console.log(`\nInbox do marketplace: id ${marketplace.id}`);
    console.log("  Guarde como CHATWOOT_MARKETPLACE_INBOX_ID nos segredos do Supabase.");
  }
  if (segredoWebhook) {
    console.log("\nSegredo do webhook gerado pelo Chatwoot.");
    console.log("  Guarde como CHATWOOT_WEBHOOK_SECRET nos segredos do Supabase.");
    console.log("  Ele NÃO é exibido de novo em criações futuras — copie agora:");
    console.log(`  ${segredoWebhook}`);
  }
  if (criados.length === 0) {
    console.log("\nNada a criar: a conta já está no estado desejado.");
  }
}

main().catch((erro) => {
  console.error(`\nFalhou: ${erro.message}`);
  process.exit(1);
});

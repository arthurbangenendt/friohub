/* Apresentação das notificações.
 *
 * O banco guarda evento cru (`quote_request_received`) mais um payload pequeno.
 * Traduzir isso para uma frase que o usuário entenda é trabalho de interface, e
 * fica aqui — num lugar só — porque o inbox, o sino e um futuro e-mail precisam
 * dizer exatamente a mesma coisa. Se o texto morasse na tela, o e-mail
 * inevitavelmente diria outra.
 *
 * Regra dos textos: dizer o que aconteceu e o que a pessoa ganha abrindo. Nada
 * de "Atualização no sistema".
 */

export type EventoNotificacao =
  | "quote_request_received" | "quote_received" | "quote_accepted"
  | "quote_cancelled" | "quote_declined" | "new_message" | "job_updated"
  | "appointment_proposed" | "appointment_confirmed" | "appointment_cancelled"
  | "appointment_reminder" | "pmoc_offered" | "pmoc_activated" | "pmoc_visit_due"
  | "purchase_order_created" | "purchase_order_updated"
  | "payment_received" | "subscription_overdue" | "pix_key_changed";

export type CategoriaNotificacao =
  | "quote_requests" | "quotes" | "messages" | "reminders" | "job_updates" | "purchase_orders";

/* ESPELHO de `public.categoria_notificacao(text)` — ver
 * supabase/migrations/20260814120000_inbox_notificacoes.sql.
 *
 * O banco é a fonte de verdade: é ele que decide, no enfileiramento, se o
 * evento respeita a preferência da categoria. Esta cópia existe só para o shell
 * agrupar os contadores dos badges sem uma ida a mais ao banco por linha.
 * Mexeu num, mexa no outro — a divergência aqui não quebra nada visivelmente,
 * ela só faz o número do badge parar de bater com a lista.
 */
export function categoriaNotificacao(evento: string): CategoriaNotificacao {
  if (evento === "quote_request_received") return "quote_requests";
  if (["quote_received", "quote_accepted", "quote_cancelled", "quote_declined"].includes(evento)) return "quotes";
  if (evento === "new_message") return "messages";
  if (["appointment_proposed", "appointment_confirmed", "appointment_cancelled", "appointment_reminder", "pmoc_visit_due"].includes(evento)) return "reminders";
  if (["purchase_order_created", "purchase_order_updated"].includes(evento)) return "purchase_orders";
  return "job_updates";
}

export type NotificacaoBruta = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

export type NotificacaoView = {
  id: string;
  titulo: string;
  detalhe: string | null;
  href: string | null;
  /* Reaproveita o vocabulário de tons de `@/lib/status`, para o inbox não
     inventar uma terceira paleta. */
  tom: "neutro" | "espera" | "andamento" | "sucesso" | "erro";
  lida: boolean;
  criadaEm: string;
};

const texto = (p: Record<string, unknown> | null, chave: string): string | null => {
  const v = p?.[chave];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

const dataHora = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/* Para onde o clique leva. Eventos de agendamento guardam o `job_id` no
   payload, e não no `aggregate_id` — este aponta para o agendamento, que não
   tem tela própria. */
function destino(n: NotificacaoBruta): string | null {
  const jobDoPayload = texto(n.payload, "job_id");
  switch (n.aggregate_type) {
    case "quote_request": return `/painel/orcamentos/${n.aggregate_id}`;
    case "job":           return `/servico/${n.aggregate_id}`;
    case "conversation":  return `/painel/mensagens/${n.aggregate_id}`;
    case "appointment":   return jobDoPayload ? `/servico/${jobDoPayload}` : null;
    case "pmoc_plan":
    case "pmoc_visit":    return "/painel/pmoc";
    case "professional":  return "/painel/perfil";
    /* Mesmo aggregate_type, destinos diferentes: quem cria o repasse
       (distribuidora) precisa da lista de pedidos; quem acompanha a entrega
       (cliente/profissional) precisa da linha do tempo do job específico. */
    case "purchase_order":
      return n.event_type === "purchase_order_created"
        ? "/painel/distribuidora/pedidos"
        : jobDoPayload ? `/servico/${jobDoPayload}/aparelho` : null;
    default:              return null;
  }
}

function conteudo(n: NotificacaoBruta): Pick<NotificacaoView, "titulo" | "detalhe" | "tom"> {
  const p = n.payload;

  switch (n.event_type as EventoNotificacao) {
    case "quote_request_received":
      return { titulo: "Novo pedido de orçamento na sua região", detalhe: "Responder rápido aumenta sua chance de fechar.", tom: "espera" };

    case "quote_received":
      return { titulo: "Você recebeu uma proposta", detalhe: "Compare valores, prazo e garantia antes de decidir.", tom: "andamento" };

    case "quote_accepted":
      return { titulo: "Sua proposta foi aceita", detalhe: "Combine o horário com o cliente para começar.", tom: "sucesso" };

    case "quote_declined":
      return { titulo: "Um profissional não vai atender seu pedido", detalhe: texto(p, "reason"), tom: "neutro" };

    case "quote_cancelled":
      return { titulo: "O cliente cancelou o pedido de orçamento", detalhe: texto(p, "reason"), tom: "erro" };

    case "new_message":
      return { titulo: "Nova mensagem", detalhe: "Abra a conversa para responder.", tom: "andamento" };

    case "job_updated": {
      /* `to_status` reusa o mesmo vocabulário de `STATUS_JOB`; traduzir aqui de
         novo criaria uma terceira grafia para o mesmo estado. */
      const para = texto(p, "to_status");
      const rotulo: Record<string, { t: string; tom: NotificacaoView["tom"] }> = {
        aceito:      { t: "Seu serviço foi aceito", tom: "sucesso" },
        em_execucao: { t: "O serviço começou", tom: "andamento" },
        concluido:   { t: "Serviço concluído", tom: "sucesso" },
        cancelado:   { t: "O serviço foi cancelado", tom: "erro" },
      };
      const r = (para && rotulo[para]) || { t: "Seu serviço mudou de situação", tom: "andamento" as const };
      return { titulo: r.t, detalhe: para === "concluido" ? "Avalie o atendimento — sua nota orienta outros clientes." : null, tom: r.tom };
    }

    case "appointment_proposed":
      return { titulo: "Novo horário proposto", detalhe: dataHora(texto(p, "starts_at")), tom: "espera" };

    case "appointment_confirmed":
      return { titulo: "Horário confirmado", detalhe: dataHora(texto(p, "starts_at")), tom: "sucesso" };

    case "appointment_cancelled":
      return { titulo: "Agendamento cancelado", detalhe: texto(p, "reason") ?? dataHora(texto(p, "starts_at")), tom: "erro" };

    case "appointment_reminder":
      return { titulo: "Lembrete de atendimento", detalhe: dataHora(texto(p, "starts_at")), tom: "espera" };

    case "pmoc_offered": {
      const local = [texto(p, "company_name"), texto(p, "site_name")].filter(Boolean).join(" · ");
      return { titulo: "Plano de manutenção oferecido a você", detalhe: local || null, tom: "espera" };
    }

    case "pmoc_activated":
      return { titulo: "Seu plano de manutenção está ativo", detalhe: texto(p, "first_due_date") ? `Primeira visita em ${texto(p, "first_due_date")}` : null, tom: "sucesso" };

    case "pmoc_visit_due":
      return { titulo: "Visita de manutenção a vencer", detalhe: [texto(p, "site_name"), texto(p, "due_date")].filter(Boolean).join(" · ") || null, tom: "espera" };

    case "purchase_order_created":
      return { titulo: "Novo pedido para despachar", detalhe: "Confira o endereço e os itens antes de confirmar.", tom: "espera" };

    case "purchase_order_updated": {
      /* Mesmos rótulos de STATUS_ENTREGA_CLIENTE (src/lib/status.ts), pra não
         inventar uma terceira redação do mesmo estado do repasse. */
      const status = texto(p, "status_novo");
      const dist = texto(p, "distribuidora");
      const rotulo: Record<string, { t: string; tom: NotificacaoView["tom"] }> = {
        a_repassar: { t: "Pedido enviado à distribuidora", tom: "espera" },
        confirmado: { t: "Confirmado pela distribuidora", tom: "andamento" },
        faturado:   { t: "Nota fiscal emitida", tom: "andamento" },
        enviado:    { t: "Seu aparelho está a caminho", tom: "andamento" },
        entregue:   { t: "Aparelho entregue", tom: "sucesso" },
        cancelado:  { t: "Pedido de aparelho cancelado", tom: "erro" },
      };
      const r = (status && rotulo[status]) || { t: "Atualização no pedido do aparelho", tom: "andamento" as const };
      return { titulo: r.t, detalhe: dist ? `Distribuidora: ${dist}` : null, tom: r.tom };
    }

    case "payment_received": {
      const valor = p?.amount;
      return { titulo: "Pagamento do serviço confirmado", detalhe: typeof valor === "number" || typeof valor === "string" ? `Valor: ${valor}` : null, tom: "sucesso" };
    }

    case "subscription_overdue":
      return { titulo: "Sua assinatura está com pagamento em atraso", detalhe: "Regularize para não perder os benefícios do seu plano.", tom: "erro" };

    case "pix_key_changed":
      return { titulo: "Sua chave PIX de recebimento foi alterada", detalhe: "Se não foi você, entre em contato com o suporte agora.", tom: "erro" };

    default:
      /* Evento novo no banco que a interface ainda não conhece. Mostrar a chave
         crua é feio, mas some silenciosamente seria pior: a pessoa perderia uma
         notificação real e ninguém saberia. */
      return { titulo: "Atualização no seu atendimento", detalhe: n.event_type, tom: "neutro" };
  }
}

export function paraView(n: NotificacaoBruta): NotificacaoView {
  return {
    id: n.id,
    ...conteudo(n),
    href: destino(n),
    lida: n.read_at !== null,
    criadaEm: n.created_at,
  };
}

/** "agora", "há 12 min", "há 3 h", "ontem", "12 de mar". */
export function tempoRelativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "ontem";
  if (dias < 7) return `há ${dias} dias`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

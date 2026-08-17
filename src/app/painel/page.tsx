import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PainelParceiro } from "./PainelParceiro";
import { PainelCliente } from "./PainelCliente";
import type { Filtro, JobRow, OrderRow } from "./shared";
import type { AcaoCentral, ProximoAtendimento, ResumoCentral } from "./CentralAcoes";
import { rotuloJob } from "@/app/solicitar/tipos";

type AlvoOrcamento = {
  quote_request_id: string;
  enviado_em: string;
  visto_em: string | null;
  pedido: { id: string; job_type: string; status: string; expira_em: string; bairro: string | null } | null;
};

type AgendaCentral = {
  starts_at: string;
  status: string;
  proposed_by: string;
  job_id: string;
  job: { id: string; job_type: string; endereco: string | null; cep: string; cliente_id: string; profissional_id: string | null } | null;
};

const uma = <T,>(valor: T | T[] | null): T | null => Array.isArray(valor) ? valor[0] ?? null : valor;

function horasDesde(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
}

function acoesDoCliente(
  pedidos: { id: string; status: string; created_at: string; job_type: string; quotes: { id: string; status: string }[] }[],
  jobs: JobRow[],
): AcaoCentral[] {
  const acoes: AcaoCentral[] = [];
  for (const pedido of pedidos) {
    const recebidas = pedido.quotes.filter((q) => ["enviada", "aceita"].includes(q.status)).length;
    if (pedido.status === "aberto" && recebidas > 0) acoes.push({ id: `propostas-${pedido.id}`, titulo: `${recebidas} proposta${recebidas > 1 ? "s" : ""} para comparar`, detalhe: rotuloJob(pedido.job_type), href: `/painel/orcamentos/${pedido.id}`, prioridade: "agora" });
    else if (pedido.status === "aberto") acoes.push({ id: `aguarda-${pedido.id}`, titulo: "Profissionais analisando seu pedido", detalhe: `${rotuloJob(pedido.job_type)} · avisaremos quando responderem`, href: `/painel/orcamentos/${pedido.id}`, prioridade: "acompanhar" });
  }
  for (const job of jobs) {
    if (job.status === "aguardando_profissional") acoes.push({ id: `job-${job.id}`, titulo: "Aguardando confirmação do profissional", detalhe: rotuloJob(job.job_type), href: `/servico/${job.id}`, prioridade: "acompanhar" });
    if (job.status === "concluido") acoes.push({ id: `avaliar-${job.id}`, titulo: "Conte como foi o serviço", detalhe: "Sua avaliação ajuda a manter a rede confiável", href: `/servico/${job.id}`, prioridade: "hoje" });
  }
  return acoes.slice(0, 8);
}

/* Busca os dados uma vez e delega a renderização ao painel do papel certo.
   Cliente e parceiro veem telas diferentes o suficiente para não caberem num
   arquivo só cheio de `isPro ?` — o que existia antes. */
export default async function PainelPage(props: PageProps<"/painel">) {
  const sp = await props.searchParams;
  const filtro: Filtro = sp.f === "concluidos" || sp.f === "todos" ? sp.f : "ativos";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("nome, role").eq("id", user.id).single();
  const nome = profile?.nome ?? user.email ?? "você";
  const isPro = profile?.role === "profissional";

  const { data: jobsData } = await supabase
    .from("jobs")
    .select(`id, job_type, status, created_at, ambiente, cep, endereco, btu_recomendado,
             produto:products ( marca, modelo ),
             profissional:professionals ( profiles ( nome ) ),
             cliente:profiles!jobs_cliente_id_fkey ( nome )`)
    .order("created_at", { ascending: false })
    .limit(100);
  const jobs = (jobsData ?? []) as JobRow[];

  /* Valores: o profissional lê `orders` (vê a comissão descontada dele), o
     cliente lê a view `orders_cliente`, sem margem nem comissão da plataforma. */
  const { data: ordersData } = isPro
    ? await supabase.from("orders").select("job_id, preco_servico, comissao_servico, total, payment_status")
    : await supabase.from("orders_cliente").select("job_id, preco_servico, total, payment_status");

  const orderPorJob = new Map<string, OrderRow>();
  for (const o of (ordersData ?? []) as ({ job_id: string } & OrderRow)[]) {
    orderPorJob.set(o.job_id, o);
  }

  if (!isPro) {
    const { data: pedidosData } = await supabase
      .from("quote_requests")
      .select("id, status, created_at, job_type, quotes(id, status)")
      .eq("cliente_id", user.id)
      .in("status", ["aberto", "fechado"])
      .order("created_at", { ascending: false })
      .limit(20);
    const pedidos = (pedidosData ?? []) as { id: string; status: string; created_at: string; job_type: string; quotes: { id: string; status: string }[] }[];
    return <PainelCliente nome={nome} jobs={jobs} orderPorJob={orderPorJob} filtro={filtro} acoes={acoesDoCliente(pedidos, jobs)} />;
  }

  // Nota média do profissional: média das especialidades ponderada pelo nº de avaliações.
  const { data: skills } = await supabase
    .from("professional_skills")
    .select("rating_avg, rating_count")
    .eq("professional_id", user.id);

  const totalAval = (skills ?? []).reduce((s, k) => s + (k.rating_count ?? 0), 0);
  const notaMedia = totalAval > 0
    ? (skills ?? []).reduce((s, k) => s + Number(k.rating_avg ?? 0) * (k.rating_count ?? 0), 0) / totalAval
    : null;

  const agora = new Date();
  const emSeteDias = new Date(agora.getTime() + 7 * 86_400_000);
  const inicioHoje = new Date(agora); inicioHoje.setHours(0, 0, 0, 0);
  const fimHoje = new Date(agora); fimHoje.setHours(23, 59, 59, 999);
  const [alvosResult, quotesResult, agendaResult, mensagensResult, followUpsResult] = await Promise.all([
    supabase.from("quote_request_targets")
      .select("quote_request_id, enviado_em, visto_em, pedido:quote_requests(id, job_type, status, expira_em, bairro)")
      .eq("professional_id", user.id).is("recusado_em", null).order("enviado_em", { ascending: false }).limit(30),
    supabase.from("quotes").select("quote_request_id, created_at").eq("professional_id", user.id),
    supabase.from("job_appointments")
      .select("starts_at, status, proposed_by, job_id, job:jobs!inner(id, job_type, endereco, cep, cliente_id, profissional_id)")
      .eq("job.profissional_id", user.id).in("status", ["proposed", "confirmed"])
      .gte("starts_at", agora.toISOString()).lte("starts_at", emSeteDias.toISOString()).order("starts_at"),
    // `or` e não `neq`: mensagem da equipe/automação tem sender_id nulo e `neq` a descartaria (ver painel/layout.tsx).
    supabase.from("messages").select("id", { count: "exact", head: true }).or(`sender_id.is.null,sender_id.neq.${user.id}`).is("read_at", null),
    supabase.from("follow_up_tasks").select("id, quote_request_id, title, due_at")
      .eq("professional_id", user.id).eq("status", "pending").lte("due_at", emSeteDias.toISOString()).order("due_at").limit(10),
  ]);

  const respondidos = new Set((quotesResult.data ?? []).map((q) => q.quote_request_id));
  const alvos = (alvosResult.data ?? []).map((alvo) => ({ ...alvo, pedido: uma(alvo.pedido) })) as AlvoOrcamento[];
  const agenda = (agendaResult.data ?? []).map((item) => ({ ...item, job: uma(item.job) })) as AgendaCentral[];
  const acoes: AcaoCentral[] = [];
  for (const alvo of alvos) {
    if (!alvo.pedido || alvo.pedido.status !== "aberto" || new Date(alvo.pedido.expira_em) <= agora || respondidos.has(alvo.quote_request_id)) continue;
    const horas = horasDesde(alvo.enviado_em);
    acoes.push({
      id: `orcamento-${alvo.quote_request_id}`,
      titulo: alvo.visto_em ? "Responder orçamento aberto" : "Novo orçamento para você",
      detalhe: `${rotuloJob(alvo.pedido.job_type)}${alvo.pedido.bairro ? ` · ${alvo.pedido.bairro}` : ""} · chegou há ${horas < 1 ? "menos de 1h" : `${horas}h`}`,
      href: `/painel/orcamentos/${alvo.quote_request_id}`,
      prioridade: horas >= 2 ? "agora" : "hoje",
    });
  }
  for (const item of agenda) {
    if (item.status === "proposed" && item.proposed_by !== user.id && item.job) acoes.push({ id: `agenda-${item.job_id}`, titulo: "Confirmar horário proposto", detalhe: `${rotuloJob(item.job.job_type)} · ${new Date(item.starts_at).toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`, href: `/servico/${item.job_id}`, prioridade: "agora" });
  }
  const mensagensNaoLidas = mensagensResult.count ?? 0;
  if (mensagensNaoLidas > 0) acoes.push({ id: "mensagens", titulo: `${mensagensNaoLidas} mensagem${mensagensNaoLidas > 1 ? "s" : ""} sem leitura`, detalhe: "Clientes podem estar aguardando sua resposta", href: "/painel/mensagens", prioridade: "hoje" });
  for (const followUp of followUpsResult.data ?? []) {
    const vencido = new Date(followUp.due_at) <= agora;
    acoes.push({
      id: `follow-up-${followUp.id}`,
      titulo: vencido ? `Follow-up vencido: ${followUp.title}` : `Follow-up agendado: ${followUp.title}`,
      detalhe: new Date(followUp.due_at).toLocaleString("pt-BR"),
      href: `/painel/orcamentos/${followUp.quote_request_id}`,
      prioridade: vencido ? "agora" : "acompanhar",
    });
  }
  const prioridade = { agora: 0, hoje: 1, acompanhar: 2 } as const;
  acoes.sort((a, b) => prioridade[a.prioridade] - prioridade[b.prioridade]);

  const proximosConfirmados = agenda.filter((a) => a.status === "confirmed" && a.job);
  const proximo = proximosConfirmados[0];
  const orderProximo = proximo ? orderPorJob.get(proximo.job_id) : null;
  const proximoAtendimento: ProximoAtendimento | null = proximo?.job ? {
    jobId: proximo.job_id,
    startsAt: proximo.starts_at,
    titulo: rotuloJob(proximo.job.job_type),
    contraparte: "Cliente",
    endereco: [proximo.job.endereco, proximo.job.cep].filter(Boolean).join(", "),
    valor: orderProximo ? orderProximo.preco_servico - (orderProximo.comissao_servico ?? 0) : null,
  } : null;
  const central: ResumoCentral = {
    acoes,
    proximoAtendimento,
    compromissosHoje: agenda.filter((a) => new Date(a.starts_at) >= inicioHoje && new Date(a.starts_at) <= fimHoje).length,
    previstoSemana: proximosConfirmados.reduce((s, a) => { const o = orderPorJob.get(a.job_id); return s + (o ? o.preco_servico - (o.comissao_servico ?? 0) : 0); }, 0),
    mensagensNaoLidas,
  };

  return (
    <PainelParceiro
      nome={nome}
      jobs={jobs}
      orderPorJob={orderPorJob}
      filtro={filtro}
      notaMedia={notaMedia}
      semPerfilPro={(skills?.length ?? 0) === 0}
      central={central}
    />
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { rotuloJob } from "../../solicitar/tipos";
import { JobActions } from "./JobActions";
import { ReviewForm } from "./ReviewForm";
import { AvaliarCliente } from "./AvaliarCliente";
import { AbrirChat } from "./AbrirChat";
import { TAG_LABEL } from "./tags-cliente";
import { Star } from "@/components/icons";
import { Agendamento, type AgendamentoView } from "./Agendamento";
import { featureHabilitada } from "@/lib/feature-flags";
import { STATUS_JOB, STATUS_ENTREGA_CLIENTE, resolverMapa } from "@/lib/status";
import { one } from "@/lib/relacional";
import { Rastreio, type EtapaId } from "./Rastreio";
import { Evidencias } from "./Evidencias";
import { Pagamento } from "./Pagamento";
import { ContestarExecucao } from "./ContestarExecucao";
import { CancelarJobPago } from "./CancelarJobPago";
import { OrcamentoFinal } from "./OrcamentoFinal";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const STATUS = resolverMapa(STATUS_JOB);
const STATUS_ENTREGA = resolverMapa(STATUS_ENTREGA_CLIENTE);

// Ordem de avanço do repasse — usada para achar o status MENOS avançado entre
// várias entregas do mesmo job (uma por distribuidora).
const ORDEM_ENTREGA: Record<string, number> = {
  a_repassar: 0, confirmado: 1, faturado: 2, enviado: 3, entregue: 4, cancelado: -1,
};

const PAGAMENTO_LABEL: Record<string, string> = {
  pendente: "Pendente",
  pago: "Pago e liquidado",
  reembolsado: "Reembolsado",
  falhou: "Falhou ou foi cancelado",
};

type OrderView = {
  id: string;
  preco_produto: number;
  preco_servico: number;
  total: number;
  payment_status: string;
  origem: "aceite_quote" | "orcamento_final";
  comissao_servico?: number; // só existe para o profissional
};

/* Profissional e admin leem `orders` direto (a linha completa, com margem e
   comissão — RLS `orders_admin_read`); cliente lê a view `orders_cliente`, que
   não expõe isso. As duas fontes são protegidas no banco — se o papel não
   bater, o retorno é vazio, não um erro.

   Um job pode ter até duas orders: a do aceite da proposta (produto e/ou
   mão de obra, ou a visita técnica) e a do orçamento final pós-visita
   (nasce só depois que o cliente aprova, ver aprovar_orcamento_final). */
async function carregarOrders(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  completo: boolean,
): Promise<OrderView[]> {
  if (completo) {
    const { data } = await supabase
      .from("orders")
      .select("id, preco_produto, preco_servico, comissao_servico, total, payment_status, origem")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });
    return (data ?? []) as OrderView[];
  }
  const { data } = await supabase
    .from("orders_cliente")
    .select("id, preco_produto, preco_servico, total, payment_status, origem")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  return (data ?? []) as OrderView[];
}

export default async function ServicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: job }, { data: perfilLogado }] = await Promise.all([
    supabase
      .from("jobs")
      .select(`id, job_type, status, created_at, ambiente, area_m2, btu_recomendado, cep, endereco, descricao, cliente_id, profissional_id,
               produto:products ( marca, modelo, btu, preco_venda ),
               itens:job_itens ( id, ordem, ambiente, area_m2, btu_recomendado, quantidade,
                                 produto:products ( marca, modelo ) ),
               profissional:professionals ( id, tipo, profiles ( nome ) ),
               cliente:profiles!jobs_cliente_id_fkey ( nome ),
               review:reviews ( rating, comment )`)
      .eq("id", id)
      .single(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);

  if (!job) redirect("/painel");

  const isCliente = job.cliente_id === user.id;
  const isPro = job.profissional_id === user.id;
  const isAdmin = !isCliente && !isPro && perfilLogado?.role === "admin";
  if (!isCliente && !isPro && !isAdmin) redirect("/painel");
  const podeIniciarExecucao = isPro && await featureHabilitada(supabase, "ux_execution", user.id);

  const produto = one(job.produto) as { marca: string; modelo: string; btu: number; preco_venda: number } | null;

  /* Escopo contratado, congelado no aceite. O técnico em campo precisa ver os
     três cômodos que ele fechou, não só o primeiro. */
  type ItemServico = {
    id: string; ordem: number; ambiente: string;
    area_m2: number | null; btu_recomendado: number | null; quantidade: number;
    produto: { marca: string; modelo: string } | null;
  };
  const itens = ((job.itens ?? []) as unknown as ItemServico[])
    .map((item) => ({ ...item, produto: one(item.produto) }))
    .sort((a, b) => a.ordem - b.ordem);
  const proNome = one(one(job.profissional)?.profiles)?.nome ?? "Profissional";
  const cliNome = one(job.cliente)?.nome ?? "Cliente";
  /* As orders vêm de fonte diferente conforme quem olha: o profissional lê a
     tabela (enxerga a comissão descontada dele), o cliente lê a view sem margem
     nem comissão. Ver migration 20260812130000_orders_cliente_view. */
  const orders = await carregarOrders(supabase, job.id, isPro || isAdmin);
  const ordemAceite = orders.find((o) => o.origem === "aceite_quote") ?? null;

  /* Orçamento final só existe para propostas do tipo 'visita_tecnica' — em
     preço fechado o valor do serviço já está definido desde o aceite. */
  const { data: quoteAceita } = await supabase
    .from("quotes")
    .select("tipo")
    .eq("job_id", job.id)
    .eq("status", "aceita")
    .maybeSingle();
  const isVisitaTecnica = quoteAceita?.tipo === "visita_tecnica";

  const { data: orcamentosFinais } = await supabase
    .from("job_final_quotes")
    .select("id, valor_servico, observacoes, status, motivo_recusa, created_at")
    .eq("job_id", job.id)
    .order("created_at", { ascending: false });
  const jfqPendente = (orcamentosFinais ?? []).find((q) => q.status === "enviado") ?? null;
  const jfqUltimo = (orcamentosFinais ?? [])[0] ?? null;
  const jfqUltimoRecusado = !jfqPendente && jfqUltimo?.status === "recusado" ? jfqUltimo : null;
  const podeEnviarOrcamentoFinal =
    isVisitaTecnica &&
    !jfqPendente &&
    ["em_execucao", "aguardando_orcamento_final"].includes(job.status);

  const { data: agendamento } = await supabase
    .from("job_appointments")
    .select("id, proposed_by, starts_at, ends_at, status, notes")
    .eq("job_id", job.id)
    .in("status", ["proposed", "confirmed"])
    .maybeSingle();

  const { data: eventosServico } = await supabase
    .from("job_events")
    .select("id, event_type, from_status, to_status, reason, created_at")
    .eq("job_id", job.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const { data: execucao } = await supabase
    .from("service_executions")
    .select("status, materials, measurements, notes, warranty_until, maintenance_due, finalized_at, evidence_paths")
    .eq("job_id", job.id)
    .maybeSingle();

  /* Data de cada etapa do rastreio, tirada do histórico. `job_events` vem em
     ordem decrescente, então o primeiro encontrado por status é o mais recente;
     percorrer ao contrário guarda a PRIMEIRA vez que o serviço entrou naquele
     estado, que é o que "concluído em" significa para o cliente. */
  const quandoPorEtapa: Partial<Record<EtapaId, string>> = {};
  for (const ev of [...(eventosServico ?? [])].reverse()) {
    const alvo = ev.to_status;
    if (alvo === "aceito" && !quandoPorEtapa.aceito) quandoPorEtapa.aceito = ev.created_at;
    if (alvo === "em_execucao" && !quandoPorEtapa.em_execucao) quandoPorEtapa.em_execucao = ev.created_at;
    if (alvo === "concluido" && !quandoPorEtapa.concluido) quandoPorEtapa.concluido = ev.created_at;
    if (alvo === "avaliado" && !quandoPorEtapa.avaliado) quandoPorEtapa.avaliado = ev.created_at;
  }
  if (agendamento?.status === "confirmed") quandoPorEtapa.agendado = agendamento.starts_at;
  const execucaoHabilitada = isPro && (podeIniciarExecucao || Boolean(execucao));

  /* Entrega do equipamento (dropship). Vem da view `entregas_cliente`. Um job
     pode ter mais de uma — uma por distribuidora envolvida (aparelhos de
     fabricantes diferentes) —, por isso é lista, nunca `.maybeSingle()`. O
     detalhe completo (itens, linha do tempo) mora em `/servico/[id]/aparelho`;
     aqui só o resumo compacto. */
  const { data: entregasData } = await supabase
    .from("entregas_cliente")
    .select("status")
    .eq("job_id", job.id);
  const entregas = entregasData ?? [];
  /* O status exibido é o MENOS avançado entre as entregas: se uma
     distribuidora já entregou e outra não, o pedido como um todo não está
     entregue. */
  const statusEntregaResumo: string | null = entregas.length
    ? entregas.reduce((pior, e) => {
        const status = e.status ?? "a_repassar";
        return (ORDEM_ENTREGA[status] ?? 0) < (ORDEM_ENTREGA[pior] ?? 0) ? status : pior;
      }, entregas[0].status ?? "a_repassar")
    : null;

  /* Reputação do cliente: a RLS de `client_reviews` só entrega para profissional
     e admin, então esta consulta volta vazia para o próprio cliente. */
  const { data: repCliente } = isPro
    ? await supabase.from("client_reviews").select("rating, tags, job_id").eq("cliente_id", job.cliente_id)
    : { data: null };
  const avaliacoesCliente = (repCliente ?? []) as { rating: number; tags: string[]; job_id: string }[];
  const jaAvaliouCliente = avaliacoesCliente.some((a) => a.job_id === job.id);
  const notaCliente = avaliacoesCliente.length
    ? avaliacoesCliente.reduce((s2, a) => s2 + a.rating, 0) / avaliacoesCliente.length
    : null;
  const tagsCliente = [...new Set(avaliacoesCliente.flatMap((a) => a.tags ?? []))].slice(0, 6);
  const podeAvaliarCliente = isPro && ["concluido", "avaliado"].includes(job.status) && !jaAvaliouCliente;
  const review = one(job.review) as { rating: number; comment: string | null } | null;
  const st = STATUS[job.status] ?? STATUS.aberto;

  /* Disputa (contestação pós-conclusão ou cancelamento de job pago em
     execução) — só o cliente que abriu vê (RLS de job_disputes), então só
     buscamos quando é o cliente olhando. O profissional não enxerga esse
     bloco por ora. */
  const { data: disputa } = isCliente
    ? await supabase
        .from("job_disputes")
        .select("id, tipo, status, situacao_repasse, valor_referencia, valor_reembolso, created_at")
        .eq("job_id", job.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };
  const disputaEmAndamento = disputa ? ["aberta", "processando_reembolso"].includes(disputa.status) : false;
  const temPagamentoRecebido = orders.some((o) => o.payment_status === "pago" || o.payment_status === "reembolsado");
  const podeCancelarPago = isCliente
    && ["aceito", "em_execucao", "aguardando_orcamento_final"].includes(job.status)
    && temPagamentoRecebido
    && !disputa;

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Painel</Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, margin: "20px 0 6px" }}>
        <h1 style={{ fontSize: "1.7rem", fontWeight: 800 }}>{rotuloJob(job.job_type)}</h1>
        <span style={{ fontSize: 13, fontFamily: mono, padding: "6px 12px", borderRadius: 100, background: st.bg, color: st.cor, whiteSpace: "nowrap" }}>{st.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
        <p style={{ color: "var(--ink-faint)", fontSize: 14, margin: 0 }}>
          {isAdmin ? `${cliNome} · ${proNome}` : isPro ? `Cliente: ${cliNome}` : `Profissional: ${proNome}`}
        </p>
        {/* Falar com a outra parte é a ação mais frequente nesta tela — antes não
            existia caminho nenhum, nem telefone nem chat. Admin fica de fora: ele
            já acompanha toda conversa em modo leitura por /painel/mensagens, e
            abrir por aqui criaria uma thread nova com ELE como participante. */}
        {job.profissional_id && !isAdmin && (
          <AbrirChat
            professionalId={job.profissional_id}
            jobId={job.id}
            rotulo={isPro ? `Conversar com ${cliNome.split(" ")[0]}` : `Conversar com ${proNome.split(" ")[0]}`}
          />
        )}
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {/* detalhes */}
        <div className="card" style={{ padding: 22 }}>
          <SecTitle>Detalhes</SecTitle>
          {itens.length > 1 ? (
            <Linha
              k={`Ambientes (${itens.length})`}
              v={
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {itens.map((item) => (
                    <span key={item.id}>
                      <strong>{item.ambiente}</strong>
                      {item.quantidade > 1 ? ` · ${item.quantidade} aparelhos` : ""}
                      {item.area_m2 ? ` · ${item.area_m2} m²` : ""}
                      {item.btu_recomendado ? ` · ${formatarBtu(item.btu_recomendado)}` : ""}
                      {item.produto ? ` · ${item.produto.marca} ${item.produto.modelo}` : ""}
                    </span>
                  ))}
                </span>
              }
            />
          ) : (
            <>
              {job.ambiente && <Linha k="Ambiente" v={job.ambiente} />}
              {job.area_m2 && <Linha k="Área" v={`${job.area_m2} m²`} />}
              {job.btu_recomendado ? <Linha k="Capacidade" v={formatarBtu(job.btu_recomendado)} /> : null}
              {produto && <Linha k="Aparelho" v={`${produto.marca} — ${produto.modelo}`} />}
            </>
          )}
          <Linha k="Endereço" v={`${job.endereco ?? "-"} · ${job.cep}`} />
          {job.descricao && <Linha k="Descrição" v={job.descricao} />}
        </div>

        {/* valores — até duas orders: a do aceite (produto/mão de obra/visita) e a
            do orçamento final pós-visita, quando aprovado. */}
        {orders.map((o) => (
          <div key={o.id} className="card" style={{ padding: 22 }}>
            <SecTitle>{isPro ? "Seu recebimento" : "Valores"} — {rotuloOrigemOrder(o.origem, isVisitaTecnica)}</SecTitle>
            {isPro ? (
              <>
                <Linha k={rotuloServicoOrder(o.origem, isVisitaTecnica)} v={formatarBRL(o.preco_servico)} />
                <Linha k={`Taxa FrioHub (${Math.round(TAXA_COMISSAO * 100)}%)`} v={`- ${formatarBRL(o.comissao_servico ?? 0)}`} />
                <Linha k={<strong>Você recebe</strong>} v={<strong>{formatarBRL(o.preco_servico - (o.comissao_servico ?? 0))}</strong>} />
              </>
            ) : (
              <>
                <Linha k={rotuloServicoOrder(o.origem, isVisitaTecnica)} v={formatarBRL(o.preco_servico)} />
                <Linha k={<strong>Total do serviço</strong>} v={<strong>{formatarBRL(o.preco_servico)}</strong>} />
                {o.preco_produto > 0 && (
                  <Linha
                    k="Aparelho"
                    v={<Link href={`/servico/${job.id}/aparelho`} style={{ color: "var(--cool)" }}>{formatarBRL(o.preco_produto)} — ver entrega</Link>}
                  />
                )}
                <Linha k="Pagamento" v={PAGAMENTO_LABEL[o.payment_status] ?? o.payment_status} />
              </>
            )}
          </div>
        ))}

        {/* orçamento final pós-visita: profissional lança o valor, cliente aprova
            ou recusa. Só aparece para propostas do tipo visita_tecnica. */}
        {isVisitaTecnica && isPro && podeEnviarOrcamentoFinal && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Orçamento do serviço</SecTitle>
            <OrcamentoFinal
              jobId={job.id}
              isPro
              valorVisita={ordemAceite?.preco_servico ?? 0}
              pendente={null}
              ultimoRecusado={jfqUltimoRecusado ? { valor_servico: jfqUltimoRecusado.valor_servico, motivo_recusa: jfqUltimoRecusado.motivo_recusa } : null}
              podeEnviar={podeEnviarOrcamentoFinal}
            />
          </div>
        )}
        {isVisitaTecnica && isCliente && jfqPendente && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Orçamento do serviço</SecTitle>
            <OrcamentoFinal
              jobId={job.id}
              isPro={false}
              valorVisita={ordemAceite?.preco_servico ?? 0}
              pendente={{ id: jfqPendente.id, valor_servico: jfqPendente.valor_servico, observacoes: jfqPendente.observacoes }}
              ultimoRecusado={null}
              podeEnviar={false}
            />
          </div>
        )}

        {/* Pagamento fica em bloco próprio, e não dentro de "Valores": um é o
            que foi combinado, o outro é o que aconteceu com o dinheiro.

            Quando a order tem aparelho junto (aceite_quote com produto), a
            cobrança de hoje é uma só — não dá pra pagar visita e aparelho
            separado sem redesenhar o pagamento. Por isso o valor total soma
            os dois, mas a tela detalha as duas linhas antes do total, pra não
            deixar a impressão de que a visita/serviço sozinha custou tudo
            aquilo.

            Fica fora do admin: `Pagamento` lê `payment_status_cliente`, view
            recortada por `customer_id = auth.uid()` — para o admin ela sempre
            volta vazia, o que mostraria "cobrança não gerada" mesmo quando
            existe, e ofereceria um botão de nova tentativa de cobrança que não
            é dele acionar. */}
        {!isPro && !isAdmin && orders.map((o) => (
          <div key={`pag-${o.id}`} className="card" style={{ padding: 22 }}>
            <SecTitle>{rotuloPagamentoOrder(o, isVisitaTecnica)}</SecTitle>
            {o.preco_produto > 0 && (
              <div style={{ display: "grid", gap: 8, marginBottom: 16, paddingBottom: 16, borderBottom: "1px solid var(--line-soft)" }}>
                <Linha k={rotuloServicoOrder(o.origem, isVisitaTecnica)} v={formatarBRL(o.preco_servico)} />
                <Linha
                  k="Aparelho"
                  v={<Link href={`/servico/${job.id}/aparelho`} style={{ color: "var(--cool)" }}>{formatarBRL(o.preco_produto)} — ver entrega</Link>}
                />
              </div>
            )}
            <Pagamento orderId={o.id} total={o.total} jobId={job.id} />
          </div>
        ))}

        {/* Disputa: contestação pós-conclusão, cancelamento de job pago em
            execução, ou o status de uma disputa já aberta — as três coisas
            são mutuamente exclusivas por causa do status do job, então cabem
            num bloco só, uma vez por serviço (não por order). */}
        {isCliente && disputa && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Cancelamento / contestação</SecTitle>
            {disputaEmAndamento ? (
              <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: 0 }}>
                Sua solicitação está em análise pela nossa equipe.
              </p>
            ) : disputa.status === "rejeitada" ? (
              <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: 0 }}>
                Sua solicitação foi analisada e não foi aprovada. Fale com a gente pelo chat se quiser entender melhor.
              </p>
            ) : (
              <p style={{ fontSize: 13.5, color: "var(--good)", fontWeight: 600, margin: 0 }}>
                Reembolso aprovado{disputa.valor_reembolso ? `: ${formatarBRL(disputa.valor_reembolso)}` : ""}.
              </p>
            )}
          </div>
        )}
        {isCliente && !disputa && job.status === "concluido" && <ContestarExecucao jobId={job.id} />}
        {podeCancelarPago && <CancelarJobPago jobId={job.id} />}

        {/* entrega do equipamento — resumo compacto; detalhe completo (itens de
            cada distribuidora, linha do tempo) mora em tela própria, porque o
            aparelho é uma relação comercial diferente da contratação do
            profissional. */}
        {statusEntregaResumo && (
          <Link
            href={`/servico/${job.id}/aparelho`}
            className="card"
            style={{ padding: 22, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, color: "inherit" }}
          >
            <div>
              <SecTitle>Aparelho</SecTitle>
              <span style={{ fontSize: 14.5 }}>
                {(STATUS_ENTREGA[statusEntregaResumo] ?? STATUS_ENTREGA.a_repassar).label}
                {entregas.length > 1 ? ` · ${entregas.length} entregas` : ""}
              </span>
            </div>
            <span style={{ fontSize: 13, color: "var(--cool)", whiteSpace: "nowrap" }}>Ver detalhes →</span>
          </Link>
        )}

        {/* Propor/confirmar/cancelar horário — nunca pro admin: o formulário
            manda `user.id` como se fosse participante, e as RPCs por trás
            (`propor_agendamento` etc.) até recusam quem não é cliente/profissional
            do job, mas a tela não deveria nem oferecer o botão pra começar. */}
        {(isCliente || isPro) && ["aguardando_profissional", "aceito"].includes(job.status) && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Agendamento</SecTitle>
            <Agendamento jobId={job.id} userId={user.id} atual={agendamento as AgendamentoView | null} />
          </div>
        )}

        {/* O rastreio vem ANTES do histórico: responde "onde estou e o que
            falta", que é a pergunta que o cliente faz primeiro. O histórico
            continua logo abaixo, para quem quiser o detalhe cronológico. */}
        {job.status !== "aberto" && job.status !== "aguardando_profissional" && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Acompanhamento</SecTitle>
            <Rastreio
              status={job.status}
              temAgendamento={Boolean(agendamento)}
              agendamentoConfirmado={agendamento?.status === "confirmed"}
              quandoPorEtapa={quandoPorEtapa}
            />
          </div>
        )}

        {eventosServico && eventosServico.length > 0 && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Histórico do serviço</SecTitle>
            <div style={{ display: "grid", gap: 10 }}>
              {eventosServico.map((evento) => (
                <div key={evento.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13.5 }}>
                  <span>
                    <strong>{rotuloEventoServico(evento.event_type, evento.to_status)}</strong>
                    {evento.reason && <span style={{ display: "block", color: "var(--ink-soft)", marginTop: 2 }}>{evento.reason}</span>}
                  </span>
                  <time style={{ color: "var(--ink-faint)", whiteSpace: "nowrap" }}>
                    {new Date(evento.created_at).toLocaleString("pt-BR")}
                  </time>
                </div>
              ))}
            </div>
          </div>
        )}

        {execucao?.status === "finalized" && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Relatório técnico</SecTitle>
            <Linha k="Finalizado em" v={execucao.finalized_at ? new Date(execucao.finalized_at).toLocaleString("pt-BR") : "Finalizado"} />
            {execucao.notes && <Linha k="Observações" v={execucao.notes} />}
            {Array.isArray(execucao.materials) && <Linha k="Materiais registrados" v={execucao.materials.length} />}
            {execucao.warranty_until && <Linha k="Garantia até" v={new Date(`${execucao.warranty_until}T12:00:00`).toLocaleDateString("pt-BR")} />}
            {execucao.maintenance_due && <Linha k="Manutenção recomendada" v={new Date(`${execucao.maintenance_due}T12:00:00`).toLocaleDateString("pt-BR")} />}
            <Evidencias caminhos={execucao.evidence_paths ?? []} />
          </div>
        )}

        {isPro && ["aguardando_profissional", "aceito", "em_execucao"].includes(job.status) && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Ação</SecTitle>
            {execucaoHabilitada && <Link href={`/servico/${job.id}/executar`} className="btn btn-primary" style={{ display: "inline-flex", marginBottom: 14 }}>
              {execucao ? "Continuar execução" : "Abrir modo execução"}
            </Link>}
            <JobActions jobId={job.id} status={job.status} />
          </div>
        )}

        {/* avaliação do cliente */}
        {isCliente && job.status === "concluido" && !review && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Avalie o serviço</SecTitle>
            <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 16 }}>Sua nota ajuda outros clientes e valoriza os bons profissionais.</p>
            <ReviewForm jobId={job.id} />
          </div>
        )}

        {/* avaliação já feita */}
        {review && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Avaliação</SecTitle>
            <div style={{ display: "flex", gap: 4, marginBottom: review.comment ? 10 : 0 }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <span key={n} style={{ color: review.rating >= n ? "var(--warm)" : "var(--ink-faint)", display: "flex" }}>
                  <Star size={20} filled={review.rating >= n} />
                </span>
              ))}
            </div>
            {review.comment && <p style={{ color: "var(--ink-soft)", fontSize: 15 }}>{review.comment}</p>}
          </div>
        )}

        {/* reputação do cliente — só o profissional enxerga este bloco */}
        {isPro && (notaCliente !== null || podeAvaliarCliente) && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Sobre este cliente</SecTitle>
            {notaCliente !== null && (
              <div style={{ marginBottom: podeAvaliarCliente ? 18 : 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ color: "var(--warm)", display: "flex" }}><Star size={16} filled /></span>
                  <strong>{notaCliente.toFixed(1)}</strong>
                  <span style={{ color: "var(--ink-faint)" }}>
                    de {avaliacoesCliente.length} atendimento{avaliacoesCliente.length > 1 ? "s" : ""}
                  </span>
                </div>
                {tagsCliente.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                    {tagsCliente.map((t) => (
                      <span key={t} style={{ fontSize: 12.5, padding: "4px 11px", borderRadius: 100, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
                        {TAG_LABEL[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 12, color: "var(--ink-faint)", margin: "10px 0 0" }}>
                  Visível apenas para profissionais. O cliente não vê esta avaliação.
                </p>
              </div>
            )}
            {podeAvaliarCliente && <AvaliarCliente jobId={job.id} clienteNome={cliNome} />}
          </div>
        )}
      </div>
    </main>
  );
}

function SecTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 14 }}>{children}</div>;
}
function Linha({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", fontSize: 14.5, borderBottom: "1px solid var(--line-soft)" }}>
      <span style={{ color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

function rotuloOrigemOrder(origem: "aceite_quote" | "orcamento_final", isVisitaTecnica: boolean): string {
  if (origem === "orcamento_final") return "Serviço (pós-visita)";
  return isVisitaTecnica ? "Visita técnica" : "Instalação";
}

function rotuloServicoOrder(origem: "aceite_quote" | "orcamento_final", isVisitaTecnica: boolean): string {
  if (origem === "orcamento_final") return "Serviço (pós-visita)";
  return isVisitaTecnica ? "Visita técnica" : "Mão de obra (instalação)";
}

function rotuloPagamentoOrder(o: OrderView, isVisitaTecnica: boolean): string {
  const base = rotuloOrigemOrder(o.origem, isVisitaTecnica);
  return o.preco_produto > 0 ? `Pagamento — ${base} + aparelho` : `Pagamento — ${base}`;
}

function rotuloEventoServico(evento: string, status: string | null) {
  if (evento === "created_from_quote") return "Serviço criado a partir da proposta";
  if (evento === "status_changed") return status ? `Status alterado para ${STATUS[status]?.label ?? status}` : "Status alterado";
  if (evento === "appointment_proposed") return "Novo horário proposto";
  if (evento === "appointment_confirmed") return "Horário confirmado";
  if (evento === "appointment_declined") return "Horário recusado";
  if (evento === "appointment_cancelled") return "Horário cancelado";
  return evento;
}

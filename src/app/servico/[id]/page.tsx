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
import { STATUS_JOB, resolverMapa } from "@/lib/status";
import { one } from "@/lib/relacional";
import { Rastreio, type EtapaId } from "./Rastreio";
import { Evidencias } from "./Evidencias";
import { Pagamento } from "./Pagamento";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const STATUS = resolverMapa(STATUS_JOB);

// Estados do repasse traduzidos para quem comprou — "faturado" e "a_repassar"
// são vocabulário da distribuidora, não do cliente.
const ENTREGA_LABEL: Record<string, string> = {
  a_repassar: "Pedido enviado à distribuidora",
  confirmado: "Confirmado pela distribuidora",
  faturado: "Nota fiscal emitida",
  enviado: "A caminho",
  entregue: "Entregue",
  cancelado: "Cancelado",
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
  comissao_servico?: number; // só existe para o profissional
};

/* Profissional lê `orders` direto; cliente lê a view `orders_cliente`, que não
   expõe margem nem comissão da plataforma. As duas fontes são protegidas no
   banco — se o papel não bater, o retorno é vazio, não um erro. */
async function carregarOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  isPro: boolean,
): Promise<OrderView | null> {
  if (isPro) {
    const { data } = await supabase
      .from("orders")
      .select("id, preco_produto, preco_servico, comissao_servico, total, payment_status")
      .eq("job_id", jobId)
      .maybeSingle();
    return data as OrderView | null;
  }
  const { data } = await supabase
    .from("orders_cliente")
    .select("id, preco_produto, preco_servico, total, payment_status")
    .eq("job_id", jobId)
    .maybeSingle();
  return data as OrderView | null;
}

export default async function ServicoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: job } = await supabase
    .from("jobs")
    .select(`id, job_type, status, created_at, ambiente, area_m2, btu_recomendado, cep, endereco, descricao, cliente_id, profissional_id,
             produto:products ( marca, modelo, btu, preco_venda ),
             itens:job_itens ( id, ordem, ambiente, area_m2, btu_recomendado, quantidade,
                               produto:products ( marca, modelo ) ),
             profissional:professionals ( id, tipo, profiles ( nome ) ),
             cliente:profiles!jobs_cliente_id_fkey ( nome ),
             review:reviews ( rating, comment )`)
    .eq("id", id)
    .single();

  if (!job) redirect("/painel");

  const isCliente = job.cliente_id === user.id;
  const isPro = job.profissional_id === user.id;
  if (!isCliente && !isPro) redirect("/painel");
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
  /* A order vem de fonte diferente conforme quem olha: o profissional lê a
     tabela (enxerga a comissão descontada dele), o cliente lê a view sem margem
     nem comissão. Ver migration 20260812130000_orders_cliente_view. */
  const order = await carregarOrder(supabase, job.id, isPro);

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

  /* Entrega do equipamento (dropship). Vem da view `entregas_cliente`, que não
     expõe o custo da distribuidora — mesma razão de `orders_cliente`.
     Ver 20260812260000_distribuidoras.sql. */
  const { data: entrega } = await supabase
    .from("entregas_cliente")
    .select("status, codigo_rastreio, prazo_previsto, distribuidora")
    .eq("job_id", job.id)
    .maybeSingle();

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

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Painel</Link>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, margin: "20px 0 6px" }}>
        <h1 style={{ fontSize: "1.7rem", fontWeight: 800 }}>{rotuloJob(job.job_type)}</h1>
        <span style={{ fontSize: 13, fontFamily: mono, padding: "6px 12px", borderRadius: 100, background: st.bg, color: st.cor, whiteSpace: "nowrap" }}>{st.label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 28 }}>
        <p style={{ color: "var(--ink-faint)", fontSize: 14, margin: 0 }}>
          {isPro ? `Cliente: ${cliNome}` : `Profissional: ${proNome}`}
        </p>
        {/* Falar com a outra parte é a ação mais frequente nesta tela — antes não
            existia caminho nenhum, nem telefone nem chat. */}
        {job.profissional_id && (
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

        {/* valores */}
        {order && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>{isPro ? "Seu recebimento" : "Valores"}</SecTitle>
            {isPro ? (
              <>
                <Linha k="Mão de obra (instalação)" v={formatarBRL(order.preco_servico)} />
                <Linha k={`Taxa FrioHub (${Math.round(TAXA_COMISSAO * 100)}%)`} v={`- ${formatarBRL(order.comissao_servico ?? 0)}`} />
                <Linha k={<strong>Você recebe</strong>} v={<strong>{formatarBRL(order.preco_servico - (order.comissao_servico ?? 0))}</strong>} />
              </>
            ) : (
              <>
                {order.preco_produto > 0 && <Linha k="Aparelho" v={formatarBRL(order.preco_produto)} />}
                <Linha k="Instalação" v={formatarBRL(order.preco_servico)} />
                <Linha k={<strong>Total</strong>} v={<strong>{formatarBRL(order.total)}</strong>} />
                <Linha k="Pagamento" v={PAGAMENTO_LABEL[order.payment_status] ?? order.payment_status} />
              </>
            )}
          </div>
        )}

        {/* Pagamento fica em bloco próprio, e não dentro de "Valores": um é o
            que foi combinado, o outro é o que aconteceu com o dinheiro. */}
        {order && !isPro && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Pagamento</SecTitle>
            <Pagamento orderId={order.id} total={order.total} />
          </div>
        )}

        {/* entrega do equipamento */}
        {entrega && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Entrega do aparelho</SecTitle>
            <Linha k="Status" v={ENTREGA_LABEL[entrega.status as string] ?? (entrega.status as string)} />
            <Linha k="Distribuidora" v={entrega.distribuidora as string} />
            {entrega.prazo_previsto && (
              <Linha k="Previsão" v={new Date(`${entrega.prazo_previsto}T12:00:00`).toLocaleDateString("pt-BR")} />
            )}
            {entrega.codigo_rastreio && <Linha k="Rastreio" v={entrega.codigo_rastreio as string} />}
          </div>
        )}

        {/* ações do profissional */}
        {["aguardando_profissional", "aceito"].includes(job.status) && (
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

function rotuloEventoServico(evento: string, status: string | null) {
  if (evento === "created_from_quote") return "Serviço criado a partir da proposta";
  if (evento === "status_changed") return status ? `Status alterado para ${STATUS[status]?.label ?? status}` : "Status alterado";
  if (evento === "appointment_proposed") return "Novo horário proposto";
  if (evento === "appointment_confirmed") return "Horário confirmado";
  if (evento === "appointment_declined") return "Horário recusado";
  if (evento === "appointment_cancelled") return "Horário cancelado";
  return evento;
}

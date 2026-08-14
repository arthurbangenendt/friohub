import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { rotuloJob, type JobType } from "@/app/solicitar/tipos";
import { rotuloPergunta } from "@/app/solicitar/perguntas-orcamento";
import { dataCurta, mono, one, wrap } from "../../shared";
import { PropostaForm } from "./PropostaForm";
import { Propostas, type PropostaView } from "./Propostas";
import { CancelarPedido } from "./CancelarPedido";
import { AbrirChatPedido } from "./AbrirChatPedido";
import { ComparisonLink } from "./ComparisonLink";
import { featureHabilitada } from "@/lib/feature-flags";

const URGENCIA: Record<string, string> = {
  sem_pressa: "Sem pressa",
  proximos_dias: "Nos próximos dias",
  urgente: "Urgente",
};

export default async function PedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const pipelineHabilitado = await featureHabilitada(supabase, "ux_pipeline", user.id);

  const { data: pedido } = await supabase
    .from("quote_requests")
    .select(`id, cliente_id, job_type, status, created_at, cep, bairro, cidade, quantidade,
             urgencia, descricao, detalhes, btu_recomendado, expira_em,
             produto:products ( marca, modelo, btu, preco_venda ),
             fotos:quote_request_photos ( id, storage_path )`)
    .eq("id", id)
    .maybeSingle();

  if (!pedido) redirect("/painel/orcamentos");

  const { data: eventosPedido } = await supabase
    .from("quote_request_events")
    .select("id, event_type, reason, created_at")
    .eq("quote_request_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  const souCliente = pedido.cliente_id === user.id;

  // A RLS já garante que só cliente, destinatário ou admin chegam aqui; isto é
  // apenas para saber QUAL tela renderizar.
  const { data: alvo } = await supabase
    .from("quote_request_targets")
    .select("professional_id, recusado_em")
    .eq("quote_request_id", id)
    .eq("professional_id", user.id)
    .maybeSingle();

  const souDestinatario = !!alvo;
  if (!souCliente && !souDestinatario) redirect("/painel/orcamentos");

  const produto = one(pedido.produto) as { marca: string; modelo: string; btu: number; preco_venda: number } | null;
  const detalhes = (pedido.detalhes ?? {}) as Record<string, unknown>;
  const fotosPrivadas = (pedido.fotos ?? []) as { id: string; storage_path: string }[];
  const fotos = (await Promise.all(
    fotosPrivadas.map(async (foto) => {
      const { data } = await supabase.storage
        .from("orcamentos")
        .createSignedUrl(foto.storage_path, 10 * 60);
      return data?.signedUrl ? { id: foto.id, signedUrl: data.signedUrl } : null;
    }),
  )).filter((foto): foto is { id: string; signedUrl: string } => foto !== null);
  const jobType = pedido.job_type as JobType;

  /* O profissional só enxerga a PRÓPRIA proposta (RLS de `quotes`) — de
     propósito: ver a do concorrente vira leilão de centavos e derruba a
     qualidade da rede. O cliente vê todas. */
  const { data: quotesData } = await supabase
    .from("quotes")
    .select(`id, professional_id, tipo, valor_mao_obra, valor_materiais, valor_visita, visita_abatida,
             inclui, nao_inclui, prazo_execucao, garantia_dias, validade_ate, observacoes, status,
             profissional:professionals ( profiles ( nome, avatar_url ),
                                          professional_skills ( rating_avg, rating_count, jobs_completed ) )`)
    .eq("quote_request_id", id);

  type QuoteRow = Omit<PropostaView, "nome" | "avatarUrl" | "nota" | "servicos"> & { profissional: unknown };

  const propostas: PropostaView[] = ((quotesData ?? []) as QuoteRow[]).map((q) => {
    const pro = one(q.profissional as { profiles: unknown; professional_skills: unknown } | null);
    const perfil = one(pro?.profiles) as { nome: string; avatar_url: string | null } | null;
    const skills = (pro?.professional_skills ?? []) as { rating_avg: number; rating_count: number; jobs_completed: number }[];
    const totalAval = skills.reduce((s, k) => s + (k.rating_count ?? 0), 0);
    return {
      ...q,
      valor_mao_obra: Number(q.valor_mao_obra),
      valor_materiais: Number(q.valor_materiais),
      valor_visita: Number(q.valor_visita),
      nome: perfil?.nome ?? "Profissional",
      avatarUrl: perfil?.avatar_url ?? null,
      nota: totalAval > 0
        ? skills.reduce((s, k) => s + Number(k.rating_avg ?? 0) * (k.rating_count ?? 0), 0) / totalAval
        : null,
      servicos: skills.reduce((s, k) => s + (k.jobs_completed ?? 0), 0),
    };
  });

  const minhaProposta = propostas.find((p) => p.professional_id === user.id);
  const aberto = pedido.status === "aberto" && new Date(pedido.expira_em) > new Date();

  return (
    <div style={wrap}>
      <Link href="/painel/orcamentos" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>
        ← Orçamentos
      </Link>

      <h1 style={{ fontSize: "1.7rem", fontWeight: 800, margin: "18px 0 4px" }}>{rotuloJob(pedido.job_type)}</h1>
      <p style={{ color: "var(--ink-faint)", fontSize: 14, marginBottom: 26 }}>
        {pedido.bairro ? `${pedido.bairro} · ` : ""}{pedido.cep} · pedido em {dataCurta(pedido.created_at)}
      </p>

      <div style={{ display: "grid", gap: 16 }}>
        {/* O que o cliente pediu */}
        <div className="card" style={{ padding: 22 }}>
          <SecTitle>O pedido</SecTitle>
          <div style={{ display: "grid", gap: 8, fontSize: 14.5 }}>
            {pedido.quantidade > 1 && <Linha k="Quantidade" v={`${pedido.quantidade} aparelhos`} />}
            {pedido.urgencia && <Linha k="Urgência" v={URGENCIA[pedido.urgencia] ?? pedido.urgencia} />}
            {pedido.btu_recomendado ? <Linha k="Capacidade calculada" v={formatarBtu(pedido.btu_recomendado)} /> : null}
            {produto && (
              <Linha
                k="Aparelho escolhido"
                v={`${produto.marca} — ${produto.modelo} · ${formatarBRL(Number(produto.preco_venda))}`}
              />
            )}
            {/* Respostas do questionário técnico: é o que permite orçar sem visita. */}
            {Object.entries(detalhes).map(([k, v]) =>
              v === null || v === "" ? null : (
                <Linha key={k} k={rotuloPergunta(jobType, k)} v={String(v)} />
              ),
            )}
            {pedido.descricao && <Linha k="Descrição" v={pedido.descricao} />}
          </div>

          {produto && (
            <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: "14px 0 0" }}>
              O aparelho tem preço de catálogo. A proposta cobre apenas a mão de obra da instalação.
            </p>
          )}
        </div>

        {fotos.length > 0 && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Fotos do local</SecTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
              {fotos.map((f) => (
                <a key={f.id} href={f.signedUrl} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.signedUrl} alt="Foto enviada pelo cliente"
                    style={{ width: "100%", height: 110, objectFit: "cover", borderRadius: 10, display: "block" }} />
                </a>
              ))}
            </div>
          </div>
        )}

        {eventosPedido && eventosPedido.length > 0 && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Histórico do pedido</SecTitle>
            <div style={{ display: "grid", gap: 10 }}>
              {eventosPedido.map((evento) => (
                <div key={evento.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13.5 }}>
                  <span>
                    <strong>{ROTULO_EVENTO[evento.event_type] ?? evento.event_type}</strong>
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

        {/* Lado do profissional */}
        {souDestinatario && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>{minhaProposta ? "Sua proposta" : "Responder com uma proposta"}</SecTitle>
            <div style={{ marginBottom: 16 }}>
              <AbrirChatPedido pedidoId={pedido.id} professionalId={user.id} />
            </div>
            {alvo?.recusado_em ? (
              <p style={{ color: "var(--ink-faint)", fontSize: 14.5, margin: 0 }}>
                Você recusou este pedido.
              </p>
            ) : minhaProposta ? (
              <Propostas
                propostas={[minhaProposta]} podeAceitar={false} enderecoSugerido=""
                produtoPreco={Number(produto?.preco_venda ?? 0)}
                jobType={jobType} detalhesAtuais={{}}
              />
            ) : aberto ? (
              <PropostaForm pedidoId={pedido.id} taxaComissao={TAXA_COMISSAO} />
            ) : (
              <p style={{ color: "var(--ink-faint)", fontSize: 14.5, margin: 0 }}>
                Este pedido não está mais aberto para propostas.
              </p>
            )}
          </div>
        )}

        {/* Lado do cliente */}
        {souCliente && (
          <div>
            <div id="propostas" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", margin: "8px 0 14px" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 700, margin: 0 }}>Propostas recebidas ({propostas.filter((p) => p.status !== "retirada").length})</h2>
              {pipelineHabilitado && propostas.filter((p) => p.status !== "retirada").length >= 2 && <ComparisonLink href={`/painel/orcamentos/${pedido.id}/comparar`} count={propostas.filter((p) => p.status !== "retirada").length} />}
            </div>
            <Propostas
              propostas={propostas.filter((p) => p.status !== "retirada")}
              podeAceitar={aberto}
              enderecoSugerido=""
              produtoPreco={Number(produto?.preco_venda ?? 0)}
              jobType={jobType}
              detalhesAtuais={Object.fromEntries(
                Object.entries(detalhes).map(([k, v]) => [k, v == null ? "" : String(v)]),
              )}
            />
            {propostas.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 16 }}>
                {propostas.map((proposta) => (
                  <AbrirChatPedido
                    key={proposta.professional_id}
                    pedidoId={pedido.id}
                    professionalId={proposta.professional_id}
                  />
                ))}
              </div>
            )}
            {aberto && (
              <div style={{ marginTop: 16 }}>
                <CancelarPedido pedidoId={pedido.id} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const ROTULO_EVENTO: Record<string, string> = {
  cancelled: "Pedido cancelado",
  declined: "Profissional recusou",
  expired: "Pedido expirado",
};

function SecTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Linha({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, paddingBottom: 8, borderBottom: "1px solid var(--line-soft)" }}>
      <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { rotuloJob, CATEGORIA_LABEL, type JobType } from "@/app/solicitar/tipos";
import { rotuloPergunta } from "@/app/solicitar/perguntas-orcamento";
import { dataCurta, mono, one, wrap } from "../../shared";
import { PropostaForm } from "./PropostaForm";
import { Propostas, type PropostaView } from "./Propostas";
import { CancelarPedido } from "./CancelarPedido";
import { AbrirChatPedido } from "./AbrirChatPedido";
import { ComparisonLink } from "./ComparisonLink";
import { featureHabilitada } from "@/lib/feature-flags";
import { REGIAO_SLUG } from "@/lib/regiao";

/* Chaves que `detalhes` mantém espelhadas do primeiro ambiente por
   compatibilidade. Quem as exibe é a lista de ambientes — ver
   20260817120000_pedido_multi_ambiente.sql. */
const CHAVES_DO_AMBIENTE = new Set([
  "ambiente", "area_m2", "num_pessoas", "eletronicos", "insolacao_alta", "andar_ou_telhado",
]);

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
             urgencia, descricao, detalhes, btu_recomendado, expira_em, sabe_aparelho,
             produto:products ( marca, modelo, btu, preco_venda ),
             itens:quote_request_itens ( id, ordem, ambiente, area_m2, num_pessoas,
                                         insolacao_alta, andar_ou_telhado, btu_recomendado,
                                         quantidade, categoria_desejada,
                                         produto:products ( marca, modelo, btu, preco_venda ) ),
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
  // apenas para saber QUAL tela renderizar. O guard abaixo, por outro lado, é
  // aplicação — e até aqui não conhecia o papel admin, então o expulsava antes
  // de a RLS sequer entrar em jogo (achado ao ligar o painel de suporte).
  const [{ data: alvo }, { data: perfilLogado }] = await Promise.all([
    supabase
      .from("quote_request_targets")
      .select("professional_id, recusado_em")
      .eq("quote_request_id", id)
      .eq("professional_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user.id).single(),
  ]);

  const souDestinatario = !!alvo;
  const isAdmin = !souCliente && !souDestinatario && perfilLogado?.role === "admin";
  if (!souCliente && !souDestinatario && !isAdmin) redirect("/painel/orcamentos");

  /* CPF/CNPJ do cliente só é pedido quando a cobrança real está ligada pra
     essa região (asaas_payments) e ele ainda não tem documento salvo — coleta
     just-in-time, mesmo padrão já usado pro CPF/CNPJ do profissional na
     assinatura (20260818141000). Enquanto a flag estiver desligada em toda
     região, isto nunca aparece. */
  let precisaCpfCnpj = false;
  let enderecoSugerido = "";
  if (souCliente) {
    const [{ data: cobrancaHabilitada }, { data: privado }] = await Promise.all([
      supabase.rpc("feature_enabled", {
        p_flag_key: "asaas_payments",
        p_region_slug: REGIAO_SLUG,
        p_subject_id: user.id,
      }),
      supabase.from("profile_private").select("cpf_cnpj, endereco_completo").eq("id", user.id).maybeSingle(),
    ]);
    if (cobrancaHabilitada === true) precisaCpfCnpj = !privado?.cpf_cnpj;
    // Só uma sugestão — o campo em Propostas.tsx continua editável no aceite.
    enderecoSugerido = privado?.endereco_completo ?? "";
  }

  const produto = one(pedido.produto) as { marca: string; modelo: string; btu: number; preco_venda: number } | null;
  const detalhes = (pedido.detalhes ?? {}) as Record<string, unknown>;

  /* Os ambientes do pedido. É o escopo real que o profissional precisa
     precificar: mostrar só as colunas singulares faria ele orçar um cômodo de
     um pedido de três. Todo pedido tem ao menos um item — o backfill garantiu
     isso para os antigos. */
  type ItemPedido = {
    id: string; ordem: number; ambiente: string;
    area_m2: number | null; num_pessoas: number | null;
    insolacao_alta: boolean; andar_ou_telhado: boolean;
    btu_recomendado: number | null; quantidade: number;
    categoria_desejada: string | null;
    produto: { marca: string; modelo: string; btu: number; preco_venda: number } | null;
  };
  const itens = ((pedido.itens ?? []) as unknown as ItemPedido[])
    .map((item) => ({ ...item, produto: one(item.produto) }))
    .sort((a, b) => a.ordem - b.ordem);
  const multiAmbiente = itens.length > 1;
  const sabeAparelho = pedido.sabe_aparelho !== false;
  /* Categorias que faltam produto — é o que o profissional escolhe na
     proposta quando o cliente não sabia o aparelho exato. */
  const categoriasDesejadas = [...new Set(
    itens.map((item) => item.categoria_desejada).filter((c): c is string => Boolean(c)),
  )];
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
             valor_equipamento, produto_escolhido:products ( marca, modelo ),
             profissional:professionals ( profiles ( nome, avatar_url ),
                                          professional_skills ( rating_avg, rating_count, jobs_completed ) )`)
    .eq("quote_request_id", id);

  type QuoteRow = Omit<PropostaView, "nome" | "avatarUrl" | "nota" | "servicos" | "produtoEscolhido"> & {
    profissional: unknown;
    produto_escolhido: unknown;
  };

  const propostas: PropostaView[] = ((quotesData ?? []) as QuoteRow[]).map((q) => {
    const pro = one(q.profissional as { profiles: unknown; professional_skills: unknown } | null);
    const perfil = one(pro?.profiles) as { nome: string; avatar_url: string | null } | null;
    const skills = (pro?.professional_skills ?? []) as { rating_avg: number; rating_count: number; jobs_completed: number }[];
    const totalAval = skills.reduce((s, k) => s + (k.rating_count ?? 0), 0);
    const produtoEscolhido = one(q.produto_escolhido) as { marca: string; modelo: string } | null;
    return {
      ...q,
      valor_mao_obra: Number(q.valor_mao_obra),
      valor_materiais: Number(q.valor_materiais),
      valor_visita: Number(q.valor_visita),
      valor_equipamento: Number(q.valor_equipamento),
      produtoEscolhido,
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

            {/* Um bloco por ambiente. Com um só, mantém o formato de linha de
                antes; com vários, vira lista — é o escopo a precificar. */}
            {multiAmbiente ? (
              <div style={{ display: "grid", gap: 10, margin: "4px 0" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>
                  {itens.length} ambientes neste pedido
                </span>
                {itens.map((item, i) => (
                  <div key={item.id} style={{ padding: "10px 14px", borderRadius: 10, background: "var(--surface-2)" }}>
                    <div style={{ fontWeight: 600 }}>
                      {i + 1}. {item.ambiente}
                      {item.quantidade > 1 ? ` · ${item.quantidade} aparelhos` : ""}
                    </div>
                    <div style={{ fontSize: 13.5, color: "var(--ink-faint)", marginTop: 2 }}>
                      {[
                        item.area_m2 ? `${item.area_m2} m²` : null,
                        item.num_pessoas ? `${item.num_pessoas} pessoa(s)` : null,
                        item.btu_recomendado ? formatarBtu(item.btu_recomendado) : null,
                        item.insolacao_alta ? "muito sol" : null,
                        item.andar_ou_telhado ? "laje exposta" : null,
                      ].filter(Boolean).join(" · ") || "Sem detalhes técnicos"}
                    </div>
                    {item.produto ? (
                      <div style={{ fontSize: 13.5, marginTop: 4 }}>
                        {item.produto.marca} — {item.produto.modelo} · {formatarBRL(Number(item.produto.preco_venda))}
                      </div>
                    ) : item.categoria_desejada && (
                      <div style={{ fontSize: 13.5, marginTop: 4, color: "var(--ink-faint)" }}>
                        Categoria desejada: {CATEGORIA_LABEL[item.categoria_desejada] ?? item.categoria_desejada}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <>
                {itens[0]?.ambiente && <Linha k="Ambiente" v={itens[0].ambiente} />}
                {pedido.btu_recomendado ? <Linha k="Capacidade calculada" v={formatarBtu(pedido.btu_recomendado)} /> : null}
                {produto && (
                  <Linha
                    k="Aparelho escolhido"
                    v={`${produto.marca} — ${produto.modelo} · ${formatarBRL(Number(produto.preco_venda))}`}
                  />
                )}
                {!produto && itens[0]?.categoria_desejada && (
                  <Linha k="Categoria desejada" v={CATEGORIA_LABEL[itens[0].categoria_desejada] ?? itens[0].categoria_desejada} />
                )}
              </>
            )}
            {/* Respostas do questionário técnico: é o que permite orçar sem visita. */}
            {/* As chaves espelhadas do primeiro ambiente já foram exibidas na
                lista acima — repeti-las aqui mostraria a sala duas vezes e
                nenhum dos outros cômodos. */}
            {Object.entries(detalhes)
              .filter(([k]) => !CHAVES_DO_AMBIENTE.has(k))
              .map(([k, v]) =>
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
          {categoriasDesejadas.length > 0 && (
            <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: "14px 0 0" }}>
              O cliente ainda não escolheu o modelo exato — o profissional escolhe o aparelho da categoria pedida e define o preço na proposta.
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
              <PropostaForm
                pedidoId={pedido.id} taxaComissao={TAXA_COMISSAO}
                sabeAparelho={sabeAparelho} categoriasDesejadas={categoriasDesejadas}
              />
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
              enderecoSugerido={enderecoSugerido}
              produtoPreco={Number(produto?.preco_venda ?? 0)}
              jobType={jobType}
              precisaCpfCnpj={precisaCpfCnpj}
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

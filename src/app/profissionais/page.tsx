import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { Avatar } from "@/app/painel/Avatar";
import { Star, Shield, MapPin, Search } from "@/components/icons";
import { EmptyState } from "@/components/ui";
import { REGIAO_LABEL } from "@/lib/regiao";
import { EXIGIR_VERIFICACAO } from "@/lib/config";

export const metadata: Metadata = {
  title: `Profissionais de ar-condicionado em ${REGIAO_LABEL} — FrioHub`,
  description: `Veja os técnicos e empresas de climatização que atendem ${REGIAO_LABEL}, com avaliação separada por especialidade: instalação, manutenção, limpeza, remanejamento e conserto.`,
};

/* A vitrine é a mesma para todo mundo e muda pouco: revalidar de tempos em
   tempos evita reconsultar o banco a cada visita e a cada robô de busca. */
export const revalidate = 300;

const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento",
  limpeza: "Limpeza", conserto: "Conserto",
};

const ORDENS = {
  nota: { label: "Melhor avaliados", coluna: "nota" },
  servicos: { label: "Mais serviços feitos", coluna: "servicos" },
  novos: { label: "Entraram recentemente", coluna: "id" },
} as const;
type Ordem = keyof typeof ORDENS;

const POR_PAGINA = 12;

type LinhaDiretorio = {
  id: string; tipo: string; bio: string | null; cidade: string | null; estado: string | null;
  verification_status: string; anos_experiencia: number | null; nome: string;
  avatar_url: string | null; nota: number; avaliacoes: number; servicos: number;
  especialidades: string[];
};

export default async function DiretorioPage({ searchParams }: PageProps<"/profissionais">) {
  const sp = await searchParams;
  const especialidade = typeof sp.especialidade === "string" && SPEC_LABEL[sp.especialidade] ? sp.especialidade : null;
  const busca = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const ordem: Ordem = typeof sp.ordem === "string" && sp.ordem in ORDENS ? (sp.ordem as Ordem) : "nota";
  const pagina = Math.max(1, Number.parseInt(typeof sp.pagina === "string" ? sp.pagina : "1", 10) || 1);
  const inicio = (pagina - 1) * POR_PAGINA;

  const supabase = await createClient();

  let consulta = supabase
    .from("diretorio_profissionais")
    .select("id, tipo, bio, cidade, estado, verification_status, anos_experiencia, nome, avatar_url, nota, avaliacoes, servicos, especialidades", { count: "exact" });

  if (especialidade) consulta = consulta.contains("especialidades", [especialidade]);
  /* Busca por nome só. Procurar dentro da bio traria resultado que o visitante
     não consegue explicar ("por que este apareceu?"). */
  if (busca) consulta = consulta.ilike("nome", `%${busca}%`);
  /* Antes deste filtro, o diretório era o único lugar do site que mostrava
     profissional não verificado mesmo com EXIGIR_VERIFICACAO ligado — a home
     e a busca do marketplace já filtravam, este aqui não (achado ao ativar o
     gate, 20260824). */
  if (EXIGIR_VERIFICACAO) consulta = consulta.eq("verification_status", "verificado");

  const { data, count } = await consulta
    .order(ORDENS[ordem].coluna, { ascending: false })
    /* Desempate estável: sem ele, dois profissionais com a mesma nota podem
       trocar de lugar entre uma página e outra e um deles some da listagem. */
    .order("id", { ascending: true })
    .range(inicio, inicio + POR_PAGINA - 1);

  const lista = (data ?? []) as LinhaDiretorio[];
  const total = count ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  const comFiltros = (mudanca: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      especialidade, q: busca || null, ordem: ordem === "nota" ? null : ordem, ...mudanca,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/profissionais?${s}` : "/profissionais";
  };

  return (
    <>
      <SiteHeader />
      <main id="conteudo" style={{ flex: 1 }}>
        <section style={{ background: "var(--bg-subtle)", borderBottom: "1px solid var(--line)", padding: "56px 0 40px" }}>
          <div className="container">
            <p className="eyebrow">Quem atende {REGIAO_LABEL}</p>
            <h1 style={{ fontSize: "clamp(2rem, 4vw, 2.8rem)", fontWeight: 800, letterSpacing: "-0.03em", marginTop: 10 }}>
              Profissionais de climatização
            </h1>
            <p style={{ color: "var(--ink-soft)", fontSize: "1.05rem", maxWidth: 560, marginTop: 12, lineHeight: 1.6 }}>
              Cada profissional tem nota separada por especialidade — quem é bom em
              instalação aparece em instalação. Veja os perfis à vontade; para
              receber orçamentos, é só abrir um pedido.
            </p>

            {/* GET puro: os filtros viram URL, então a página é compartilhável,
                volta com o botão do navegador e é indexável. */}
            <form action="/profissionais" style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 26 }}>
              {especialidade && <input type="hidden" name="especialidade" value={especialidade} />}
              {ordem !== "nota" && <input type="hidden" name="ordem" value={ordem} />}
              <label style={{ position: "relative", flex: "1 1 260px", maxWidth: 380 }}>
                <span className="sr-only">Buscar profissional pelo nome</span>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}>
                  <Search size={17} />
                </span>
                <input
                  name="q"
                  defaultValue={busca}
                  placeholder="Buscar pelo nome"
                  style={{ width: "100%", height: 46, padding: "0 14px 0 42px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 15 }}
                />
              </label>
              <button className="btn btn-primary" type="submit">Buscar</button>
            </form>
          </div>
        </section>

        <div className="container" style={{ padding: "28px 24px 72px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <Chip href={comFiltros({ especialidade: null, pagina: null })} ativo={!especialidade}>Todas</Chip>
            {Object.entries(SPEC_LABEL).map(([slug, label]) => (
              <Chip key={slug} href={comFiltros({ especialidade: slug, pagina: null })} ativo={especialidade === slug}>
                {label}
              </Chip>
            ))}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
            <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
              {total === 0 ? "Nenhum profissional" : total === 1 ? "1 profissional" : `${total} profissionais`}
              {especialidade ? ` em ${SPEC_LABEL[especialidade].toLowerCase()}` : ""}
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(Object.keys(ORDENS) as Ordem[]).map((o) => (
                <Chip key={o} href={comFiltros({ ordem: o === "nota" ? null : o, pagina: null })} ativo={ordem === o} pequeno>
                  {ORDENS[o].label}
                </Chip>
              ))}
            </div>
          </div>

          {lista.length === 0 ? (
            <EmptyState
              titulo={busca || especialidade ? "Nenhum profissional com esses filtros" : "Ainda não há profissionais por aqui"}
              descricao={
                busca || especialidade
                  ? "Tente remover o filtro de especialidade ou buscar por outro nome."
                  : `Estamos começando o atendimento em ${REGIAO_LABEL}. Abra um pedido e avisamos assim que houver profissionais na sua região.`
              }
              acao={busca || especialidade ? { label: "Ver todos", href: "/profissionais" } : { label: "Pedir orçamento", href: "/solicitar" }}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
              {lista.map((p) => <Cartao key={p.id} p={p} />)}
            </div>
          )}

          {paginas > 1 && (
            <nav aria-label="Paginação" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 34 }}>
              {pagina > 1 && (
                <Link href={comFiltros({ pagina: String(pagina - 1) })} className="btn btn-ghost" style={{ height: 40, fontSize: 14 }}>
                  Anterior
                </Link>
              )}
              <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>Página {pagina} de {paginas}</span>
              {pagina < paginas && (
                <Link href={comFiltros({ pagina: String(pagina + 1) })} className="btn btn-ghost" style={{ height: 40, fontSize: 14 }}>
                  Próxima
                </Link>
              )}
            </nav>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

function Cartao({ p }: { p: LinhaDiretorio }) {
  const verificado = p.verification_status === "verificado";
  return (
    <Link href={`/profissional/${p.id}`} className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar nome={p.nome} id={p.id} url={p.avatar_url} size={48} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <strong style={{ fontSize: 15.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</strong>
            {verificado && (
              <span style={{ color: "var(--cool)", display: "flex", flexShrink: 0 }} title="Profissional verificado">
                <Shield size={15} />
                <span className="sr-only">Verificado</span>
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--ink-soft)", marginTop: 2 }}>
            {p.cidade ? (<><MapPin size={12} />{p.cidade}{p.estado ? `/${p.estado}` : ""}</>) : (p.tipo === "empresa" ? "Empresa" : "Autônomo")}
          </div>
        </div>
      </div>

      {/* Sem avaliação ainda, dizemos isso em vez de estampar "0,0" — nota zero
          lê como reprovação, e o profissional novo só não foi avaliado. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        {p.avaliacoes > 0 ? (
          <>
            <span style={{ color: "var(--warm)", display: "flex" }}><Star size={14} filled /></span>
            <strong>{p.nota.toFixed(1).replace(".", ",")}</strong>
            <span style={{ color: "var(--ink-soft)" }}>
              ({p.avaliacoes} {p.avaliacoes === 1 ? "avaliação" : "avaliações"})
            </span>
          </>
        ) : (
          <span style={{ color: "var(--ink-soft)" }}>Ainda sem avaliações</span>
        )}
        {p.servicos > 0 && <span style={{ color: "var(--ink-faint)" }}>· {p.servicos} serviços</span>}
      </div>

      {p.bio && (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-soft)", lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {p.bio}
        </p>
      )}

      {p.especialidades.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto", paddingTop: 4 }}>
          {p.especialidades.map((e) => (
            <span key={e} className="pro-chip">{SPEC_LABEL[e] ?? e}</span>
          ))}
        </div>
      )}
    </Link>
  );
}

function Chip({ href, ativo, pequeno, children }: { href: string; ativo: boolean; pequeno?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "true" : undefined}
      style={{
        fontSize: pequeno ? 12.5 : 13.5, fontWeight: 600,
        padding: pequeno ? "6px 12px" : "7px 14px", borderRadius: 100,
        border: "1px solid var(--line)",
        background: ativo ? "var(--cool)" : "var(--surface)",
        color: ativo ? "#fff" : "var(--ink-soft)",
      }}
    >
      {children}
    </Link>
  );
}

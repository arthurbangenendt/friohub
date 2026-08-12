import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { logout } from "../(auth)/actions";
import { rotuloJob } from "../solicitar/tipos";
import { ArrowRight, Star, MapPin } from "@/components/icons";
import type { CSSProperties } from "react";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

const STATUS: Record<string, { label: string; cor: string; bg: string }> = {
  aberto: { label: "Aberto", cor: "var(--ink-faint)", bg: "var(--surface-2)" },
  aguardando_profissional: { label: "Aguardando profissional", cor: "var(--warm)", bg: "var(--warm-wash)" },
  aceito: { label: "Aceito", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  em_execucao: { label: "Em execução", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  concluido: { label: "Concluído", cor: "#2E8B6F", bg: "#e4f3ee" },
  avaliado: { label: "Avaliado", cor: "#2E8B6F", bg: "#e4f3ee" },
  cancelado: { label: "Cancelado", cor: "#b3261e", bg: "#fdeceb" },
};

// Agrupamento dos status em abas. `aberto` entra em ativos: é job sem
// profissional designado, que ainda depende de alguém agir.
const ATIVOS = ["aberto", "aguardando_profissional", "aceito", "em_execucao"];
const FECHADOS = ["concluido", "avaliado"];

type Filtro = "ativos" | "concluidos" | "todos";
const FILTROS: { id: Filtro; label: string }[] = [
  { id: "ativos", label: "Em andamento" },
  { id: "concluidos", label: "Concluídos" },
  { id: "todos", label: "Todos" },
];

type JobRow = {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  ambiente: string | null;
  cep: string | null;
  endereco: string | null;
  btu_recomendado: number | null;
  produto: unknown;
  profissional: unknown;
  cliente: unknown;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

const dataCurta = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

export default async function PainelPage(props: PageProps<"/painel">) {
  const sp = await props.searchParams;
  const filtro: Filtro = sp.f === "concluidos" || sp.f === "todos" ? sp.f : "ativos";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("nome, role").eq("id", user.id).single();
  const nome = profile?.nome ?? user.email;
  const role = profile?.role ?? "cliente";
  const isPro = role === "profissional";

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

  const orderPorJob = new Map<string, { preco_servico: number; comissao_servico?: number; total: number; payment_status: string }>();
  for (const o of (ordersData ?? []) as { job_id: string; preco_servico: number; comissao_servico?: number; total: number; payment_status: string }[]) {
    orderPorJob.set(o.job_id, o);
  }

  // Nota média do profissional: média das especialidades ponderada pelo nº de avaliações.
  let notaMedia: number | null = null;
  let semPerfilPro = false;
  if (isPro) {
    const { data: skills } = await supabase
      .from("professional_skills")
      .select("rating_avg, rating_count")
      .eq("professional_id", user.id);
    semPerfilPro = (skills?.length ?? 0) === 0;
    const totalAval = (skills ?? []).reduce((s, k) => s + (k.rating_count ?? 0), 0);
    if (totalAval > 0) {
      const soma = (skills ?? []).reduce((s, k) => s + Number(k.rating_avg ?? 0) * (k.rating_count ?? 0), 0);
      notaMedia = soma / totalAval;
    }
  }

  const ativos = jobs.filter((j) => ATIVOS.includes(j.status));
  const concluidos = jobs.filter((j) => FECHADOS.includes(j.status));

  // Profissional: líquido dos serviços já concluídos e ainda não pagos.
  const aReceber = isPro
    ? concluidos.reduce((s, j) => {
        const o = orderPorJob.get(j.id);
        if (!o || o.payment_status === "pago") return s;
        return s + (o.preco_servico - (o.comissao_servico ?? 0));
      }, 0)
    : 0;
  // Cliente: quanto já foi contratado (soma dos pedidos com valor fechado).
  const totalGasto = !isPro
    ? jobs.reduce((s, j) => s + (orderPorJob.get(j.id)?.total ?? 0), 0)
    : 0;

  const lista =
    filtro === "ativos" ? ativos : filtro === "concluidos" ? concluidos : jobs;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "56px 24px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--cool)", margin: "0 0 10px" }}>
            {isPro ? "Painel do profissional" : "Painel"}
          </p>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>Olá, {nome}</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {role === "admin" && <Link href="/admin" className="btn btn-ghost" style={btnTopo}>Admin</Link>}
          {isPro && <Link href="/painel/perfil" className="btn btn-ghost" style={btnTopo}>Meu perfil</Link>}
          <form action={logout}>
            <button type="submit" style={{ ...btnTopo, borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-soft)", fontWeight: 600, cursor: "pointer" }}>Sair</button>
          </form>
        </div>
      </div>

      {/* ---------- RESUMO ---------- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 28 }}>
        {isPro ? (
          <>
            <Kpi label="Serviços ativos" valor={String(ativos.length)} />
            <Kpi label="Concluídos" valor={String(concluidos.length)} />
            <Kpi label="Nota média" valor={notaMedia === null ? "—" : notaMedia.toFixed(1)}
              sufixo={notaMedia === null ? "sem avaliações" : undefined}
              icone={notaMedia === null ? undefined : <Star size={15} filled />} />
            <Kpi label="A receber" valor={formatarBRL(aReceber)} sufixo="serviços concluídos não pagos" />
          </>
        ) : (
          <>
            <Kpi label="Em andamento" valor={String(ativos.length)} />
            <Kpi label="Concluídos" valor={String(concluidos.length)} />
            <Kpi label="Total contratado" valor={formatarBRL(totalGasto)} />
          </>
        )}
      </div>

      {/* CTA cliente */}
      {!isPro && (
        <Link href="/solicitar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 16, padding: "22px 24px", borderRadius: 16, background: "var(--cool)", color: "#fff", textDecoration: "none" }}>
          <div>
            <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>Precisa de um serviço?</div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>Instalação, manutenção, limpeza e mais.</div>
          </div>
          <span style={{ display: "flex" }}><ArrowRight size={20} /></span>
        </Link>
      )}

      {/* Aviso perfil pro incompleto */}
      {isPro && semPerfilPro && (
        <div style={{ marginTop: 16, padding: "20px 22px", borderRadius: 14, background: "var(--warm-wash)", color: "var(--warm)" }}>
          <strong style={{ color: "var(--ink)" }}>Complete seu perfil profissional</strong>
          <p style={{ margin: "4px 0 14px", fontSize: 14, color: "var(--ink-soft)" }}>
            Para aparecer nas buscas dos clientes, cadastre suas especialidades e área de atendimento.
          </p>
          <Link href="/painel/perfil" className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>Completar perfil</Link>
        </div>
      )}

      {/* ---------- LISTA ---------- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", margin: "36px 0 14px" }}>
        <h2 style={{ fontSize: "1.15rem", fontWeight: 700, letterSpacing: "-0.01em", margin: 0 }}>
          {isPro ? "Serviços atribuídos a você" : "Seus pedidos"}
        </h2>
        <div style={{ display: "flex", gap: 6 }}>
          {FILTROS.map((f) => {
            const n = f.id === "ativos" ? ativos.length : f.id === "concluidos" ? concluidos.length : jobs.length;
            const on = f.id === filtro;
            return (
              <Link key={f.id} href={`/painel?f=${f.id}`} style={{
                fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 100, textDecoration: "none",
                border: "1px solid var(--line)",
                background: on ? "var(--cool)" : "var(--surface)",
                color: on ? "#fff" : "var(--ink-soft)",
              }}>{f.label} ({n})</Link>
            );
          })}
        </div>
      </div>

      {lista.length === 0 ? (
        <div style={{ padding: "28px 24px", borderRadius: 14, background: "var(--surface)", border: "1px dashed var(--line)", color: "var(--ink-faint)", textAlign: "center", fontSize: 14 }}>
          {filtro === "ativos"
            ? (isPro ? "Nenhum serviço em andamento. Quando um cliente te escolher, aparece aqui." : "Nenhum pedido em andamento.")
            : filtro === "concluidos" ? "Nenhum serviço concluído ainda."
            : (isPro ? "Nenhum serviço ainda." : "Você ainda não fez nenhum pedido.")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lista.map((j) => {
            const prod = one(j.produto) as { marca: string; modelo: string } | null;
            const proObj = one(j.profissional) as { profiles: unknown } | null;
            const proPerfil = proObj && (one(proObj.profiles) as { nome: string } | null);
            const cliObj = one(j.cliente) as { nome: string } | null;
            const st = STATUS[j.status] ?? STATUS.aberto;
            const outraParte = isPro ? cliObj?.nome : proPerfil?.nome;
            const o = orderPorJob.get(j.id);
            const valor = isPro
              ? (o ? o.preco_servico - (o.comissao_servico ?? 0) : null)
              : (o ? o.total : null);

            return (
              <Link key={j.id} href={`/servico/${j.id}`} style={cardJob}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>{rotuloJob(j.job_type)}</span>
                    <span style={{ fontSize: 11.5, fontFamily: mono, color: "var(--ink-faint)" }}>{dataCurta(j.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 3 }}>
                    {outraParte ? `${isPro ? "Cliente" : "Profissional"}: ${outraParte}` : "Sem profissional designado"}
                    {prod ? ` · ${prod.marca} ${prod.modelo}` : ""}
                    {j.ambiente ? ` · ${j.ambiente}` : ""}
                  </div>
                  {(j.endereco || j.cep) && (
                    <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                      <MapPin size={13} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {[j.endereco, j.cep].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontFamily: mono, padding: "5px 11px", borderRadius: 100, background: st.bg, color: st.cor, whiteSpace: "nowrap" }}>{st.label}</span>
                  {valor !== null && (
                    <span style={{ fontSize: 14, fontWeight: 700 }}>
                      {formatarBRL(valor)}
                      {isPro && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-faint)" }}> líquido</span>}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Kpi({ label, valor, sufixo, icone }: { label: string; valor: string; sufixo?: string; icone?: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)" }}>
      <div style={{ fontSize: 11.5, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ink-faint)" }}>{label}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 800, letterSpacing: "-0.02em", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
        {icone && <span style={{ color: "var(--warm)", display: "flex" }}>{icone}</span>}
        {valor}
      </div>
      {sufixo && <div style={{ fontSize: 11.5, color: "var(--ink-faint)", marginTop: 2 }}>{sufixo}</div>}
    </div>
  );
}

const btnTopo: CSSProperties = { height: 38, padding: "0 14px", fontSize: 13.5 };
const cardJob: CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 14,
  background: "var(--surface)", border: "1px solid var(--line)", color: "inherit", textDecoration: "none",
};

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminActions } from "./AdminActions";
import { CIDADE } from "@/lib/regiao";
import { STATUS_VERIFICACAO, resolverMapa } from "@/lib/status";
import { one } from "@/lib/relacional";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};
const STATUS_LABEL = resolverMapa(STATUS_VERIFICACAO);

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data: pros } = await supabase
    .from("professionals")
    .select(`id, tipo, bio, cidade, estado, verification_status, created_at,
             profiles!inner ( nome ),
             professional_skills ( specialty )`)
    .order("verification_status");

  const lista = (pros ?? []).map((p) => ({
    id: p.id,
    nome: one(p.profiles)?.nome ?? "Profissional",
    tipo: p.tipo as string,
    bio: p.bio as string | null,
    cidade: p.cidade as string,
    estado: p.estado as string,
    status: p.verification_status as string,
    skills: ((p.professional_skills ?? []) as { specialty: string }[]).map((s) => s.specialty),
  }));

  const pendentes = lista.filter((p) => p.status === "pendente" || p.status === "em_analise");
  const outros = lista.filter((p) => p.status === "verificado" || p.status === "rejeitado");

  /* Distribuidoras usam o mesmo trio de colunas de confiança e a mesma dupla de
     ações — ver `definirVerificacao` em admin/actions.ts. */
  const { data: dists } = await supabase
    .from("distributors")
    .select("id, razao_social, cidade, estado, verification_status, ativo, prazo_entrega_dias")
    .order("verification_status");

  const distribuidoras = await Promise.all((dists ?? []).map(async (dist) => {
    const { data: cnpj } = await supabase.rpc("obter_cnpj_distribuidora", {
      p_distributor_id: dist.id,
    });
    return { ...dist, cnpj };
  }));
  const distPendentes = distribuidoras.filter((d) => d.verification_status === "pendente" || d.verification_status === "em_analise");
  const distOutros = distribuidoras.filter((d) => d.verification_status === "verificado" || d.verification_status === "rejeitado");

  const { data: casosOperacionais } = await supabase
    .from("operational_cases")
    .select("id, case_type, aggregate_type, aggregate_id, priority, opened_at, details")
    .eq("status", "open")
    .order("opened_at", { ascending: true });

  const { data: ultimaReconciliacao } = await supabase
    .from("financial_reconciliation_runs")
    .select("id, status, started_at, finished_at, checked_records, divergence_count")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: divergenciasFinanceiras } = ultimaReconciliacao
    ? await supabase
      .from("financial_reconciliation_items")
      .select("id, order_id, charge_id, divergence_type, expected_value, actual_value, details, created_at")
      .eq("run_id", ultimaReconciliacao.id)
      .is("resolved_at", null)
      .order("created_at", { ascending: true })
      .limit(100)
    : { data: [] };

  const { data: funilData } = await supabase.rpc("obter_funil_marketplace", {
    p_days: 30,
    p_city: CIDADE,
  });
  const funil = funilData?.[0] ?? null;

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Painel</Link>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
        <Link href="/admin/saude" className="btn">Saúde operacional</Link>
        <Link href="/admin/financeiro" className="btn">Financeiro (ledger e conciliação)</Link>
        <Link href="/admin/pmoc" className="btn">Fila PMOC</Link>
        <Link href="/admin/assinaturas" className="btn">Assinaturas</Link>
        <Link href="/admin/rollout" className="btn">Rollout UX</Link>
      </div>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "20px 0 6px" }}>Verificação de profissionais</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 30 }}>
        Aprove os profissionais antes que apareçam nas buscas (RISCO 4 — qualidade da rede).
      </p>

      <Secao titulo="Funil do marketplace · últimos 30 dias">
        {!funil ? <Vazio texto="Métricas ainda indisponíveis." /> : <FunilMarketplace funil={funil} />}
      </Secao>

      <Secao titulo={`Exceções operacionais (${casosOperacionais?.length ?? 0})`}>
        {!casosOperacionais?.length
          ? <Vazio texto="Nenhum atendimento fora do SLA." />
          : casosOperacionais.map((caso) => (
            <CardOperacional key={caso.id} caso={caso as CasoOperacional} />
          ))}
      </Secao>

      <Secao titulo={`Divergências financeiras (${divergenciasFinanceiras?.length ?? 0})`}>
        {ultimaReconciliacao && (
          <p style={{ margin: "0 0 4px", color: "var(--ink-faint)", fontSize: 12.5 }}>
            Última reconciliação: {new Date(ultimaReconciliacao.started_at).toLocaleString("pt-BR")}
            {` · ${ultimaReconciliacao.checked_records} ordens verificadas`}
          </p>
        )}
        {!divergenciasFinanceiras?.length
          ? <Vazio texto="Nenhuma divergência financeira aberta." />
          : divergenciasFinanceiras.map((item) => (
            <CardDivergencia key={item.id} item={item as DivergenciaFinanceira} />
          ))}
      </Secao>

      <Secao titulo={`Aguardando análise (${pendentes.length})`}>
        {pendentes.length === 0
          ? <Vazio texto="Nenhum profissional aguardando." />
          : pendentes.map((p) => <Card key={p.id} p={p} />)}
      </Secao>

      <Secao titulo={`Já revisados (${outros.length})`}>
        {outros.length === 0
          ? <Vazio texto="Ninguém revisado ainda." />
          : outros.map((p) => <Card key={p.id} p={p} />)}
      </Secao>

      <h2 style={{ fontSize: "1.4rem", fontWeight: 800, margin: "44px 0 6px" }}>Distribuidoras</h2>
      <p style={{ color: "var(--ink-soft)", marginBottom: 24, fontSize: 14.5 }}>
        Aprovar deixa a distribuidora verificada <strong>e ativa</strong> — os produtos dela entram no
        catálogo na mesma hora.
      </p>

      <Secao titulo={`Aguardando análise (${distPendentes.length})`}>
        {distPendentes.length === 0
          ? <Vazio texto="Nenhuma distribuidora aguardando." />
          : distPendentes.map((d) => <CardDist key={d.id} d={d} />)}
      </Secao>

      <Secao titulo={`Já revisadas (${distOutros.length})`}>
        {distOutros.length === 0
          ? <Vazio texto="Nenhuma revisada ainda." />
          : distOutros.map((d) => <CardDist key={d.id} d={d} />)}
      </Secao>
    </main>
  );
}

type FunilRow = {
  requested: number;
  responded: number;
  accepted: number;
  started: number;
  completed: number;
  repeat_customers: number;
  avg_first_response_minutes: number | null;
};

function FunilMarketplace({ funil }: { funil: FunilRow }) {
  const etapas = [
    ["Solicitações", funil.requested],
    ["Com resposta", funil.responded],
    ["Aceitas", funil.accepted],
    ["Em execução", funil.started],
    ["Concluídas", funil.completed],
  ] as const;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {etapas.map(([label, value], index) => {
          const base = index === 0 ? value : etapas[index - 1][1];
          const conversao = index === 0 || base === 0 ? null : Math.round((value / base) * 100);
          return (
            <div key={label} className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{label}</div>
              <strong style={{ display: "block", fontSize: 24, marginTop: 3 }}>{value}</strong>
              {conversao !== null && <span style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{conversao}% da etapa anterior</span>}
            </div>
          );
        })}
      </div>
      <p style={{ margin: "12px 0 0", color: "var(--ink-faint)", fontSize: 12.5 }}>
        Primeira resposta: {funil.avg_first_response_minutes === null ? "sem dados" : `${funil.avg_first_response_minutes} min`}
        {` · ${funil.repeat_customers} cliente(s) recorrente(s)`}
      </p>
    </div>
  );
}

type CasoOperacional = {
  id: string;
  case_type: string;
  aggregate_type: string;
  aggregate_id: string;
  priority: string;
  opened_at: string;
  details: Record<string, unknown>;
};

type DivergenciaFinanceira = {
  id: string;
  order_id: string | null;
  charge_id: string | null;
  divergence_type: string;
  expected_value: number | null;
  actual_value: number | null;
  details: Record<string, unknown>;
  created_at: string;
};

const DIVERGENCIA_LABEL: Record<string, string> = {
  paid_without_ledger: "Ordem marcada como paga sem ledger",
  received_without_paid_projection: "Recebimento não refletido na ordem",
  amount_mismatch: "Valor da cobrança diferente da ordem",
  stuck_gateway_event: "Evento do gateway travado",
  partial_refund_requires_review: "Reembolso parcial exige análise",
  disputed_payment: "Pagamento em disputa/chargeback",
};

function CardDivergencia({ item }: { item: DivergenciaFinanceira }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <strong style={{ color: "var(--danger)", fontSize: 14.5 }}>
          {DIVERGENCIA_LABEL[item.divergence_type] ?? item.divergence_type}
        </strong>
        <time style={{ color: "var(--ink-faint)", fontSize: 12.5 }}>
          {new Date(item.created_at).toLocaleString("pt-BR")}
        </time>
      </div>
      <div style={{ marginTop: 7, color: "var(--ink-faint)", fontSize: 12.5, fontFamily: mono }}>
        order {item.order_id ?? "—"} · charge {item.charge_id ?? "—"}
      </div>
      {(item.expected_value !== null || item.actual_value !== null) && (
        <div style={{ marginTop: 7, fontSize: 13 }}>
          Esperado: {item.expected_value ?? "—"} · observado: {item.actual_value ?? "—"}
        </div>
      )}
      {typeof item.details.last_error === "string" && (
        <p style={{ margin: "7px 0 0", color: "var(--ink-soft)", fontSize: 13 }}>{item.details.last_error}</p>
      )}
    </div>
  );
}

function CardOperacional({ caso }: { caso: CasoOperacional }) {
  const pedido = caso.aggregate_type === "quote_request";
  const rotulo = caso.case_type === "quote_without_response"
    ? "Pedido sem proposta no prazo"
    : "Serviço aguardando aceite do profissional";
  const cor = caso.priority === "critical" ? "var(--danger)" : "var(--warm)";

  return (
    <div className="card" style={{ padding: 18, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15 }}>{rotulo}</strong>
          <span style={{ fontFamily: mono, fontSize: 11.5, color: cor }}>
            {caso.priority === "critical" ? "CRÍTICO" : "ALTO"}
          </span>
        </div>
        <div style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 5 }}>
          Aberto em {new Date(caso.opened_at).toLocaleString("pt-BR")}
          {typeof caso.details.urgencia === "string" ? ` · ${caso.details.urgencia}` : ""}
        </div>
      </div>
      <Link className="btn btn-primary" href={pedido
        ? `/painel/orcamentos/${caso.aggregate_id}`
        : `/servico/${caso.aggregate_id}`}>
        Analisar atendimento
      </Link>
    </div>
  );
}

function CardDist({ d }: {
  d: { id: string; razao_social: string; cnpj: string | null; cidade: string; estado: string; verification_status: string; ativo: boolean; prazo_entrega_dias: number };
}) {
  const st = STATUS_LABEL[d.verification_status] ?? STATUS_LABEL.pendente;
  return (
    <div className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{d.razao_social}</strong>
          <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
          {d.verification_status === "verificado" && !d.ativo && (
            <span style={{ fontSize: 11.5, fontFamily: mono, color: "var(--warm)" }}>inativa</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          {d.cidade} — {d.estado} · entrega em {d.prazo_entrega_dias} dia(s)
          {d.cnpj ? ` · CNPJ ${d.cnpj}` : " · sem CNPJ informado"}
        </div>
      </div>
      <AdminActions id={d.id} status={d.verification_status} tipo="distribuidora" />
    </div>
  );
}

function Card({ p }: { p: { id: string; nome: string; tipo: string; bio: string | null; cidade: string; estado: string; status: string; skills: string[] } }) {
  const st = STATUS_LABEL[p.status] ?? STATUS_LABEL.pendente;
  return (
    <div className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{p.nome}</strong>
          <span style={{ fontSize: 11.5, color: "var(--ink-faint)", fontFamily: mono }}>{p.tipo === "empresa" ? "Empresa" : "Autônomo"}</span>
          <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>{st.label}</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          {p.cidade} — {p.estado} · {p.skills.map((s) => SPEC_LABEL[s] ?? s).join(", ") || "sem especialidades"}
        </div>
        {p.bio && <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 6 }}>{p.bio}</p>}
        <Link href={`/profissional/${p.id}`} target="_blank" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600, marginTop: 6, display: "inline-block" }}>Ver perfil →</Link>
      </div>
      <AdminActions id={p.id} status={p.status} />
    </div>
  );
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>{titulo}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}
function Vazio({ texto }: { texto: string }) {
  return <div style={{ padding: "20px", borderRadius: 12, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14, textAlign: "center" }}>{texto}</div>;
}

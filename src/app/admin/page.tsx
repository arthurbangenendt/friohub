import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
import { formatarBRL } from "@/lib/pricing";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

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

  const agora = new Date();
  const trintaDiasAtras = new Date(agora);
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

  const [{ data: funilData }, { data: funilAnteriorData }] = await Promise.all([
    supabase.rpc("obter_funil_marketplace", { p_days: 30, p_city: CIDADE, p_end_date: agora.toISOString() }),
    supabase.rpc("obter_funil_marketplace", { p_days: 30, p_city: CIDADE, p_end_date: trintaDiasAtras.toISOString() }),
  ]);
  const funil = funilData?.[0] ?? null;
  const funilAnterior = funilAnteriorData?.[0] ?? null;

  // obter_receita_gmv_mensal devolve em ordem crescente: [0] mês passado, [1] mês atual.
  const { data: receitaData } = await supabase.rpc("obter_receita_gmv_mensal", { p_meses: 2 });
  const [mesPassado, mesAtual] = receitaData ?? [];

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Visão geral</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 30 }}>
        Receita, funil do marketplace, atendimentos fora do SLA e divergências financeiras abertas.
      </p>

      <Secao titulo="Receita da plataforma · este mês">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <TileMoeda
            label="Receita da plataforma"
            valor={Number(mesAtual?.receita ?? 0)}
            valorAnterior={Number(mesPassado?.receita ?? 0)}
            nota="comissão + margem + assinatura"
          />
          <TileMoeda
            label="GMV"
            valor={Number(mesAtual?.gmv ?? 0)}
            valorAnterior={Number(mesPassado?.gmv ?? 0)}
            nota="volume total transacionado"
          />
        </div>
        <Link href="/admin/financeiro" style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600, marginTop: 12, display: "inline-block" }}>
          Ver detalhe mês a mês →
        </Link>
      </Secao>

      <Secao titulo="Funil do marketplace · últimos 30 dias">
        {!funil ? <Vazio texto="Métricas ainda indisponíveis." /> : <FunilMarketplace funil={funil} funilAnterior={funilAnterior} />}
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

function FunilMarketplace({ funil, funilAnterior }: { funil: FunilRow; funilAnterior: FunilRow | null }) {
  const etapas = [
    ["Solicitações", funil.requested, funilAnterior?.requested],
    ["Com resposta", funil.responded, funilAnterior?.responded],
    ["Aceitas", funil.accepted, funilAnterior?.accepted],
    ["Em execução", funil.started, funilAnterior?.started],
    ["Concluídas", funil.completed, funilAnterior?.completed],
  ] as const;

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {etapas.map(([label, value, valorAnterior], index) => {
          const base = index === 0 ? value : etapas[index - 1][1];
          const conversao = index === 0 || base === 0 ? null : Math.round((value / base) * 100);
          // Sem base de comparação (período anterior zerado) não dá delta — "+∞%" seria mentira.
          const deltaPct = valorAnterior && valorAnterior > 0 ? Math.round(((value - valorAnterior) / valorAnterior) * 100) : null;
          return (
            <div key={label} className="card" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{label}</div>
              <strong style={{ display: "block", fontSize: 24, marginTop: 3 }}>{value}</strong>
              {conversao !== null && <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-soft)" }}>{conversao}% da etapa anterior</span>}
              {deltaPct !== null && (
                <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: deltaPct >= 0 ? "var(--good)" : "var(--danger)" }}>
                  {deltaPct >= 0 ? "+" : ""}{deltaPct}% vs. período anterior
                </span>
              )}
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
function TileMoeda({ label, valor, valorAnterior, nota }: { label: string; valor: number; valorAnterior: number; nota: string }) {
  // Sem base de comparação (mês anterior zerado) não dá delta — mostrar "+∞%" seria mentira.
  const deltaPct = valorAnterior > 0 ? Math.round(((valor - valorAnterior) / valorAnterior) * 100) : null;
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>{label}</div>
      <strong style={{ display: "block", fontSize: 22, marginTop: 3, letterSpacing: "-0.02em" }}>{formatarBRL(valor)}</strong>
      <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 2 }}>
        {nota}
        {deltaPct !== null && (
          <span style={{ color: deltaPct >= 0 ? "var(--good)" : "var(--danger)", fontWeight: 600 }}>
            {` · ${deltaPct >= 0 ? "+" : ""}${deltaPct}% vs. mês passado`}
          </span>
        )}
      </div>
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

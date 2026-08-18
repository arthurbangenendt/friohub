import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { STATUS_COBRANCA, resolver } from "@/lib/status";
import { Alert, EmptyState } from "@/components/ui";

/* Ledger e conciliação, visão do administrador.
 *
 * É a única tela do bloco financeiro que tem chance de mostrar dado real hoje:
 * `reconciliar_financeiro` roda de hora em hora por pg_cron, independente de
 * existir gateway. Com a fila vazia ela reporta zero divergências, o que já é
 * informação — significa que a conciliação está viva.
 *
 * O saldo por conta sai de `financial_postings`, e não de uma coluna de saldo:
 * ledger de partidas dobradas não guarda saldo, ele deriva do somatório. Guardar
 * saldo materializado abriria a possibilidade de ele divergir dos lançamentos,
 * que é justamente o que a partida dobrada existe para impedir.
 */

const CONTA_LABEL: Record<string, string> = {
  gateway_clearing: "Liquidado no gateway",
  professional_payable: "A pagar a profissionais",
  distributor_payable: "A pagar a distribuidoras",
  platform_commission: "Receita de comissão",
  platform_product_margin: "Receita de margem",
  platform_subscription_revenue: "Receita de assinatura",
};

const DIVERGENCIA_LABEL: Record<string, string> = {
  paid_without_ledger: "Order marcada como paga sem lançamento no ledger",
  received_without_paid_projection: "Cobrança liquidada sem a order refletir",
  amount_mismatch: "Valor da cobrança diferente do valor da order",
  stuck_gateway_event: "Evento do gateway parado sem processar",
  partial_refund_requires_review: "Reembolso parcial exige revisão manual",
  disputed_payment: "Pagamento em disputa",
};

export default async function AdminFinanceiroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/painel");

  const [
    { data: postings, error: erroPostings },
    { data: cobrancas, error: erroCobrancas },
    { data: corridas, error: erroCorridas },
    { data: divergencias, error: erroDivergencias },
  ] = await Promise.all([
    supabase.from("financial_postings").select("account_code, direction, amount").limit(5000),
    supabase.from("payment_charges").select("id, status, amount, created_at, order_id, subscription_id").order("created_at", { ascending: false }).limit(50),
    supabase.from("financial_reconciliation_runs").select("id, status, started_at, finished_at, checked_records, divergence_count, error_message").order("started_at", { ascending: false }).limit(5),
    supabase.from("financial_reconciliation_items").select("id, divergence_type, expected_value, actual_value, order_id, charge_id, created_at").is("resolved_at", null).order("created_at", { ascending: false }).limit(40),
  ]);

  /* As quatro consultas acima já foram vistas devolvendo "vazio" quando na
     verdade tinham falhado (RLS, sessão, coluna) — o `?? []` de cada uma
     escondia o erro por completo. Erro aqui não pode virar EmptyState. */
  const erro = erroPostings ?? erroCobrancas ?? erroCorridas ?? erroDivergencias;

  /* Débito e crédito têm sinais opostos por definição; qual deles aumenta o
     saldo depende da natureza da conta. Aqui o saldo é apresentado como
     "movimento líquido" (débito menos crédito), que é o suficiente para
     conferir se o ledger fecha — a leitura contábil por natureza de conta é
     trabalho de quem exporta, não desta tela. */
  const saldo = new Map<string, number>();
  for (const p of postings ?? []) {
    const v = Number(p.amount) * (p.direction === "debit" ? 1 : -1);
    saldo.set(p.account_code, (saldo.get(p.account_code) ?? 0) + v);
  }
  const totalDebito = (postings ?? []).filter((p) => p.direction === "debit").reduce((s, p) => s + Number(p.amount), 0);
  const totalCredito = (postings ?? []).filter((p) => p.direction === "credit").reduce((s, p) => s + Number(p.amount), 0);
  const fecha = Math.abs(totalDebito - totalCredito) < 0.005;

  const ultima = corridas?.[0];

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "40px 28px 80px" }}>
      <Link href="/admin" style={{ fontSize: 13.5, color: "var(--cool-deep)" }}>← Administração</Link>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "12px 0 6px" }}>
        Ledger e conciliação
      </h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>
        Partidas dobradas, cobranças e as divergências apuradas pela rotina horária.
      </p>

      {erro && (
        <Alert tipo="erro" titulo="Não foi possível carregar os dados financeiros">
          {erro.message}
        </Alert>
      )}

      {!erro && (postings ?? []).length === 0 && (
        <Alert tipo="aviso" titulo="Nenhum lançamento no ledger">
          Nenhuma cobrança foi criada até agora. As RPCs financeiras são
          exclusivas de <code>service_role</code> e o gateway não está conectado
          — a flag <code>asaas_payments</code> segue desligada. A rotina de
          conciliação continua rodando e reportando zero divergências, que é o
          resultado correto para uma base sem movimento.
        </Alert>
      )}

      {/* Se débito e crédito não fecham, nada mais nesta tela é confiável — por
          isso o aviso vem antes dos números. */}
      {(postings ?? []).length > 0 && (
        <Alert tipo={fecha ? "sucesso" : "erro"} titulo={fecha ? "Ledger fecha" : "Ledger NÃO fecha"}>
          Débitos {formatarBRL(totalDebito)} · Créditos {formatarBRL(totalCredito)}
          {fecha ? "." : " — há lançamento desbalanceado, investigue antes de usar qualquer número desta tela."}
        </Alert>
      )}

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "28px 0 12px" }}>Movimento por conta</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {Object.entries(CONTA_LABEL).map(([codigo, label]) => (
          <div key={codigo} className="card" style={{ padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{label}</div>
            <strong style={{ fontSize: "1.15rem", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {formatarBRL(saldo.get(codigo) ?? 0)}
            </strong>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "32px 0 12px" }}>Conciliação</h2>
      {!ultima ? (
        <EmptyState titulo="A conciliação ainda não rodou" descricao="A rotina roda de hora em hora por pg_cron. Se nada aparecer aqui em mais de uma hora, verifique a saúde do sistema." />
      ) : (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <strong style={{ fontSize: 14.5 }}>Última apuração</strong>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 2 }}>
                {new Date(ultima.started_at).toLocaleString("pt-BR")} · {ultima.checked_records} registros conferidos
              </div>
            </div>
            <span style={{
              fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 100, alignSelf: "start",
              background: ultima.divergence_count > 0 ? "var(--danger-wash)" : "var(--good-wash)",
              color: ultima.divergence_count > 0 ? "var(--danger)" : "var(--good)",
            }}>
              {ultima.divergence_count === 0 ? "Sem divergências" : `${ultima.divergence_count} divergências`}
            </span>
          </div>
          {ultima.error_message && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--danger)" }}>{ultima.error_message}</p>
          )}
        </div>
      )}

      {(divergencias ?? []).length > 0 && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {(divergencias ?? []).map((d) => (
            <div key={d.id} className="card" style={{ padding: "14px 16px", borderLeft: "3px solid var(--danger)" }}>
              <strong style={{ fontSize: 14 }}>{DIVERGENCIA_LABEL[d.divergence_type] ?? d.divergence_type}</strong>
              <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>
                {d.order_id && <>Order {d.order_id.slice(0, 8)} · </>}
                {d.expected_value !== null && d.actual_value !== null && (
                  <>esperado {formatarBRL(Number(d.expected_value))}, encontrado {formatarBRL(Number(d.actual_value))} · </>
                )}
                {new Date(d.created_at).toLocaleString("pt-BR")}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "32px 0 12px" }}>Cobranças recentes</h2>
      {(cobrancas ?? []).length === 0 ? (
        <EmptyState titulo="Nenhuma cobrança emitida" descricao="Aparecerão aqui assim que o gateway de pagamento for conectado." />
      ) : (
        <div style={{ display: "grid", gap: 2 }}>
          {(cobrancas ?? []).map((c) => {
            const e = resolver(STATUS_COBRANCA, c.status);
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
                <span style={{ fontSize: 13.5 }}>
                  {c.order_id ? `Order ${c.order_id.slice(0, 8)}` : `Assinatura ${c.subscription_id?.slice(0, 8) ?? ""}`}
                  <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)" }}>
                    {new Date(c.created_at).toLocaleString("pt-BR")}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: e.bg, color: e.cor }}>{e.label}</span>
                  <strong style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{formatarBRL(Number(c.amount))}</strong>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL, TAXA_COMISSAO } from "@/lib/pricing";
import { Kpi, FECHADOS, wrap } from "../shared";
import { GraficoMeses, type PontoMes } from "./GraficoMeses";
import { DespesasEditor, type Despesa, type ServicoParaDespesa } from "./DespesasEditor";
import { PERIODOS, chaveMes, comoPeriodo, janela, rotuloPeriodo } from "./periodo";
import { Doc } from "@/components/icons";
import { Repasses } from "./Repasses";
import { rotuloJob } from "../../solicitar/tipos";

export default async function FinanceiroPage({ searchParams }: PageProps<"/painel/financeiro">) {
  const sp = await searchParams;
  const periodo = comoPeriodo(sp.p);
  const { inicio, fim, meses } = janela(periodo);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isPro = profile?.role === "profissional";

  /* Filtrar no banco, e não em memória: antes a tela puxava todas as `orders`
     do usuário e 300 jobs para depois descartar quase tudo no JavaScript.
     `orders` não tem `profissional_id` — o vínculo é por `job_id` —, então o
     recorte por usuário continua sendo responsabilidade da RLS. */
  const [{ data: jobs }, { data: ordersData }, { data: despesasData }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, created_at, job_type")
      .gte("created_at", inicio)
      .lt("created_at", fim)
      .order("created_at", { ascending: false }),
    isPro
      ? supabase.from("orders").select("job_id, preco_servico, comissao_servico, total, payment_status, created_at").gte("created_at", inicio).lt("created_at", fim)
      : supabase.from("orders_cliente").select("job_id, preco_servico, total, payment_status, created_at").gte("created_at", inicio).lt("created_at", fim),
    // Despesas só existem para o profissional — é custo operacional dele.
    isPro
      ? supabase.from("expenses").select("id, job_id, categoria, descricao, valor, data").gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10)).order("data", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  type OrderRow = { job_id: string; preco_servico: number; comissao_servico?: number; total: number; payment_status: string; created_at: string };
  const orders = (ordersData ?? []) as OrderRow[];
  const despesas = ((despesasData ?? []) as Despesa[]).map((d) => ({ ...d, valor: Number(d.valor) }));
  const servicosParaDespesa: ServicoParaDespesa[] = (jobs ?? []).map((job) => ({
    id: job.id,
    label: `${rotuloJob(job.job_type)} · ${new Date(job.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · #${job.id.slice(0, 8)}`,
  }));
  const rotuloServico = new Map(servicosParaDespesa.map((servico) => [servico.id, servico.label]));

  const porMes = new Map<string, PontoMes>(meses.map((m) => [m.chave, { mes: m.label, receita: 0, despesa: 0 }]));

  const concluidos = (jobs ?? []).filter((j) => FECHADOS.includes(j.status));
  const pagos = orders.filter((o) => o.payment_status === "pago");
  const pendentes = orders.filter((o) => o.payment_status === "pendente");

  for (const o of pagos) {
    const ponto = porMes.get(chaveMes(o.created_at));
    if (!ponto) continue;
    ponto.receita += isPro ? o.preco_servico - (o.comissao_servico ?? 0) : o.total;
  }
  for (const d of despesas) {
    const ponto = porMes.get(chaveMes(d.data));
    if (ponto) ponto.despesa += d.valor;
  }
  const serie = [...porMes.values()];

  // Receita só existe quando o gateway liquidou o pagamento. Status do serviço
  // não é evidência financeira e não entra nesses KPIs.
  const bruto = pagos.reduce((s, o) => s + o.preco_servico, 0);
  const comissao = pagos.reduce((s, o) => s + (o.comissao_servico ?? 0), 0);
  const liquido = bruto - comissao;
  const totalDespesas = despesas.reduce((s, d) => s + d.valor, 0);
  const totalCliente = orders.reduce((s, o) => s + o.total, 0);
  const totalPagoCliente = pagos.reduce((s, o) => s + o.total, 0);

  /* Duas coisas diferentes que a tela antiga tratava como uma: o que já foi
     entregue e ainda não caiu (cobrável agora) e o que nem foi entregue
     (previsão). Somar os dois num número só faz o profissional achar que tem
     dinheiro para receber que ainda depende dele executar o serviço. */
  const liquidoDe = (o: OrderRow) => o.preco_servico - (o.comissao_servico ?? 0);
  const jobsConcluidos = new Set(concluidos.map((j) => j.id));
  const aReceber = pendentes.filter((o) => jobsConcluidos.has(o.job_id)).reduce((s, o) => s + liquidoDe(o), 0);
  const emAndamento = pendentes.filter((o) => !jobsConcluidos.has(o.job_id)).reduce((s, o) => s + liquidoDe(o), 0);

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Financeiro</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 20px" }}>
        {isPro
          ? "O que entrou, o que saiu e o que ainda está para receber."
          : "Quanto você já contratou pela plataforma."}
      </p>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {PERIODOS.map((p) => {
            const on = p.id === periodo;
            return (
              <Link
                key={p.id}
                href={p.id === "semestre" ? "/painel/financeiro" : `/painel/financeiro?p=${p.id}`}
                aria-current={on ? "page" : undefined}
                style={{
                  fontSize: 13, fontWeight: 600, padding: "6px 13px", borderRadius: 100,
                  border: "1px solid var(--line)",
                  background: on ? "var(--cool)" : "var(--surface)",
                  color: on ? "#fff" : "var(--ink-soft)",
                }}
              >
                {p.label}
              </Link>
            );
          })}
        </div>

        {/* Link comum, não fetch: o navegador cuida do download e o arquivo sai
            com o período que está na tela. */}
        {isPro && (
          <a
            href={`/painel/financeiro/exportar?p=${periodo}`}
            className="btn btn-ghost"
            style={{ height: 36, padding: "0 13px", fontSize: 13.5 }}
          >
            <Doc size={15} /> Exportar CSV
          </a>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        {isPro ? (
          <>
            <Kpi label="Recebido bruto" valor={formatarBRL(bruto)} sufixo="pagamentos liquidados" />
            <Kpi label={`Comissão (${Math.round(TAXA_COMISSAO * 100)}%)`} valor={`- ${formatarBRL(comissao)}`} />
            <Kpi label="Despesas" valor={`- ${formatarBRL(totalDespesas)}`} />
            <Kpi label="Resultado" valor={formatarBRL(liquido - totalDespesas)} sufixo="líquido menos despesas" />
          </>
        ) : (
          <>
            <Kpi label="Total contratado" valor={formatarBRL(totalCliente)} />
            <Kpi label="Total pago" valor={formatarBRL(totalPagoCliente)} />
            <Kpi label="Serviços concluídos" valor={String(concluidos.length)} />
          </>
        )}
      </div>

      {isPro && (aReceber > 0 || emAndamento > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 12, marginTop: 14 }}>
          {aReceber > 0 && (
            <div style={{ padding: "14px 18px", borderRadius: 12, background: "var(--warning-wash)", borderLeft: "3px solid var(--warning)", fontSize: 13.5, lineHeight: 1.55 }}>
              <strong style={{ display: "block", fontSize: 16, color: "var(--ink)" }}>{formatarBRL(aReceber)}</strong>
              <span style={{ color: "var(--ink-soft)" }}>
                Serviço concluído, pagamento não liquidado. É o que você pode cobrar agora.
              </span>
            </div>
          )}
          {emAndamento > 0 && (
            <div style={{ padding: "14px 18px", borderRadius: 12, background: "var(--surface-2)", borderLeft: "3px solid var(--cool)", fontSize: 13.5, lineHeight: 1.55 }}>
              <strong style={{ display: "block", fontSize: 16, color: "var(--ink)" }}>{formatarBRL(emAndamento)}</strong>
              <span style={{ color: "var(--ink-soft)" }}>
                Em serviços ainda em andamento. É previsão, não valor a cobrar.
              </span>
            </div>
          )}
        </div>
      )}

      <section className="card" style={{ padding: 24, marginTop: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>
          {isPro ? "Pagamentos liquidados e despesas" : "Pagamentos liquidados por mês de contratação"}
        </h2>
        <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 6px" }}>{rotuloPeriodo(periodo)}.</p>
        <GraficoMeses dados={serie} comDespesa={isPro} />
      </section>

      {isPro && (
        <section style={{ marginTop: 22 }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Despesas</h2>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 16px" }}>
            Compras de ferramentas entram automaticamente quando você informa o valor. Lance aqui gasolina, locação e os demais custos da operação.
          </p>
          <DespesasEditor inicial={despesas} periodo={rotuloPeriodo(periodo)} servicos={servicosParaDespesa} />
        </section>
      )}

      {isPro && (
        <section className="card" style={{ padding: 24, marginTop: 16 }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 4px" }}>Valores recebidos pela plataforma</h2>
          <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 16px" }}>
            Quanto cada pagamento destinou a você depois da comissão do FrioHub.
            O valor é registrado no momento da cobrança e não recalculado depois.
          </p>
          <Repasses inicio={inicio} fim={fim} />
        </section>
      )}

      {isPro && (
        <section className="card" style={{ padding: 24, marginTop: 16 }}>
          <h2 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Quanto sobrou em cada serviço</h2>
          <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>
            Valor recebido depois da comissão, menos as despesas vinculadas ao atendimento. Despesas gerais afetam apenas o resultado do período.
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            {pagos.slice(0, 10).map((order) => {
              const custo = despesas.filter((d) => d.job_id === order.job_id).reduce((sum, d) => sum + d.valor, 0);
              const receita = order.preco_servico - (order.comissao_servico ?? 0);
              return (
                <Link key={`${order.job_id}-${order.created_at}`} href={`/servico/${order.job_id}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid var(--line-soft)", padding: "8px 0" }}>
                  <span>{rotuloServico.get(order.job_id) ?? `Serviço #${order.job_id.slice(0, 8)}`}</span>
                  <strong>{formatarBRL(receita - custo)}</strong>
                </Link>
              );
            })}
            {!pagos.length && <span style={{ color: "var(--ink-soft)" }}>A margem aparecerá após o primeiro pagamento liquidado neste período.</span>}
          </div>
        </section>
      )}

    </div>
  );
}

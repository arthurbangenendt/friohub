import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { STATUS_COBRANCA, resolver } from "@/lib/status";
import { Alert } from "@/components/ui";

/* Repasses do profissional.
 *
 * Lê `payment_allocations` filtrando pelo tipo `professional_payable`. O recorte
 * por beneficiário é da RLS — política `payment_allocations_beneficiario_read`,
 * criada em 20260814140000.
 *
 * Por que não calcular a partir de `orders`: `payment_allocations` é o rateio
 * CONGELADO no instante em que a cobrança foi preparada. Se a plataforma mudar o
 * percentual de comissão, `preco_servico - comissao_servico` passa a devolver um
 * número diferente do que foi de fato rateado. O que o profissional precisa ver
 * é o valor real do repasse dele, não uma reconstrução.
 *
 * ATENÇÃO: hoje esta seção sempre cai no estado vazio. `preparar_cobranca_order`
 * é exclusiva de `service_role` e não há consumidor que a chame — o gateway não
 * está conectado e `asaas_payments` está desligada. Isto está pronto para quando
 * o Asaas entrar; não é funcionalidade em uso.
 */
export async function Repasses({ inicio, fim }: { inicio: string; fim: string }) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("payment_allocations")
    .select("id, amount, created_at, allocation_type, payment_charges!inner(status, received_at, order_id)")
    .eq("allocation_type", "professional_payable")
    .gte("created_at", inicio)
    .lt("created_at", fim)
    .order("created_at", { ascending: false });

  type Linha = {
    id: string; amount: number; created_at: string;
    payment_charges: { status: string; received_at: string | null; order_id: string } | null;
  };
  const linhas = (data ?? []) as unknown as Linha[];

  if (linhas.length === 0) {
    return (
      <Alert tipo="info">
        O repasse automático pela plataforma ainda não está ativo. Enquanto isso,
        o acerto é feito diretamente com o cliente — os valores acima refletem o
        que foi combinado em cada serviço.
      </Alert>
    );
  }

  /* Liquidado é o único estado em que o dinheiro existe. "Confirmado" significa
     que o pagador autorizou, não que caiu — somar os dois num total só faria o
     profissional contar com um valor que ainda pode falhar. */
  const liquidado = linhas
    .filter((l) => l.payment_charges?.status === "received")
    .reduce((s, l) => s + Number(l.amount), 0);
  const pendente = linhas
    .filter((l) => l.payment_charges && ["pending_creation", "pending", "confirmed", "overdue"].includes(l.payment_charges.status))
    .reduce((s, l) => s + Number(l.amount), 0);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <Resumo rotulo="Repassado a você" valor={liquidado} tom="var(--good)" />
        <Resumo rotulo="Aguardando liquidação" valor={pendente} tom="var(--warning)" />
      </div>

      <div style={{ display: "grid", gap: 2 }}>
        {linhas.map((l) => {
          const e = resolver(STATUS_COBRANCA, l.payment_charges?.status);
          return (
            <div key={l.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line-soft)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>
                  Serviço {l.payment_charges?.order_id.slice(0, 8) ?? "—"}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>
                  {l.payment_charges?.received_at
                    ? `Liquidado em ${new Date(l.payment_charges.received_at).toLocaleDateString("pt-BR")}`
                    : `Gerado em ${new Date(l.created_at).toLocaleDateString("pt-BR")}`}
                </span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 100, background: e.bg, color: e.cor, whiteSpace: "nowrap" }}>
                  {e.label}
                </span>
                <strong style={{ fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{formatarBRL(Number(l.amount))}</strong>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: string }) {
  return (
    <div style={{ padding: "14px 16px", borderRadius: 12, background: "var(--surface-2)", borderLeft: `3px solid ${tom}` }}>
      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{rotulo}</div>
      <strong style={{ fontSize: "1.2rem", letterSpacing: "-0.02em" }}>{formatarBRL(valor)}</strong>
    </div>
  );
}

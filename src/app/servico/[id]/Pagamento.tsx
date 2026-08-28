import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { MEIO_COBRANCA, STATUS_COBRANCA, resolver } from "@/lib/status";
import { Alert } from "@/components/ui";
import { RetentarPagamento } from "./RetentarPagamento";

/* Pagamento do serviço, do ponto de vista do cliente.
 *
 * Lê `payment_status_cliente`, que é `security_invoker` sobre `payment_charges`
 * e portanto já recorta pela política `customer_id = auth.uid()`. A view existe
 * exatamente para não expor o rateio econômico nem o payload do gateway.
 *
 * Cobrança real ativada em produção (20260819180000_ativar_asaas_payments).
 * Se `preparar_cobranca_servico`/`asaas-cobrar-servico` falharem (CPF/CNPJ
 * ausente, gateway fora do ar), o cliente cai num dos dois estados "sem
 * cobrança usável" abaixo — <RetentarPagamento> dá a ele uma saída, em vez
 * de ficar travado vendo "Aguardando emissão" pra sempre (achado testando em
 * produção 24/08).
 */
export async function Pagamento({ orderId, total, jobId }: { orderId: string; total: number; jobId: string }) {
  const supabase = await createClient();

  const { data: cobranca } = await supabase
    .from("payment_status_cliente")
    .select("id, billing_type, amount, status, checkout_url, due_date, confirmed_at, received_at, refunded_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cobranca) {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <Alert tipo="info">
          Ainda não geramos a cobrança deste serviço pela plataforma — o
          valor acertado é <strong>{formatarBRL(total)}</strong>.
        </Alert>
        <RetentarPagamento jobId={jobId} orderId={orderId} />
      </div>
    );
  }

  /* A view não carrega os `not null` das colunas de origem — o Postgres não
     propaga essa informação através de uma view —, então o tipo gerado chega
     como anulável e o padrão precisa ser explícito. */
  const status = cobranca.status ?? "pending_creation";
  const e = resolver(STATUS_COBRANCA, status);
  const aberto = ["pending_creation", "pending", "overdue"].includes(status);
  const liquidado = status === "received";

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em" }}>
          {formatarBRL(Number(cobranca.amount))}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, padding: "5px 12px", borderRadius: 100, background: e.bg, color: e.cor }}>
          {e.label}
        </span>
      </div>

      <dl style={{ display: "grid", gap: 8, margin: 0, fontSize: 13.5 }}>
        <Par termo="Forma de pagamento" valor={MEIO_COBRANCA[cobranca.billing_type ?? "UNDEFINED"] ?? "A definir"} />
        {cobranca.due_date && (
          <Par termo="Vencimento" valor={new Date(`${cobranca.due_date}T12:00:00`).toLocaleDateString("pt-BR")} />
        )}
        {/* "Confirmado" e "recebido" são coisas diferentes e a tela não pode
            fundi-las: o cliente autorizar não é o dinheiro ter caído. */}
        {cobranca.confirmed_at && (
          <Par termo="Confirmado em" valor={new Date(cobranca.confirmed_at).toLocaleString("pt-BR")} />
        )}
        {cobranca.received_at && (
          <Par termo="Liquidado em" valor={new Date(cobranca.received_at).toLocaleString("pt-BR")} />
        )}
        {cobranca.refunded_at && (
          <Par termo="Reembolsado em" valor={new Date(cobranca.refunded_at).toLocaleString("pt-BR")} />
        )}
      </dl>

      {/* Só oferece o link enquanto ele resolve alguma coisa. Botão de pagar
          numa cobrança já liquidada é convite a pagar duas vezes. */}
      {aberto && cobranca.checkout_url && (
        <a href={cobranca.checkout_url} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ justifySelf: "start" }}>
          Pagar agora
        </a>
      )}

      {/* Preparamos a cobrança localmente, mas o gateway ainda não devolveu
          um link — a chamada ao Asaas falhou ou nunca foi feita. Sem isto o
          cliente ficava vendo "Aguardando emissão" pra sempre. */}
      {aberto && !cobranca.checkout_url && (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
            Ainda não conseguimos gerar o link de pagamento.
          </p>
          <RetentarPagamento jobId={jobId} orderId={orderId} />
        </div>
      )}

      {liquidado && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
          Pagamento liquidado. O comprovante oficial é o do meio de pagamento
          utilizado.
        </p>
      )}
    </div>
  );
}

function Par({ termo, valor }: { termo: string; valor: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: "1px solid var(--line-soft)", paddingBottom: 7 }}>
      <dt style={{ color: "var(--ink-soft)" }}>{termo}</dt>
      <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{valor}</dd>
    </div>
  );
}

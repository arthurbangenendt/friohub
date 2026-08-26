import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { STATUS_REPASSE, STATUS_TRANSFERENCIA, resolverMapa, resolver } from "@/lib/status";
import { LinhaTempoEntrega, type EventoEntrega } from "@/components/LinhaTempoEntrega";
import { AcoesRepasse } from "@/app/painel/distribuidora/pedidos/AcoesRepasse";
import { TransferenciaActions } from "./TransferenciaActions";
import { EmptyState } from "@/components/ui";
import { one } from "@/lib/relacional";

/* Duas filas de repasse, naturezas diferentes:
 *
 * 1. Entregas a distribuidoras (mercadoria) — sem RPC nova, reaproveita
 *    `avancar_purchase_order` (já autoriza `eh_admin()`, 20260818130000) e o
 *    MESMO componente que a distribuidora usa, num dado que enxerga todas
 *    (view `entregas_cliente`, admin-readable desde a Frente 0).
 *
 * 2. Repasses financeiros via Asaas (`payment_transfers`) — dinheiro real.
 *    Só `service_role` mexia nisso até 20260826092000_admin_intervir_repasse:
 *    reenviar (failed -> pending_creation) e cancelar (pending_creation/failed
 *    -> cancelled) são as únicas ações, cada uma só no estado onde é seguro —
 *    o guarda-corpo mora na RPC, a tela só espelha o que ela permite.
 *
 * Só o que está em aberto nas duas — a fila é pra destravar atendimento
 * parado, não pra ser um histórico completo.
 */

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const STATUS = resolverMapa(STATUS_REPASSE);
const ABERTOS = ["a_repassar", "confirmado", "faturado", "enviado"];

type ItemEntrega = {
  ambiente: string; quantidade: number; marca: string | null; modelo: string | null;
  btu: number | null; preco_venda_snapshot: number; image_url: string | null;
};

type EntregaRow = {
  id: string;
  order_id: string;
  job_id: string;
  status: string;
  codigo_rastreio: string | null;
  link_rastreio: string | null;
  nota_fiscal_url: string | null;
  prazo_previsto: string | null;
  created_at: string;
  distributor_id: string;
  distribuidora: string;
  itens: ItemEntrega[];
  eventos: EventoEntrega[];
};

export default async function AdminRepassesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  const { data } = await supabase
    .from("entregas_cliente")
    .select("id, order_id, job_id, status, codigo_rastreio, link_rastreio, nota_fiscal_url, prazo_previsto, created_at, distributor_id, distribuidora, itens, eventos")
    .in("status", ABERTOS)
    .order("created_at", { ascending: true });

  const linhas = (data ?? []) as unknown as EntregaRow[];

  // Nome do cliente em lote — a view não traz isso, só job_id.
  const jobIds = [...new Set(linhas.map((l) => l.job_id))];
  const { data: jobsData } = jobIds.length
    ? await supabase.from("jobs").select("id, cliente:profiles!jobs_cliente_id_fkey ( nome )").in("id", jobIds)
    : { data: [] };
  const clienteNomePorJob = new Map(
    (jobsData ?? []).map((j) => [j.id, (one(j.cliente) as { nome: string } | null)?.nome ?? "Cliente"]),
  );

  const { data: transfersData } = await supabase
    .from("payment_transfers")
    .select("id, job_id, beneficiary_id, amount, status, scheduled_for, last_error, contestado_em, requested_at")
    .not("status", "in", "(confirmed,cancelled)")
    .order("requested_at", { ascending: true });

  const transferencias = (transfersData ?? []) as TransferenciaRow[];

  const beneficiarioIds = [...new Set(transferencias.map((t) => t.beneficiary_id))];
  const { data: beneficiariosData } = beneficiarioIds.length
    ? await supabase.from("profiles").select("id, nome").in("id", beneficiarioIds)
    : { data: [] };
  const nomePorBeneficiario = new Map((beneficiariosData ?? []).map((b) => [b.id, b.nome]));

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Repasses</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 24px" }}>
        Entregas de aparelho em aberto, mais antigas primeiro. Avançar ou cancelar aqui é a mesma ação
        que a distribuidora tem — o banco valida a transição final.
      </p>

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 12px" }}>Entregas a distribuidoras ({linhas.length})</h2>
      {linhas.length === 0 ? (
        <EmptyState titulo="Nenhuma entrega em aberto" descricao="Toda entrega de aparelho está confirmada, faturada, enviada ou já concluída." />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {linhas.map((l) => <CardEntrega key={l.id} l={l} clienteNome={clienteNomePorJob.get(l.job_id) ?? "Cliente"} />)}
        </div>
      )}

      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "36px 0 12px" }}>Repasses financeiros ({transferencias.length})</h2>
      <p style={{ color: "var(--ink-faint)", fontSize: 13, margin: "-6px 0 14px" }}>
        Dinheiro real via Asaas. “Reenviar” só existe pra quem falhou, “cancelar” nunca em quem já
        pode estar em voo no gateway ou confirmado — o banco recusa fora dessas condições.
      </p>
      {transferencias.length === 0 ? (
        <EmptyState titulo="Nenhum repasse financeiro travado" descricao="Tudo que não está confirmado nem cancelado apareceria aqui." />
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {transferencias.map((t) => (
            <CardTransferencia key={t.id} t={t} beneficiarioNome={nomePorBeneficiario.get(t.beneficiary_id) ?? "—"} />
          ))}
        </div>
      )}
    </main>
  );
}

type TransferenciaRow = {
  id: string;
  job_id: string;
  beneficiary_id: string;
  amount: number;
  status: string;
  scheduled_for: string;
  last_error: string | null;
  contestado_em: string | null;
  requested_at: string;
};

function CardTransferencia({ t, beneficiarioNome }: { t: TransferenciaRow; beneficiarioNome: string }) {
  const st = resolver(STATUS_TRANSFERENCIA, t.status);
  return (
    <div className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{formatarBRL(Number(t.amount))}</strong>
          <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>
            {st.label}
          </span>
          {t.contestado_em && (
            <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: "var(--warm-wash)", color: "var(--warm)" }}>
              Contestado
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          Para {beneficiarioNome} · <Link href={`/servico/${t.job_id}`} style={{ color: "var(--cool)" }}>ver serviço →</Link>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
          Solicitado em {new Date(t.requested_at).toLocaleString("pt-BR")}
          {` · previsto para ${new Date(t.scheduled_for).toLocaleString("pt-BR")}`}
        </div>
        {t.last_error && (
          <p style={{ fontSize: 13, color: "var(--danger)", margin: "8px 0 0" }}>{t.last_error}</p>
        )}
      </div>
      <TransferenciaActions id={t.id} status={t.status} />
    </div>
  );
}

function CardEntrega({ l, clienteNome }: { l: EntregaRow; clienteNome: string }) {
  const st = STATUS[l.status] ?? STATUS.a_repassar;
  const itens = l.itens ?? [];

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15.5 }}>
              {itens.length > 1 ? `${itens.length} aparelhos` : (itens[0] ? `${itens[0].marca} — ${itens[0].btu ? formatarBtu(itens[0].btu) : itens[0].modelo}` : "Aparelho")}
            </strong>
            <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>
              {st.label}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
            {clienteNome} · via {l.distribuidora}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
            Pedido em {new Date(l.created_at).toLocaleDateString("pt-BR")}
            {l.prazo_previsto && ` · prazo ${new Date(`${l.prazo_previsto}T12:00:00`).toLocaleDateString("pt-BR")}`}
            {l.link_rastreio && (
              <> · <a href={l.link_rastreio} target="_blank" rel="noopener noreferrer">{l.codigo_rastreio ?? "rastreio"} →</a></>
            )}
          </div>
        </div>
      </div>

      {itens.length > 0 && (
        <div style={{ display: "grid", gap: 10, marginTop: 16 }}>
          {itens.map((it, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center" }}>
              {it.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.image_url}
                  alt={`${it.marca ?? ""} ${it.modelo ?? ""}`}
                  style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", border: "1px solid var(--line)", flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: 10, background: "var(--surface-2)", flexShrink: 0 }} />
              )}
              <div style={{ fontSize: 13.5 }}>
                <strong>{it.ambiente ? `${it.ambiente}: ` : ""}{it.marca} {it.modelo}</strong>
                <div style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 2 }}>
                  {[it.btu ? formatarBtu(it.btu) : null, it.quantidade > 1 ? `${it.quantidade}x` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <LinhaTempoEntrega status={l.status} eventos={l.eventos} />
      </div>

      <AcoesRepasse id={l.id} status={l.status} />
    </div>
  );
}

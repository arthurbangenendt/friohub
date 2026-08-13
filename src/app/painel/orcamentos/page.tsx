import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rotuloJob } from "@/app/solicitar/tipos";
import { Cabecalho, dataCurta, mono, wrap } from "../shared";
import { comoPapel } from "../navegacao";

/* Orçamentos, dos dois lados.
   Cliente: os pedidos que enviou e quantas propostas voltaram.
   Profissional: os pedidos que chegaram até ele e o que já respondeu. */

const STATUS_PEDIDO: Record<string, { label: string; cor: string; bg: string }> = {
  aberto: { label: "Aguardando propostas", cor: "var(--warm)", bg: "var(--warm-wash)" },
  fechado: { label: "Fechado", cor: "#2E8B6F", bg: "#e4f3ee" },
  cancelado: { label: "Cancelado", cor: "#b3261e", bg: "#fdeceb" },
  expirado: { label: "Expirado", cor: "var(--ink-faint)", bg: "var(--surface-2)" },
};

type PedidoBase = {
  id: string;
  job_type: string;
  status: string;
  created_at: string;
  bairro: string | null;
  cep: string;
  quantidade: number;
};

export default async function OrcamentosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const isPro = comoPapel(profile?.role) === "profissional";

  if (isPro) return <ListaProfissional userId={user.id} />;
  return <ListaCliente userId={user.id} />;
}

/* ---------------------------------------------------------------- CLIENTE */
async function ListaCliente({ userId }: { userId: string }) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("quote_requests")
    .select("id, job_type, status, created_at, bairro, cep, quantidade, quotes ( id, status )")
    .eq("cliente_id", userId)
    .order("created_at", { ascending: false });

  const pedidos = (data ?? []) as (PedidoBase & { quotes: { id: string; status: string }[] })[];

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Orçamentos" titulo="Seus pedidos de orçamento" />

      <Link href="/solicitar" className="btn btn-primary" style={{ marginTop: 22, height: 42, padding: "0 18px" }}>
        Pedir novo orçamento
      </Link>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        {pedidos.length === 0 && <Vazio texto="Você ainda não pediu nenhum orçamento." />}

        {pedidos.map((p) => {
          const recebidas = p.quotes.filter((q) => q.status === "enviada" || q.status === "aceita").length;
          return (
            <Cartao key={p.id} pedido={p}>
              <span style={{ fontSize: 13, color: recebidas > 0 ? "var(--cool-deep)" : "var(--ink-faint)", fontWeight: recebidas > 0 ? 650 : 400 }}>
                {recebidas === 0
                  ? "Nenhuma proposta ainda"
                  : `${recebidas} ${recebidas === 1 ? "proposta recebida" : "propostas recebidas"}`}
              </span>
            </Cartao>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- PROFISSIONAL */
async function ListaProfissional({ userId }: { userId: string }) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("quote_request_targets")
    .select(`recusado_em, enviado_em,
             pedido:quote_requests ( id, job_type, status, created_at, bairro, cep, quantidade )`)
    .eq("professional_id", userId)
    .order("enviado_em", { ascending: false });

  const linhas = (data ?? []) as { recusado_em: string | null; pedido: PedidoBase | PedidoBase[] | null }[];

  // Uma consulta para saber em quais eu já respondi, em vez de uma por pedido.
  const { data: minhas } = await supabase
    .from("quotes")
    .select("quote_request_id, status")
    .eq("professional_id", userId);
  const jaRespondi = new Map((minhas ?? []).map((q) => [(q as { quote_request_id: string }).quote_request_id, (q as { status: string }).status]));

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Orçamentos" titulo="Pedidos que chegaram para você" />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        {linhas.length === 0 && (
          <Vazio texto="Nenhum pedido de orçamento ainda. Quando um cliente da sua região pedir, aparece aqui." />
        )}

        {linhas.map((l) => {
          const p = Array.isArray(l.pedido) ? l.pedido[0] : l.pedido;
          if (!p) return null;
          const meuStatus = jaRespondi.get(p.id);
          return (
            <Cartao key={p.id} pedido={p}>
              <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>
                {l.recusado_em
                  ? "Você recusou"
                  : meuStatus === "aceita"
                    ? "✅ Sua proposta foi aceita"
                    : meuStatus === "recusada"
                      ? "Não foi desta vez"
                      : meuStatus
                        ? "Proposta enviada"
                        : "⏳ Aguardando sua proposta"}
              </span>
            </Cartao>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ compartilhado */
function Cartao({ pedido, children }: { pedido: PedidoBase; children: React.ReactNode }) {
  const st = STATUS_PEDIDO[pedido.status] ?? STATUS_PEDIDO.aberto;
  return (
    <Link
      href={`/painel/orcamentos/${pedido.id}`}
      style={{
        display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 14,
        background: "var(--surface)", border: "1px solid var(--line)", color: "inherit", textDecoration: "none",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{rotuloJob(pedido.job_type)}</strong>
          {pedido.quantidade > 1 && (
            <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{pedido.quantidade} aparelhos</span>
          )}
          <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>
            {st.label}
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          {pedido.bairro ? `${pedido.bairro} · ` : ""}{pedido.cep} · {dataCurta(pedido.created_at)}
        </div>
        <div style={{ marginTop: 6 }}>{children}</div>
      </div>
    </Link>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div style={{ padding: 28, borderRadius: 14, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14.5, textAlign: "center" }}>
      {texto}
    </div>
  );
}

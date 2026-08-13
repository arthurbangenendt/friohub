import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { Cabecalho, dataCurta, mono, one, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { AcoesRepasse } from "./AcoesRepasse";

const STATUS: Record<string, { label: string; cor: string; bg: string }> = {
  a_repassar: { label: "A repassar", cor: "var(--warm)", bg: "var(--warm-wash)" },
  confirmado: { label: "Confirmado", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  faturado: { label: "Faturado", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  enviado: { label: "Enviado", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  entregue: { label: "Entregue", cor: "#2E8B6F", bg: "#e4f3ee" },
  cancelado: { label: "Cancelado", cor: "#b3261e", bg: "#fdeceb" },
};

const ABERTOS = ["a_repassar", "confirmado", "faturado", "enviado"];

export default async function PedidosDistribuidoraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  /* O endereço de entrega vem do job, embutido pela FK order → job. A
     distribuidora precisa dele para despachar; é justamente por isso que o
     endereço completo só é coletado no aceite da proposta. */
  const { data } = await supabase
    .from("purchase_orders")
    .select(`id, status, custo_snapshot, codigo_rastreio, prazo_previsto, created_at,
             order:orders ( job:jobs ( id, cep, endereco, cidade,
                                       produto:products ( marca, modelo, btu ),
                                       cliente:profiles!jobs_cliente_id_fkey ( nome ) ) )`)
    .eq("distributor_id", user.id)
    .order("created_at", { ascending: false });

  type Linha = {
    id: string; status: string; custo_snapshot: number;
    codigo_rastreio: string | null; prazo_previsto: string | null; created_at: string;
    order: unknown;
  };

  const linhas = (data ?? []) as Linha[];
  const abertos = linhas.filter((l) => ABERTOS.includes(l.status));
  const fechados = linhas.filter((l) => !ABERTOS.includes(l.status));

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Pedidos" titulo="Repasses" />

      <Secao titulo={`Em aberto (${abertos.length})`}>
        {abertos.length === 0
          ? <Vazio texto="Nenhum pedido aguardando você." />
          : abertos.map((l) => <Card key={l.id} l={l} />)}
      </Secao>

      <Secao titulo={`Encerrados (${fechados.length})`}>
        {fechados.length === 0
          ? <Vazio texto="Nada encerrado ainda." />
          : fechados.map((l) => <Card key={l.id} l={l} />)}
      </Secao>
    </div>
  );
}

function Card({ l }: { l: { id: string; status: string; custo_snapshot: number; codigo_rastreio: string | null; prazo_previsto: string | null; created_at: string; order: unknown } }) {
  const order = one(l.order) as { job: unknown } | null;
  const job = one(order?.job) as {
    id: string; cep: string; endereco: string | null; cidade: string;
    produto: unknown; cliente: unknown;
  } | null;
  const produto = one(job?.produto) as { marca: string; modelo: string; btu: number } | null;
  const cliente = one(job?.cliente) as { nome: string } | null;
  const st = STATUS[l.status] ?? STATUS.a_repassar;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15.5 }}>{produto ? `${produto.marca} — ${formatarBtu(produto.btu)}` : "Aparelho"}</strong>
            <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: st.bg, color: st.cor }}>
              {st.label}
            </span>
          </div>
          {produto && <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 3 }}>{produto.modelo}</div>}
          <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 6 }}>
            {cliente?.nome ?? "Cliente"} · {job?.endereco ?? "endereço não informado"} · {job?.cep}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
            Pedido em {dataCurta(l.created_at)}
            {l.prazo_previsto && ` · prazo ${new Date(`${l.prazo_previsto}T12:00:00`).toLocaleDateString("pt-BR")}`}
            {l.codigo_rastreio && ` · rastreio ${l.codigo_rastreio}`}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Você recebe</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{formatarBRL(Number(l.custo_snapshot))}</div>
        </div>
      </div>

      <AcoesRepasse id={l.id} status={l.status} />
    </div>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>{titulo}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}
function Vazio({ texto }: { texto: string }) {
  return (
    <div style={{ padding: 22, borderRadius: 12, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14, textAlign: "center" }}>
      {texto}
    </div>
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { Cabecalho, dataCurta, mono, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { AcoesRepasse } from "./AcoesRepasse";
import { LinhaTempoEntrega, type EventoEntrega } from "@/components/LinhaTempoEntrega";
import { STATUS_REPASSE, resolverMapa } from "@/lib/status";

const STATUS = resolverMapa(STATUS_REPASSE);

const ABERTOS = ["a_repassar", "confirmado", "faturado", "enviado"];

type ItemPedido = {
  ambiente: string;
  quantidade: number;
  marca: string | null;
  modelo: string | null;
  btu: number | null;
  preco_venda_snapshot: number;
  custo_snapshot: number;
  image_url: string | null;
};

export default async function PedidosDistribuidoraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  /* Antes esta query fazia embed `purchase_orders → orders → jobs`, mas nem
     `orders` nem `jobs` liberam RLS para distribuidora — o embed sempre
     voltava null, e a tela nunca mostrou endereço real (só o fallback
     "endereço não informado"). `pedidos_distribuidora` (ver
     20260818101000_pedidos_distribuidora) resolve isso projetando só o
     necessário para despachar, rodando como dona da view. */
  const { data } = await supabase
    .from("pedidos_distribuidora")
    .select("id, status, custo_snapshot, codigo_rastreio, link_rastreio, prazo_previsto, created_at, cep, endereco, cidade, cliente_nome, itens, eventos")
    .order("created_at", { ascending: false });

  type Linha = {
    id: string; status: string; custo_snapshot: number;
    codigo_rastreio: string | null; link_rastreio: string | null; prazo_previsto: string | null; created_at: string;
    cep: string | null; endereco: string | null; cidade: string | null;
    cliente_nome: string | null; itens: ItemPedido[]; eventos: EventoEntrega[];
  };

  const linhas = (data ?? []) as unknown as Linha[];
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

function Card({ l }: { l: { id: string; status: string; custo_snapshot: number; codigo_rastreio: string | null; link_rastreio: string | null; prazo_previsto: string | null; created_at: string; cep: string | null; endereco: string | null; cidade: string | null; cliente_nome: string | null; itens: ItemPedido[]; eventos: EventoEntrega[] } }) {
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
          {itens.length > 0 && (
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              {itens.map((it, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-soft)" }}>
                  {it.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.image_url}
                      alt={`${it.marca ?? ""} ${it.modelo ?? ""}`}
                      style={{ width: 34, height: 34, borderRadius: 7, objectFit: "cover", border: "1px solid var(--line)", flexShrink: 0 }}
                    />
                  ) : null}
                  <span>
                    {it.ambiente ? `${it.ambiente}: ` : ""}{it.marca} {it.modelo}
                    {it.btu ? ` · ${formatarBtu(it.btu)}` : ""}
                    {it.quantidade > 1 ? ` · ${it.quantidade}x` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 6 }}>
            {l.cliente_nome ?? "Cliente"} · {l.endereco ?? "endereço não informado"} · {l.cep}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
            Pedido em {dataCurta(l.created_at)}
            {l.prazo_previsto && ` · prazo ${new Date(`${l.prazo_previsto}T12:00:00`).toLocaleDateString("pt-BR")}`}
            {l.link_rastreio && (
              <> · <a href={l.link_rastreio} target="_blank" rel="noopener noreferrer">{l.codigo_rastreio ?? "rastreio"} →</a></>
            )}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Você recebe</div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>{formatarBRL(Number(l.custo_snapshot))}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <LinhaTempoEntrega status={l.status} eventos={l.eventos} />
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { STATUS_ENTREGA_CLIENTE, resolverMapa } from "@/lib/status";
import { LinhaTempoEntrega, type EventoEntrega } from "@/components/LinhaTempoEntrega";

const mono = "var(--font-geist-mono), ui-monospace, monospace";
const STATUS = resolverMapa(STATUS_ENTREGA_CLIENTE);

type ItemEntrega = {
  ambiente: string;
  quantidade: number;
  marca: string | null;
  modelo: string | null;
  btu: number | null;
  preco_venda_snapshot: number;
};

type EntregaView = {
  id: string;
  distribuidora: string;
  status: string;
  codigo_rastreio: string | null;
  link_rastreio: string | null;
  nota_fiscal_url: string | null;
  prazo_previsto: string | null;
  created_at: string;
  itens: ItemEntrega[];
  eventos: EventoEntrega[];
};

/* Item cujo produto ficou sem distribuidora atribuída — não gera repasse, e
   por isso nunca aparece em `entregas_cliente`. Raro (produto removido do
   catálogo depois do aceite), mas some da conta se não for listado à parte. */
type ItemSemEntrega = { ambiente: string; quantidade: number; marca: string; modelo: string; btu: number | null; preco_venda_snapshot: number };

export default async function AparelhoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: job } = await supabase
    .from("jobs")
    .select("id, cliente_id, profissional_id, job_type")
    .eq("id", id)
    .maybeSingle();

  if (!job) redirect("/painel");
  const isCliente = job.cliente_id === user.id;
  const isPro = job.profissional_id === user.id;
  if (!isCliente && !isPro) redirect(`/servico/${id}`);

  const { data: entregasData } = await supabase
    .from("entregas_cliente")
    .select("id, distribuidora, status, codigo_rastreio, link_rastreio, nota_fiscal_url, prazo_previsto, created_at, itens, eventos")
    .eq("job_id", id)
    .order("created_at", { ascending: true });

  const entregas = (entregasData ?? []) as unknown as EntregaView[];

  const { data: itensOrfaos } = await supabase
    .from("job_itens")
    .select("ambiente, quantidade, preco_venda_snapshot, produto:products ( marca, modelo, btu )")
    .eq("job_id", id)
    .is("distributor_id", null)
    .not("produto_id", "is", null);

  const semEntrega = ((itensOrfaos ?? []) as unknown as { ambiente: string; quantidade: number; preco_venda_snapshot: number; produto: { marca: string; modelo: string; btu: number | null } | { marca: string; modelo: string; btu: number | null }[] | null }[])
    .map((i) => {
      const p = Array.isArray(i.produto) ? i.produto[0] : i.produto;
      return { ambiente: i.ambiente, quantidade: i.quantidade, marca: p?.marca ?? "Aparelho", modelo: p?.modelo ?? "", btu: p?.btu ?? null, preco_venda_snapshot: i.preco_venda_snapshot };
    }) as ItemSemEntrega[];

  const totalAparelhos =
    entregas.reduce((s, e) => s + e.itens.reduce((s2, it) => s2 + Number(it.preco_venda_snapshot), 0), 0) +
    semEntrega.reduce((s, i) => s + Number(i.preco_venda_snapshot), 0);

  if (entregas.length === 0 && semEntrega.length === 0) {
    return (
      <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
        <Link href={`/servico/${id}`} style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Voltar ao serviço</Link>
        <h1 style={{ margin: "20px 0 5px" }}>Aparelho</h1>
        <p style={{ color: "var(--ink-soft)" }}>Este serviço não tem aparelho comprado pela plataforma.</p>
      </main>
    );
  }

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href={`/servico/${id}`} style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>← Voltar ao serviço</Link>
      <h1 style={{ margin: "20px 0 5px" }}>Aparelho</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 24 }}>
        O aparelho é vendido e entregue pela distribuidora — separado do serviço do profissional.
      </p>

      <div style={{ display: "grid", gap: 16 }}>
        {entregas.map((e) => {
          const st = STATUS[e.status] ?? STATUS.a_repassar;
          return (
            <div key={e.id} className="card" style={{ padding: 22 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <SecTitle>{e.distribuidora}</SecTitle>
                <span style={{ fontSize: 12.5, fontFamily: mono, padding: "5px 12px", borderRadius: 100, background: st.bg, color: st.cor }}>
                  {st.label}
                </span>
              </div>

              <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
                {e.itens.map((it, i) => (
                  <Linha
                    key={i}
                    k={`${it.marca ?? ""} ${it.modelo ?? ""}${it.btu ? ` · ${formatarBtu(it.btu)}` : ""}${it.quantidade > 1 ? ` · ${it.quantidade}x` : ""}`}
                    v={formatarBRL(Number(it.preco_venda_snapshot))}
                  />
                ))}
                {e.prazo_previsto && (
                  <Linha k="Previsão" v={new Date(`${e.prazo_previsto}T12:00:00`).toLocaleDateString("pt-BR")} />
                )}
                {e.link_rastreio && (
                  <Linha k="Rastreio" v={<a href={e.link_rastreio} target="_blank" rel="noopener noreferrer">{e.codigo_rastreio ?? "Acompanhar entrega"} →</a>} />
                )}
                {e.nota_fiscal_url && (
                  <Linha k="Nota fiscal" v={<a href={e.nota_fiscal_url} target="_blank" rel="noopener noreferrer">Ver nota fiscal</a>} />
                )}
              </div>

              <LinhaTempoEntrega status={e.status} eventos={e.eventos} />
            </div>
          );
        })}

        {semEntrega.length > 0 && (
          <div className="card" style={{ padding: 22 }}>
            <SecTitle>Sem distribuidora atribuída</SecTitle>
            <div style={{ display: "grid", gap: 8 }}>
              {semEntrega.map((it, i) => (
                <Linha
                  key={i}
                  k={`${it.marca} ${it.modelo}${it.btu ? ` · ${formatarBtu(it.btu)}` : ""}${it.quantidade > 1 ? ` · ${it.quantidade}x` : ""}`}
                  v={formatarBRL(Number(it.preco_venda_snapshot))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 22 }}>
          <Linha k={<strong>Total dos aparelhos</strong>} v={<strong>{formatarBRL(totalAparelhos)}</strong>} />
        </div>
      </div>
    </main>
  );
}

function SecTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)" }}>{children}</div>;
}
function Linha({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0", fontSize: 14.5, borderBottom: "1px solid var(--line-soft)" }}>
      <span style={{ color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

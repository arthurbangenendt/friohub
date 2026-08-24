import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { Cabecalho, Kpi, wrap } from "../shared";
import { comoPapel } from "../navegacao";

/* Visão geral da distribuidora: o que precisa de ação hoje e quanto já saiu.
   O faturamento aqui é o CUSTO (o que a distribuidora recebe da FrioHub), não o
   preço final ao cliente — a margem da plataforma não é assunto dela. */

const PENDENTES = ["a_repassar", "confirmado", "faturado"];

export default async function DistribuidoraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("nome, role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  const { data: dist } = await supabase
    .from("distributors")
    .select("razao_social, verification_status, ativo")
    .eq("id", user.id)
    .maybeSingle();

  const { data: pedidos } = await supabase
    .from("purchase_orders")
    .select("id, status, custo_snapshot, created_at")
    .eq("distributor_id", user.id);

  const linhas = (pedidos ?? []) as { id: string; status: string; custo_snapshot: number; created_at: string }[];
  const aRepassar = linhas.filter((p) => p.status === "a_repassar").length;
  const emAndamento = linhas.filter((p) => PENDENTES.includes(p.status)).length;
  const entregues = linhas.filter((p) => p.status === "entregue");
  const faturado = entregues.reduce((s, p) => s + Number(p.custo_snapshot ?? 0), 0);

  const { count: produtos } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("distributor_id", user.id);

  const { count: semEstoque } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("distributor_id", user.id)
    .eq("estoque_disponivel", false);

  // Mesmo selo mostrado pro cliente no catálogo — aqui como KPI de
  // acompanhamento, sem precisar de tela nova.
  const { data: repRows } = await supabase.rpc("reputacao_distribuidora", { p_distributor_id: user.id });
  const reputacao = Array.isArray(repRows) ? repRows[0] : null;

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Painel da distribuidora" titulo={`Olá, ${dist?.razao_social ?? profile?.nome ?? "você"}`} />

      {/* Sem cadastro completo, nenhum produto aparece na busca do cliente. É a
          primeira coisa que a pessoa precisa saber ao entrar. */}
      {!dist && (
        <Aviso
          titulo="Complete seu cadastro"
          texto="Informe razão social, CNPJ e prazo de entrega para começar a publicar produtos."
          href="/painel/distribuidora/perfil"
          cta="Completar cadastro"
        />
      )}
      {dist && dist.verification_status !== "verificado" && (
        <Aviso
          titulo="Cadastro em análise"
          texto="Seus produtos ficam visíveis para os clientes assim que nossa equipe aprovar o cadastro."
        />
      )}
      {dist?.verification_status === "verificado" && !dist.ativo && (
        <Aviso
          titulo="Conta verificada, mas inativa"
          texto="Fale com nossa equipe para ativar a operação e voltar a aparecer no catálogo."
        />
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginTop: 24 }}>
        <Kpi label="A repassar" valor={String(aRepassar)} sufixo="aguardando você" />
        <Kpi label="Em andamento" valor={String(emAndamento)} />
        <Kpi label="Entregues" valor={String(entregues.length)} />
        <Kpi label="Faturado" valor={formatarBRL(faturado)} sufixo="pedidos entregues" />
        {reputacao && reputacao.total_entregues >= 5 && reputacao.taxa_no_prazo !== null && (
          <Kpi label="No prazo" valor={`${reputacao.taxa_no_prazo}%`} sufixo="últimas entregas" />
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))", gap: 12, marginTop: 16 }}>
        <Atalho
          href="/painel/distribuidora/pedidos"
          titulo={aRepassar > 0 ? `${aRepassar} pedido(s) para repassar` : "Pedidos"}
          desc="Confirmar, faturar e informar rastreio."
          destaque={aRepassar > 0}
        />
        <Atalho
          href="/painel/distribuidora/catalogo"
          titulo={`Catálogo · ${produtos ?? 0} produto(s)`}
          desc={semEstoque ? `${semEstoque} sem estoque, fora da busca.` : "Preço, estoque e novos modelos."}
          destaque={(semEstoque ?? 0) > 0}
        />
      </div>
    </div>
  );
}

function Aviso({ titulo, texto, href, cta }: { titulo: string; texto: string; href?: string; cta?: string }) {
  return (
    <div style={{ marginTop: 20, padding: "20px 22px", borderRadius: 14, background: "var(--warm-wash)" }}>
      <strong style={{ color: "var(--ink)" }}>{titulo}</strong>
      <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--ink-soft)" }}>{texto}</p>
      {href && cta && (
        <Link href={href} className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14, marginTop: 14 }}>
          {cta}
        </Link>
      )}
    </div>
  );
}

function Atalho({ href, titulo, desc, destaque }: { href: string; titulo: string; desc: string; destaque?: boolean }) {
  return (
    <Link
      href={href}
      style={{
        display: "block", padding: "20px 22px", borderRadius: 16, textDecoration: "none",
        background: destaque ? "var(--cool)" : "var(--surface)",
        color: destaque ? "#fff" : "inherit",
        border: destaque ? "none" : "1px solid var(--line)",
      }}
    >
      <div style={{ fontSize: "1.05rem", fontWeight: 700 }}>{titulo}</div>
      <div style={{ fontSize: 13.5, opacity: destaque ? 0.9 : 0.7, marginTop: 3 }}>{desc}</div>
    </Link>
  );
}

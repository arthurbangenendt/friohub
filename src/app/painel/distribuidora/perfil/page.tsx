import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
import { Cabecalho, mono, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { PerfilDistribuidoraForm } from "./PerfilDistribuidoraForm";

const STATUS: Record<string, { label: string; cor: string; bg: string }> = {
  pendente: { label: "Pendente", cor: "var(--warm)", bg: "var(--warm-wash)" },
  em_analise: { label: "Em análise", cor: "var(--warm)", bg: "var(--warm-wash)" },
  verificado: { label: "Verificado", cor: "#2E8B6F", bg: "#e4f3ee" },
  rejeitado: { label: "Rejeitado", cor: "#b3261e", bg: "#fdeceb" },
};

export default async function PerfilDistribuidoraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  const { data: dist } = await supabase
    .from("distributors")
    .select("razao_social, cnpj, cidade, prazo_entrega_dias, verification_status, ativo")
    .eq("id", user.id)
    .maybeSingle();

  const { data: areas } = await supabase
    .from("distributor_areas")
    .select("uf")
    .eq("distributor_id", user.id);

  const st = STATUS[dist?.verification_status ?? "pendente"] ?? STATUS.pendente;

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Perfil" titulo="Dados da distribuidora" />

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "16px 0 26px", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontFamily: mono, padding: "5px 11px", borderRadius: 100, background: st.bg, color: st.cor }}>
          {st.label}
        </span>
        <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>
          {dist?.verification_status === "verificado" && dist.ativo
            ? "Seus produtos estão visíveis no catálogo."
            : "Seus produtos só aparecem para os clientes depois da aprovação."}
        </span>
      </div>

      <PerfilDistribuidoraForm
        inicial={{
          razaoSocial: dist?.razao_social ?? "",
          cnpj: dist?.cnpj ?? "",
          cidade: dist?.cidade ?? CIDADE,
          prazoEntregaDias: dist?.prazo_entrega_dias ?? 5,
          ufs: (areas ?? []).map((a) => (a as { uf: string }).uf),
        }}
      />
    </div>
  );
}

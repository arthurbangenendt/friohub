import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CIDADE } from "@/lib/regiao";
import { Cabecalho, mono, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { MidiaEditor } from "../../MidiaEditor";
import { PerfilDistribuidoraForm } from "./PerfilDistribuidoraForm";
import { ConfigRepasseForm } from "./ConfigRepasseForm";
import { STATUS_VERIFICACAO, resolverMapa } from "@/lib/status";

const STATUS = resolverMapa(STATUS_VERIFICACAO);

export default async function PerfilDistribuidoraPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, nome, avatar_url").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  const { data: dist } = await supabase
    .from("distributors")
    .select("razao_social, cidade, prazo_entrega_dias, verification_status, ativo")
    .eq("id", user.id)
    .maybeSingle();

  const { data: cnpj } = await supabase.rpc("obter_cnpj_distribuidora", {
    p_distributor_id: user.id,
  });

  const { data: areas } = await supabase
    .from("distributor_areas")
    .select("uf")
    .eq("distributor_id", user.id);

  const { data: repasse } = await supabase.rpc("minha_config_repasse_distribuidora").single();

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

      <div className="card" style={{ padding: 26, marginBottom: 16 }}>
        <MidiaEditor uid={user.id} nome={profile?.nome ?? dist?.razao_social ?? "Distribuidora"}
          avatarUrl={profile?.avatar_url ?? null} bannerUrl={null} mostrarBanner={false} />
      </div>

      <PerfilDistribuidoraForm
        inicial={{
          razaoSocial: dist?.razao_social ?? "",
          cnpj: cnpj ?? "",
          cidade: dist?.cidade ?? CIDADE,
          prazoEntregaDias: dist?.prazo_entrega_dias ?? 5,
          ufs: (areas ?? []).map((a) => (a as { uf: string }).uf),
        }}
      />

      <div className="card" style={{ padding: 26, marginTop: 16 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "0 0 16px" }}>Como você recebe os repasses</h2>
        {dist ? (
          <ConfigRepasseForm
            inicial={{
              metodoRepasse: (repasse?.metodo_repasse as "pix" | "ted" | null) ?? null,
              chavePix: repasse?.chave_pix ?? "",
              chavePixTipo: repasse?.chave_pix_tipo ?? "",
              bancoCodigo: repasse?.banco_codigo ?? "",
              bancoAgencia: repasse?.banco_agencia ?? "",
              bancoConta: repasse?.banco_conta ?? "",
              bancoContaDigito: repasse?.banco_conta_digito ?? "",
              bancoContaTipo: repasse?.banco_conta_tipo ?? "",
              bancoTitularNome: repasse?.banco_titular_nome ?? "",
              bancoTitularDocumento: repasse?.banco_titular_documento ?? "",
            }}
          />
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--ink-faint)", margin: 0 }}>
            Salve a razão social e o CNPJ acima primeiro — é isso que cria seu cadastro. Depois disso
            esta seção libera pra você escolher Pix ou transferência bancária.
          </p>
        )}
      </div>
    </div>
  );
}

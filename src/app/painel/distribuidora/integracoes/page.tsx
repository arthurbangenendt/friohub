import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { IntegracoesEditor, type ChaveApiLinha } from "./IntegracoesEditor";

export default async function IntegracoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  const { data } = await supabase
    .from("distributor_api_keys")
    .select("id, nome, key_prefix, criado_em, revogado_em, last_used_at")
    .order("criado_em", { ascending: false });

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Integrações" titulo="Chaves de API" />
      <p style={{ color: "var(--ink-soft)", fontSize: 14.5, margin: "10px 0 24px" }}>
        Conecte o sistema da sua distribuidora para sincronizar o estoque de máquinas automaticamente, em vez de cadastrar produto por produto. Cada sincronização cria um lote que você revisa antes de aplicar — nada entra no catálogo sem sua confirmação.
      </p>
      <IntegracoesEditor chaves={(data ?? []) as ChaveApiLinha[]} />
    </div>
  );
}

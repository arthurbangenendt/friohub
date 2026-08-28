import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../shared";
import { comoPapel } from "../navegacao";
import { CompraAvulsaView } from "./CompraAvulsaView";

export default async function ComprarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const papel = comoPapel(profile?.role);
  /* Distribuidora vende, não compra, e admin não é parte do marketplace —
     mesmo recorte de acesso das outras telas do painel. */
  if (papel !== "cliente" && papel !== "profissional") redirect("/painel");

  /* Cidade só existe salva pro profissional (`professionals.cidade`) — o
     cliente nunca teve esse campo, só CEP e endereço completo
     (`profile_private`, ver 20260824100000_endereco_cliente.sql). Prefixa o
     que dá pra prefixar; o resto o comprador completa na hora. */
  const [{ data: priv }, { data: prof }] = await Promise.all([
    supabase.from("profile_private").select("endereco_cep, endereco_completo").eq("id", user.id).maybeSingle(),
    papel === "profissional"
      ? supabase.from("professionals").select("cidade").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Comprar" titulo="Equipamento e peças" />
      <p style={{ color: "var(--ink-soft)", fontSize: 14.5, margin: "10px 0 24px" }}>
        Compre direto de uma distribuidora verificada, sem abrir um pedido de orçamento — útil pra repor uma peça
        ou comprar um aparelho avulso. O pagamento e a entrega acontecem aqui dentro, do mesmo jeito que numa
        instalação.
      </p>
      <CompraAvulsaView
        enderecoPadrao={{
          cep: priv?.endereco_cep ?? "",
          cidade: prof?.cidade ?? "",
          endereco: priv?.endereco_completo ?? "",
        }}
      />
    </div>
  );
}

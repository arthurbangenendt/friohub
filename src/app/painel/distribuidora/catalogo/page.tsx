import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../../shared";
import { comoPapel } from "../../navegacao";
import { CatalogoEditor, type ProdutoLinha } from "./CatalogoEditor";

export default async function CatalogoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (comoPapel(profile?.role) !== "distribuidora") redirect("/painel");

  /* Lê de `meus_produtos`, não de `products`: o `custo` teve o SELECT revogado
     para authenticated (20260812220100) e a view é o caminho autorizado da
     distribuidora até o próprio custo. */
  const { data } = await supabase
    .from("meus_produtos")
    .select("id, marca, modelo, btu, categoria, custo, preco_venda, preco_manual, image_url, ativo, estoque_disponivel")
    .order("marca")
    .order("btu");

  const { data: cfg } = await supabase
    .from("platform_config")
    .select("markup_produto_pct")
    .maybeSingle();

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Catálogo" titulo="Seus produtos" />
      <p style={{ color: "var(--ink-soft)", fontSize: 14.5, margin: "10px 0 24px" }}>
        Produto sem estoque sai da busca do cliente na hora — e volta assim que você reativar.
      </p>
      <CatalogoEditor
        produtos={(data ?? []) as ProdutoLinha[]}
        markup={Number(cfg?.markup_produto_pct ?? 0.25)}
      />
    </div>
  );
}

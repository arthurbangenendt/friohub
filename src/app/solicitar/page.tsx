import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SolicitarWizard } from "./SolicitarWizard";
import type { ProdutoDTO } from "./marketplace-types";

export default async function SolicitarPage(props: PageProps<"/solicitar">) {
  // A home já manda o CEP digitado no hero (?cep=). Sem ler aqui, o cliente
  // precisava digitar de novo lá no passo de endereço.
  const sp = await props.searchParams;
  const cepInicial = typeof sp.cep === "string" ? sp.cep : "";
  const equipmentId = typeof sp.equipment === "string" ? sp.equipment : "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?aviso=" + encodeURIComponent("Entre para solicitar um serviço."));

  const { data: equipment } = equipmentId
    ? await supabase.from("customer_equipment").select("id, brand, model, capacity_btu, site:customer_sites(label, cep)").eq("id", equipmentId).eq("customer_id", user.id).maybeSingle()
    : { data: null };
  const equipmentSite = Array.isArray(equipment?.site) ? equipment.site[0] : equipment?.site;

  // O catálogo inicial é apenas a primeira página. Demais páginas e o matching
  // por CEP são buscados sob demanda pelo Route Handler do marketplace.
  const { data: produtos, error: produtosError } = await supabase.rpc("buscar_produtos_marketplace", {
    p_limit: 12,
    p_offset: 0,
  });
  if (produtosError) throw new Error(`Falha ao carregar catálogo: ${produtosError.message}`);

  const produtosDTO: ProdutoDTO[] = (produtos ?? []).map((p) => {
    return {
      id: p.product_id,
      marca: p.marca,
      modelo: p.modelo,
      btu: p.btu,
      categoria: p.categoria,
      precoVenda: Number(p.preco_venda),
      imageUrl: p.image_url,
      distribuidora: p.distribuidora,
    };
  });

  return (
    <SolicitarWizard
      produtos={produtosDTO}
      totalProdutos={Number(produtos?.[0]?.total_count ?? produtosDTO.length)}
      profissionais={[]}
      cepInicial={equipmentSite?.cep ?? cepInicial}
      equipmentInitial={equipment ? { id: equipment.id, label: equipmentSite?.label ?? "Local", brand: equipment.brand, model: equipment.model, capacityBtu: equipment.capacity_btu } : null}
      userId={user.id}
    />
  );
}

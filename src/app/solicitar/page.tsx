import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SolicitarWizard } from "./SolicitarWizard";
import type { ProdutoDTO } from "./marketplace-types";
import { urlLogin } from "@/lib/proximo";

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
  /* Leva junto o que a pessoa já tinha informado. Antes o CEP digitado no hero
     morria aqui e o login jogava todo mundo em `/painel`. */
  if (!user) {
    const query = new URLSearchParams();
    if (cepInicial) query.set("cep", cepInicial);
    if (equipmentId) query.set("equipment", equipmentId);
    const destino = query.size ? `/solicitar?${query.toString()}` : "/solicitar";
    redirect(urlLogin(destino, "Entre para solicitar um serviço."));
  }

  const { data: equipment } = equipmentId
    ? await supabase.from("customer_equipment").select("id, brand, model, capacity_btu, site:customer_sites(label, cep)").eq("id", equipmentId).eq("customer_id", user.id).maybeSingle()
    : { data: null };
  const equipmentSite = Array.isArray(equipment?.site) ? equipment.site[0] : equipment?.site;

  /* Terceiro fallback de CEP, depois de ?cep= e do site do aparelho: o CEP
     salvo no perfil (`/painel/perfil-cliente`). Só busca quando os outros
     dois já vieram vazios — sem sentido gastar a query à toa. */
  const { data: perfilPriv } = !equipmentSite?.cep && !cepInicial
    ? await supabase.from("profile_private").select("endereco_cep").eq("id", user.id).maybeSingle()
    : { data: null };

  // O catálogo inicial é apenas a primeira página. Demais páginas e o matching
  // por CEP são buscados sob demanda pelo Route Handler do marketplace.
  const { data: produtos, error: produtosError } = await supabase.rpc("buscar_produtos_marketplace", {
    p_limit: 12,
    p_offset: 0,
  });
  /* Falha no catálogo não pode derrubar o wizard. O catálogo só é usado por
     quem ainda não tem aparelho — quem já tem passa direto por esse passo. Um
     `throw` aqui trocava o fluxo principal de conversão por uma tela de erro
     inteira por causa de um passo opcional. Sem produtos, o wizard segue e o
     passo do catálogo mostra o próprio estado vazio. */
  if (produtosError) {
    console.error("[solicitar] falha ao carregar catálogo:", produtosError.message);
  }

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
      distributorId: p.distributor_id,
    };
  });

  return (
    <SolicitarWizard
      produtos={produtosDTO}
      totalProdutos={Number(produtos?.[0]?.total_count ?? produtosDTO.length)}
      profissionais={[]}
      cepInicial={equipmentSite?.cep || cepInicial || perfilPriv?.endereco_cep || ""}
      equipmentInitial={equipment ? { id: equipment.id, label: equipmentSite?.label ?? "Local", brand: equipment.brand, model: equipment.model, capacityBtu: equipment.capacity_btu } : null}
      userId={user.id}
    />
  );
}

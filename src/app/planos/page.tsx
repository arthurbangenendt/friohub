import { createClient } from "@/lib/supabase/server";
import { SiteHeader, SiteFooter } from "@/components/site";
import { CIDADE } from "@/lib/regiao";
import { PlanosView, type PlanoDTO } from "./PlanosView";

/* Vitrine de assinatura do profissional.
 *
 * Preço e nome vêm do banco (`subscription_plans`), nunca do código: o dia em
 * que o preço mudar, muda numa linha de SQL e a página inteira acompanha —
 * inclusive o que já foi registrado em `plan_interest`. O argumento de venda
 * fica no componente cliente, onde se itera sem migration. */

export const metadata = {
  title: "Planos FrioHub — para técnicos e empresas de climatização",
  description:
    "Mensalidade fixa, sem taxa por lead e sem comissão escondida. Apareça na busca, organize a agenda e saiba o lucro real de cada obra.",
};

export default async function PlanosPage(props: PageProps<"/planos">) {
  const sp = await props.searchParams;
  /* `?novo=1` chega de quem acabou de salvar o perfil técnico — fim do cadastro
     de parceiro. Muda só o topo da página: quem chega assim precisa de contexto
     ("e agora?"), quem chega pelo menu já sabe o que veio fazer. */
  const boasVindas = sp.novo === "1";

  const supabase = await createClient();

  const { data: planos } = await supabase
    .from("subscription_plans")
    .select("slug, nome, headline, preco_mensal, preco_anual, destaque")
    .eq("ativo", true)
    .eq("publico", true)
    .order("ordem");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  /* Saber se é profissional muda o texto do botão de erro, não o acesso: quem
     é cliente vê a página normalmente (pode estar avaliando virar parceiro),
     mas recebe o caminho certo em vez de um erro do banco. */
  let ehProfissional = false;
  if (user) {
    const { data: pro } = await supabase
      .from("professionals")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();
    ehProfissional = !!pro;
  }

  /* [RISCO 1] O interruptor de cobrança é por cidade e entra desligado no
     piloto. A página precisa dizer isso na cara do usuário — anunciar preço
     sem avisar que ainda não cobramos seria vender o que não está ligado. */
  const { data: billing } = await supabase
    .from("city_billing_config")
    .select("cobranca_ativa")
    .eq("cidade", CIDADE)
    .maybeSingle();

  const dto: PlanoDTO[] = (planos ?? []).map((p) => ({
    slug: p.slug ?? "",
    nome: p.nome,
    headline: p.headline,
    precoMensal: Number(p.preco_mensal),
    precoAnual: p.preco_anual === null ? null : Number(p.preco_anual),
    destaque: p.destaque,
  }));

  return (
    <>
      <SiteHeader logado={!!user} />
      <PlanosView
        planos={dto}
        logado={!!user}
        ehProfissional={ehProfissional}
        cobrancaAtiva={billing?.cobranca_ativa ?? false}
        boasVindas={boasVindas && ehProfissional}
        hrefVitrine={user ? `/profissional/${user.id}` : null}
      />
      <SiteFooter />
    </>
  );
}

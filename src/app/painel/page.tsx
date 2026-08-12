import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PainelParceiro } from "./PainelParceiro";
import { PainelCliente } from "./PainelCliente";
import type { Filtro, JobRow, OrderRow } from "./shared";

/* Busca os dados uma vez e delega a renderização ao painel do papel certo.
   Cliente e parceiro veem telas diferentes o suficiente para não caberem num
   arquivo só cheio de `isPro ?` — o que existia antes. */
export default async function PainelPage(props: PageProps<"/painel">) {
  const sp = await props.searchParams;
  const filtro: Filtro = sp.f === "concluidos" || sp.f === "todos" ? sp.f : "ativos";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("nome, role").eq("id", user.id).single();
  const nome = profile?.nome ?? user.email ?? "você";
  const isPro = profile?.role === "profissional";

  const { data: jobsData } = await supabase
    .from("jobs")
    .select(`id, job_type, status, created_at, ambiente, cep, endereco, btu_recomendado,
             produto:products ( marca, modelo ),
             profissional:professionals ( profiles ( nome ) ),
             cliente:profiles!jobs_cliente_id_fkey ( nome )`)
    .order("created_at", { ascending: false })
    .limit(100);
  const jobs = (jobsData ?? []) as JobRow[];

  /* Valores: o profissional lê `orders` (vê a comissão descontada dele), o
     cliente lê a view `orders_cliente`, sem margem nem comissão da plataforma. */
  const { data: ordersData } = isPro
    ? await supabase.from("orders").select("job_id, preco_servico, comissao_servico, total, payment_status")
    : await supabase.from("orders_cliente").select("job_id, preco_servico, total, payment_status");

  const orderPorJob = new Map<string, OrderRow>();
  for (const o of (ordersData ?? []) as ({ job_id: string } & OrderRow)[]) {
    orderPorJob.set(o.job_id, o);
  }

  if (!isPro) {
    return <PainelCliente nome={nome} jobs={jobs} orderPorJob={orderPorJob} filtro={filtro} />;
  }

  // Nota média do profissional: média das especialidades ponderada pelo nº de avaliações.
  const { data: skills } = await supabase
    .from("professional_skills")
    .select("rating_avg, rating_count")
    .eq("professional_id", user.id);

  const totalAval = (skills ?? []).reduce((s, k) => s + (k.rating_count ?? 0), 0);
  const notaMedia = totalAval > 0
    ? (skills ?? []).reduce((s, k) => s + Number(k.rating_avg ?? 0) * (k.rating_count ?? 0), 0) / totalAval
    : null;

  return (
    <PainelParceiro
      nome={nome}
      jobs={jobs}
      orderPorJob={orderPorJob}
      filtro={filtro}
      notaMedia={notaMedia}
      semPerfilPro={(skills?.length ?? 0) === 0}
    />
  );
}

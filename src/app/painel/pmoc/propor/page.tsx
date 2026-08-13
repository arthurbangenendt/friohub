import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PropostaPmocForm, type ClienteOpcao } from "./PropostaPmocForm";

/* Proposta de PMOC pelo profissional.
 *
 * A lista de clientes vem de `jobs`: só aparece quem ele já atendeu. É a mesma
 * regra que o RPC aplica no banco — aqui ela existe para não oferecer uma opção
 * que o servidor vai recusar, não como controle de acesso. */

export const metadata = { title: "Propor PMOC — FrioHub" };

export default async function ProporPmocPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel/pmoc");

  const { data: jobs } = await supabase
    .from("jobs")
    .select("cliente_id, cep, cidade, created_at")
    .eq("profissional_id", user.id)
    .order("created_at", { ascending: false });

  /* Um cliente pode ter vários serviços; ficamos com o mais recente, que traz
     o CEP mais provável de ainda valer. */
  const porCliente = new Map<string, { cep: string | null; cidade: string | null }>();
  for (const j of jobs ?? []) {
    if (!j.cliente_id || porCliente.has(j.cliente_id)) continue;
    porCliente.set(j.cliente_id, { cep: j.cep ?? null, cidade: j.cidade ?? null });
  }

  const ids = [...porCliente.keys()];
  const { data: perfis } = ids.length
    ? await supabase.from("profiles").select("id, nome").in("id", ids)
    : { data: [] };

  const clientes: ClienteOpcao[] = (perfis ?? []).map((p) => ({
    id: p.id,
    nome: p.nome,
    cep: porCliente.get(p.id)?.cep ?? null,
    cidade: porCliente.get(p.id)?.cidade ?? null,
  }));

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel/pmoc" style={{ color: "var(--ink-faint)", fontSize: 13 }}>
        ← PMOC
      </Link>
      <h1 style={{ margin: "20px 0 6px" }}>Propor um PMOC</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 26, lineHeight: 1.6 }}>
        Já atende um cliente com contrato de manutenção por fora? Traga para cá. Você define valor
        e periodicidade, o cliente aceita, e o sistema passa a gerar as visitas sozinho.
      </p>
      <div className="card" style={{ padding: 26 }}>
        <PropostaPmocForm clientes={clientes} />
      </div>
    </main>
  );
}

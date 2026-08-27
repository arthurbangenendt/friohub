import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Cabecalho, wrap } from "../shared";
import { salvarNota } from "./actions";
import { featureHabilitada } from "@/lib/feature-flags";
import { EmptyState } from "@/components/ui";
import { PlanoBloqueado } from "@/components/ui/PlanoBloqueado";

type EquipamentoCliente = { id: string; customer_id: string; brand: string | null; model: string | null; capacity_btu: number | null };
export default async function ClientesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await featureHabilitada(supabase, "ux_portfolio", user.id))) redirect("/painel");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel");
  const { data: clientesLiberado } = await supabase.rpc("plano_permite", {
    p_professional_id: user.id,
    p_feature: "clientes",
  });
  if (!clientesLiberado) {
    return (
      <div style={wrap}>
        <Cabecalho eyebrow="Relacionamento" titulo="Meus clientes" />
        <PlanoBloqueado
          titulo="Meus clientes é do plano Profissional"
          descricao="Histórico de serviço, equipamento e anotações privadas de cada cliente que já te contratou, num só lugar. Faça upgrade para liberar."
        />
      </div>
    );
  }
  const [{ data: jobs }, { data: notes }] = await Promise.all([
    supabase
      .from("jobs")
      .select("cliente_id,created_at,status,cliente:profiles!jobs_cliente_id_fkey(nome)")
      .eq("profissional_id", user.id)
      .order("created_at", { ascending: false }),
    supabase.from("professional_client_notes").select("customer_id,notes").eq("professional_id", user.id),
  ]);

  const by = new Map<string, { name: string; count: number; last: string }>();
  for (const job of jobs ?? []) {
    const c = Array.isArray(job.cliente) ? job.cliente[0] : job.cliente;
    const old = by.get(job.cliente_id);
    by.set(job.cliente_id, {
      name: c?.nome ?? "Cliente",
      count: (old?.count ?? 0) + 1,
      last: old?.last ?? job.created_at,
    });
  }
  const noteMap = new Map((notes ?? []).map((n) => [n.customer_id, n.notes]));

  /* Só busca equipamento depois de saber de quem são os clientes. Antes a
     consulta vinha sem filtro nenhum, confiando inteiramente na RLS para
     recortar — o que funciona, mas trafega a tabela toda que o papel enxerga
     para usar só uma parte. Com a lista vazia nem chega a consultar. */
  const clienteIds = [...by.keys()];
  const { data: equipment } = clienteIds.length
    ? await supabase
        .from("customer_equipment")
        .select("id,customer_id,brand,model,capacity_btu")
        .in("customer_id", clienteIds)
    : { data: [] as EquipamentoCliente[] };

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Relacionamento" titulo="Meus clientes" />
      <p style={{ color: "var(--ink-soft)" }}>
        Contexto privado para atender melhor quem já confia no seu trabalho.
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        {/* Sem isto, o profissional que ainda não atendeu ninguém via só o
            título e um parágrafo solto — uma tela que parece quebrada
            justamente para quem acabou de entrar na plataforma. */}
        {by.size === 0 && (
          <EmptyState
            titulo="Nenhum cliente ainda"
            descricao="Assim que você concluir o primeiro serviço, o cliente aparece aqui com o histórico e um espaço para suas anotações privadas."
            acao={{ label: "Ver orçamentos abertos", href: "/painel/orcamentos" }}
          />
        )}
        {[...by.entries()].map(([id, c]) => (
          <article className="card" key={id} style={{ padding: 20 }}>
            <h2 style={{ fontSize: 17 }}>{c.name}</h2>
            <p style={{ color: "var(--ink-faint)" }}>
              {c.count} serviço(s) · último contato {new Date(c.last).toLocaleDateString("pt-BR")}
            </p>
            <p>
              {(equipment ?? [])
                .filter((e) => e.customer_id === id)
                .map((e) => [e.brand, e.model].filter(Boolean).join(" "))
                .filter(Boolean)
                .join(", ") || "Nenhum equipamento cadastrado pelo cliente"}
            </p>
            <form action={salvarNota}>
              <input type="hidden" name="customerId" value={id} />
              <textarea
                name="notes"
                defaultValue={noteMap.get(id) ?? ""}
                required
                maxLength={4000}
                placeholder="Nota privada sobre acesso, preferências e contexto…"
                rows={3}
                style={{ width: "100%", padding: 10, border: "1px solid var(--line)", borderRadius: 9 }}
              />
              <button className="btn" style={{ marginTop: 8 }}>
                Salvar nota privada
              </button>
            </form>
          </article>
        ))}
      </div>
    </div>
  );
}

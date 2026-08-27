import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { marcarInteresseContatado } from "../actions";
import { Alert } from "@/components/ui";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export default async function AdminLeadsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: perfil } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (perfil?.role !== "admin") redirect("/painel");

  // Leads do formulário público de /distribuidoras — sem verificação, só contato.
  const { data: interesses, error: erroInteresses } = await supabase
    .from("distributor_interest")
    .select("id, nome, empresa, telefone, email, cidade, mensagem, created_at, contatado_em")
    .order("created_at", { ascending: false });

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Interesse de distribuidoras</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 30 }}>
        Contatos deixados em /distribuidoras. Não cria conta — decida quando enviar o link de cadastro.
      </p>

      {erroInteresses && (
        <Alert tipo="erro" titulo="Não foi possível carregar os leads">
          {erroInteresses.message}
        </Alert>
      )}

      <Secao titulo={`Leads (${interesses?.length ?? 0})`}>
        {(interesses?.length ?? 0) === 0
          ? <Vazio texto="Nenhum contato ainda." />
          : (interesses ?? []).map((i) => <CardInteresse key={i.id} i={i} />)}
      </Secao>
    </main>
  );
}

function CardInteresse({ i }: {
  i: { id: string; nome: string; empresa: string; telefone: string | null; email: string | null; cidade: string | null; mensagem: string | null; created_at: string; contatado_em: string | null };
}) {
  return (
    <div className="card" style={{ padding: 18, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 15.5 }}>{i.empresa}</strong>
          <span style={{ fontSize: 11.5, fontFamily: mono, color: "var(--ink-faint)" }}>{i.nome}</span>
          {i.contatado_em && (
            <span style={{ fontSize: 11.5, fontFamily: mono, padding: "3px 9px", borderRadius: 100, background: "var(--good-wash)", color: "var(--good)" }}>contatado</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 4 }}>
          {[i.cidade, i.telefone, i.email].filter(Boolean).join(" · ")}
        </div>
        {i.mensagem && <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 6 }}>{i.mensagem}</p>}
        <span style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 6, display: "block" }}>
          {new Date(i.created_at).toLocaleDateString("pt-BR")}
        </span>
      </div>
      {!i.contatado_em && (
        <form action={marcarInteresseContatado.bind(null, i.id)}>
          <button type="submit" className="btn btn-ghost" style={{ height: 36, padding: "0 14px", fontSize: 13 }}>
            Marcar como contatado
          </button>
        </form>
      )}
    </div>
  );
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 34 }}>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 700, marginBottom: 14 }}>{titulo}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}
function Vazio({ texto }: { texto: string }) {
  return <div style={{ padding: "20px", borderRadius: 12, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14, textAlign: "center" }}>{texto}</div>;
}

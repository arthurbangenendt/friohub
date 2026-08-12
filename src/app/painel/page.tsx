import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "../(auth)/actions";
import { ArrowRight } from "@/components/icons";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

const JOB_LABEL: Record<string, string> = {
  instalacao_com_equipamento: "Instalação de ar novo",
  manutencao: "Manutenção", remanejamento: "Remanejamento", limpeza: "Limpeza", conserto: "Conserto",
};
const STATUS: Record<string, { label: string; cor: string; bg: string }> = {
  aberto: { label: "Aberto", cor: "var(--ink-faint)", bg: "var(--surface-2)" },
  aguardando_profissional: { label: "Aguardando profissional", cor: "var(--warm)", bg: "var(--warm-wash)" },
  aceito: { label: "Aceito", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  em_execucao: { label: "Em execução", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
  concluido: { label: "Concluído", cor: "#2E8B6F", bg: "#e4f3ee" },
  avaliado: { label: "Avaliado", cor: "#2E8B6F", bg: "#e4f3ee" },
  cancelado: { label: "Cancelado", cor: "#b3261e", bg: "#fdeceb" },
};

export default async function PainelPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("nome, role").eq("id", user.id).single();
  const nome = profile?.nome ?? user.email;
  const role = profile?.role ?? "cliente";
  const isPro = role === "profissional";

  const { data: jobs } = await supabase
    .from("jobs")
    .select(`id, job_type, status, created_at, ambiente, btu_recomendado,
             produto:products ( marca, modelo ),
             profissional:professionals ( profiles ( nome ) ),
             cliente:profiles!jobs_cliente_id_fkey ( nome )`)
    .order("created_at", { ascending: false })
    .limit(20);

  // Se profissional, verifica se já tem perfil profissional montado
  let semPerfilPro = false;
  if (isPro) {
    const { count } = await supabase
      .from("professionals")
      .select("id", { count: "exact", head: true })
      .eq("id", user.id);
    semPerfilPro = (count ?? 0) === 0;
  }

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "56px 24px 80px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <p style={{ fontFamily: mono, fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--cool)", margin: "0 0 10px" }}>
            {isPro ? "Painel do profissional" : "Painel"}
          </p>
          <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: 0 }}>Olá, {nome}</h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {role === "admin" && <Link href="/admin" className="btn btn-ghost" style={{ height: 38, padding: "0 14px", fontSize: 13.5 }}>Admin</Link>}
          {isPro && <Link href="/painel/perfil" className="btn btn-ghost" style={{ height: 38, padding: "0 14px", fontSize: 13.5 }}>Meu perfil</Link>}
          <form action={logout}>
            <button type="submit" style={{ height: 38, padding: "0 16px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink-soft)", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Sair</button>
          </form>
        </div>
      </div>

      {/* CTA cliente */}
      {!isPro && (
        <Link href="/solicitar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginTop: 28, padding: "22px 24px", borderRadius: 16, background: "var(--cool)", color: "#fff", textDecoration: "none" }}>
          <div>
            <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>Precisa de um serviço?</div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>Instalação, manutenção, limpeza e mais.</div>
          </div>
          <span style={{ display: "flex" }}><ArrowRight size={20} /></span>
        </Link>
      )}

      {/* Aviso perfil pro incompleto */}
      {isPro && semPerfilPro && (
        <div style={{ marginTop: 28, padding: "20px 22px", borderRadius: 14, background: "var(--warm-wash)", border: "1px solid transparent", color: "var(--warm)" }}>
          <strong style={{ color: "var(--ink)" }}>Complete seu perfil profissional</strong>
          <p style={{ margin: "4px 0 14px", fontSize: 14, color: "var(--ink-soft)" }}>
            Para aparecer nas buscas dos clientes, cadastre suas especialidades e área de atendimento.
          </p>
          <Link href="/painel/perfil" className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>Completar perfil</Link>
        </div>
      )}

      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, letterSpacing: "-0.01em", margin: "36px 0 14px" }}>
        {isPro ? "Serviços atribuídos a você" : "Seus pedidos"}
      </h2>

      {(!jobs || jobs.length === 0) ? (
        <div style={{ padding: "28px 24px", borderRadius: 14, background: "var(--surface)", border: "1px dashed var(--line)", color: "var(--ink-faint)", textAlign: "center", fontSize: 14 }}>
          {isPro ? "Nenhum serviço ainda. Quando um cliente te escolher, aparece aqui." : "Você ainda não fez nenhum pedido."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {jobs.map((j) => {
            const prod = Array.isArray(j.produto) ? j.produto[0] : j.produto;
            const proObj = Array.isArray(j.profissional) ? j.profissional[0] : j.profissional;
            const proPerfil = proObj && (Array.isArray(proObj.profiles) ? proObj.profiles[0] : proObj.profiles);
            const cliObj = Array.isArray(j.cliente) ? j.cliente[0] : j.cliente;
            const st = STATUS[j.status] ?? STATUS.aberto;
            const outraParte = isPro ? cliObj?.nome : proPerfil?.nome;
            return (
              <Link key={j.id} href={`/servico/${j.id}`} style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)", color: "inherit" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{JOB_LABEL[j.job_type] ?? j.job_type}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-faint)", marginTop: 2 }}>
                    {outraParte ? `${isPro ? "Cliente" : "Profissional"}: ${outraParte}` : "—"}
                    {prod ? ` · ${prod.marca}` : ""}
                    {j.ambiente ? ` · ${j.ambiente}` : ""}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontFamily: mono, padding: "5px 11px", borderRadius: 100, background: st.bg, color: st.cor, whiteSpace: "nowrap" }}>{st.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

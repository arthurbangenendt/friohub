import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MidiaEditor } from "../MidiaEditor";
import { ClienteForm } from "./ClienteForm";
import { CpfCnpjCliente } from "./CpfCnpjCliente";
import { EnderecoCliente } from "./EnderecoCliente";
import { ContaSeguranca } from "./ContaSeguranca";
import { Kpi } from "../shared";
import { SecaoComIcone } from "@/components/ui";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { User, Doc, MapPin, Shield } from "@/components/icons";

const meses = (desde: string) => {
  const d = new Date(desde);
  const agora = new Date();
  return Math.max(0, (agora.getFullYear() - d.getFullYear()) * 12 + (agora.getMonth() - d.getMonth()));
};

function tempoNoSistema(desde: string): string {
  const m = meses(desde);
  if (m < 1) return "Menos de um mês";
  if (m === 1) return "1 mês";
  if (m < 12) return `${m} meses`;
  const anos = Math.floor(m / 12);
  return anos === 1 ? "1 ano" : `${anos} anos`;
}

export default async function PerfilClientePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nome, role, avatar_url, created_at")
    .eq("id", user.id)
    .single();

  // Parceiro tem perfil próprio, com skills e região.
  if (profile?.role === "profissional") redirect("/painel/perfil");

  const { data: priv } = await supabase
    .from("profile_private")
    .select("telefone, cpf_cnpj, endereco_cep, endereco_bairro, endereco_completo")
    .eq("id", user.id)
    .maybeSingle();

  const [{ count: concluidos }, { count: avaliacoes }] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true })
      .eq("cliente_id", user.id).in("status", ["concluido", "avaliado"]),
    supabase.from("reviews").select("id", { count: "exact", head: true })
      .eq("cliente_id", user.id),
  ]);

  const nome = profile?.nome ?? user.email ?? "Você";

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ fontSize: "1.8rem", fontWeight: 800, margin: "0 0 6px" }}>Meu perfil</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 26 }}>
        Seus dados de contato e seu histórico na plataforma.
      </p>

      {/* Fatos do sistema — nada de avaliação subjetiva sobre o cliente. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Kpi label="Cliente há" valor={tempoNoSistema(profile?.created_at ?? new Date().toISOString())} />
        <Kpi label="Serviços concluídos" valor={String(concluidos ?? 0)} />
        <Kpi label="Avaliações que você fez" valor={String(avaliacoes ?? 0)} />
      </div>

      <TimelineContent delay={0}>
        <SecaoComIcone icone={<User size={18} />} titulo="Foto de perfil">
          <MidiaEditor uid={user.id} nome={nome} avatarUrl={profile?.avatar_url ?? null}
            bannerUrl={null} mostrarBanner={false} />
        </SecaoComIcone>
      </TimelineContent>

      <TimelineContent delay={.06}>
        <SecaoComIcone icone={<User size={18} />} titulo="Dados pessoais">
          <ClienteForm nomeInicial={nome} telefoneInicial={priv?.telefone ?? ""} />
        </SecaoComIcone>
      </TimelineContent>

      <TimelineContent delay={.12}>
        <SecaoComIcone icone={<Doc size={18} />} titulo="Documento">
          <CpfCnpjCliente cpfCnpjInicial={priv?.cpf_cnpj ?? null} />
        </SecaoComIcone>
      </TimelineContent>

      <TimelineContent delay={.18}>
        <SecaoComIcone icone={<MapPin size={18} />} titulo="Endereço">
          <EnderecoCliente
            cepInicial={priv?.endereco_cep ?? ""}
            bairroInicial={priv?.endereco_bairro ?? ""}
            enderecoCompletoInicial={priv?.endereco_completo ?? ""}
          />
        </SecaoComIcone>
      </TimelineContent>

      <TimelineContent delay={.24}>
        <SecaoComIcone icone={<Shield size={18} />} titulo="Conta e segurança">
          <ContaSeguranca emailAtual={user.email ?? ""} />
        </SecaoComIcone>
      </TimelineContent>
    </main>
  );
}

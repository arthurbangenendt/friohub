import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "../../Avatar";
import { mono, one, wrap } from "../../shared";
import { marcarLida } from "../actions";
import { Thread, type Mensagem } from "./Thread";
import { Handoff } from "./Handoff";

export default async function ConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: conversa } = await supabase
    .from("conversations")
    .select(`id, cliente_id, professional_id,
             cliente:profiles!conversations_cliente_id_fkey ( nome, avatar_url ),
             profissional:professionals ( profiles ( nome, avatar_url ) )`)
    .eq("id", id)
    .maybeSingle();

  // RLS já filtra; se não veio nada, ou não existe ou não é dele.
  if (!conversa) redirect("/painel/mensagens");

  const souCliente = conversa.cliente_id === user.id;
  const souProfissional = conversa.professional_id === user.id;
  if (!souCliente && !souProfissional) redirect("/painel/mensagens");

  /* O PostgREST devolve o embed como objeto ou array conforme a inferência da
     relação — daí o `one()` em cada nível. Ver o mesmo tratamento em
     `servico/[id]/page.tsx`. */
  type PerfilEmbed = { nome: string; avatar_url: string | null };
  const perfilOutro = souCliente
    ? one(one(conversa.profissional as unknown as { profiles: PerfilEmbed | PerfilEmbed[] } | null)?.profiles)
    : one(conversa.cliente as unknown as PerfilEmbed | PerfilEmbed[] | null);

  const outroId = souCliente ? conversa.professional_id : conversa.cliente_id;
  const outroNome = perfilOutro?.nome ?? (souCliente ? "Profissional" : "Cliente");

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, sender_id, body, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  // Abrir a conversa é o que marca como lida — mesma semântica de qualquer app
  // de mensagem. Roda depois de carregar, para a badge sumir na próxima visita.
  await marcarLida(id);

  /* `jobJuntos` não decide o handoff — quem decide é `handoff_liberado` no banco.
     Serve só para o card dizer o motivo certo: liberar por serviço fechado e
     escrever "vocês já conversam há alguns dias" faz o produto parecer quebrado
     logo no primeiro contato. */
  const [{ data: liberado }, { data: consentimentos }, { count: jobsJuntos }] = await Promise.all([
    supabase.rpc("handoff_liberado", { p_conversation_id: id }),
    supabase.from("conversation_contact_consent").select("user_id").eq("conversation_id", id),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", conversa.cliente_id)
      .eq("profissional_id", conversa.professional_id)
      .in("status", ["aceito", "em_execucao", "concluido", "avaliado"]),
  ]);

  const quemAutorizou = new Set((consentimentos ?? []).map((c) => (c as { user_id: string }).user_id));

  return (
    <div style={{ ...wrap, maxWidth: 760 }}>
      <Link href="/painel/mensagens" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>
        ← Mensagens
      </Link>

      {/* Cabeçalho no formato de DM: avatar + nome, e o perfil a um toque. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0 22px" }}>
        <Avatar nome={outroNome} id={outroId} url={perfilOutro?.avatar_url ?? null} size={44} />
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{outroNome}</div>
          {souCliente ? (
            <Link href={`/profissional/${conversa.professional_id}`} style={{ fontSize: 12.5, color: "var(--cool-deep)", fontWeight: 600 }}>
              Ver perfil
            </Link>
          ) : (
            <span style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Cliente</span>
          )}
        </div>
      </div>

      {liberado === true && (
        <div style={{ marginBottom: 18 }}>
          <Handoff
            conversaId={id}
            outroNome={outroNome}
            jaAutorizei={quemAutorizou.has(user.id)}
            ambosAutorizaram={quemAutorizou.has(user.id) && quemAutorizou.has(outroId)}
            motivo={(jobsJuntos ?? 0) > 0 ? "servico" : "conversa"}
          />
        </div>
      )}

      <Thread
        conversaId={id}
        meuId={user.id}
        outroId={outroId}
        outroNome={outroNome}
        outroAvatar={perfilOutro?.avatar_url ?? null}
        iniciais={(msgs ?? []) as Mensagem[]}
      />
    </div>
  );
}

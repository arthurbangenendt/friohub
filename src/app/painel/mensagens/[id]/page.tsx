import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "../../Avatar";
import { mono, one, wrap } from "../../shared";
import { marcarLida } from "../actions";
import { Thread, type Mensagem, type ParticipanteAuditoria } from "./Thread";
import { Handoff } from "./Handoff";

export default async function ConversaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfilLogado } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const admin = perfilLogado?.role === "admin";

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
  if (!souCliente && !souProfissional && !admin) redirect("/painel/mensagens");

  /* O PostgREST devolve o embed como objeto ou array conforme a inferência da
     relação — daí o `one()` em cada nível. Ver o mesmo tratamento em
     `servico/[id]/page.tsx`. */
  type PerfilEmbed = { nome: string; avatar_url: string | null };
  const perfilCliente = one(conversa.cliente as unknown as PerfilEmbed | PerfilEmbed[] | null);
  const perfilProfissional = one(
    one(conversa.profissional as unknown as { profiles: PerfilEmbed | PerfilEmbed[] } | null)?.profiles,
  );
  const perfilOutro = souCliente
    ? perfilProfissional
    : perfilCliente;

  const outroId = souCliente ? conversa.professional_id : conversa.cliente_id;
  const outroNome = perfilOutro?.nome ?? (souCliente ? "Profissional" : "Cliente");

  const { data: msgs } = await supabase
    .from("messages")
    .select("id, sender_id, sender_kind, body, created_at, canal, chatwoot_message_id")
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });

  /* O admin observa, mas não é destinatário. Marcar como lida aqui apagaria a
     pendência real de cliente ou profissional e adulteraria a operação. */
  if (!admin) await marcarLida(id);

  /* `jobJuntos` não decide o handoff — quem decide é `handoff_liberado` no banco.
     Serve só para o card dizer o motivo certo: liberar por serviço fechado e
     escrever "vocês já conversam há alguns dias" faz o produto parecer quebrado
     logo no primeiro contato. */
  const handoff = admin
    ? { liberado: false, consentimentos: [] as { user_id: string }[], jobsJuntos: 0 }
    : await (async () => {
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
      return { liberado: liberado === true, consentimentos: consentimentos ?? [], jobsJuntos: jobsJuntos ?? 0 };
    })();

  const quemAutorizou = new Set(handoff.consentimentos.map((c) => c.user_id));
  const participantesAuditoria: [ParticipanteAuditoria, ParticipanteAuditoria] = [
    {
      id: conversa.cliente_id,
      nome: perfilCliente?.nome ?? "Cliente",
      avatar: perfilCliente?.avatar_url ?? null,
      papel: "Cliente",
    },
    {
      id: conversa.professional_id,
      nome: perfilProfissional?.nome ?? "Profissional",
      avatar: perfilProfissional?.avatar_url ?? null,
      papel: "Profissional",
    },
  ];

  return (
    <div style={{ ...wrap, maxWidth: admin ? 900 : 760 }}>
      <Link href="/painel/mensagens" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)" }}>
        ← {admin ? "Todas as conversas" : "Mensagens"}
      </Link>

      {/* Cabeçalho no formato de DM: avatar + nome, e o perfil a um toque. */}
      {admin ? (
        <div className="chat-auditoria-cabecalho">
          <div className="chat-auditoria-titulo">
            <span>Auditoria da conversa</span>
            <strong>{participantesAuditoria[0].nome} ↔ {participantesAuditoria[1].nome}</strong>
          </div>
          <div className="chat-auditoria-participantes">
            {participantesAuditoria.map((participante) => (
              <div key={participante.id}>
                <Avatar nome={participante.nome} id={participante.id} url={participante.avatar} size={40} />
                <span><strong>{participante.nome}</strong><small>{participante.papel}</small></span>
              </div>
            ))}
          </div>
        </div>
      ) : (
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
      )}

      {handoff.liberado && (
        <div style={{ marginBottom: 18 }}>
          <Handoff
            conversaId={id}
            outroNome={outroNome}
            jaAutorizei={quemAutorizou.has(user.id)}
            ambosAutorizaram={quemAutorizou.has(user.id) && quemAutorizou.has(outroId)}
            motivo={handoff.jobsJuntos > 0 ? "servico" : "conversa"}
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
        somenteLeitura={admin}
        participantesAuditoria={admin ? participantesAuditoria : undefined}
      />
    </div>
  );
}

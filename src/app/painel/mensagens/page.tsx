import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Avatar } from "../Avatar";
import { Cabecalho, one, wrap } from "../shared";

/* Lista de conversas do usuário logado, dos dois lados.
   `last_message_at` é mantido por trigger justamente para ordenar aqui sem
   varrer `messages` — ver 20260812230000_chat.sql. */

type ConversaRow = {
  id: string;
  cliente_id: string;
  professional_id: string;
  last_message_at: string | null;
  created_at: string;
  cliente: unknown;
  profissional: unknown;
};

const quando = (iso: string | null) => {
  if (!iso) return "sem mensagens";
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

export default async function MensagensPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* A RLS já limita às conversas de quem está logado; o filtro explícito existe
     para o admin, que enxerga todas e aqui deve ver só as dele. */
  const { data } = await supabase
    .from("conversations")
    .select(`id, cliente_id, professional_id, last_message_at, created_at,
             cliente:profiles!conversations_cliente_id_fkey ( nome, avatar_url ),
             profissional:professionals ( profiles ( nome, avatar_url ) )`)
    .or(`cliente_id.eq.${user.id},professional_id.eq.${user.id}`)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const conversas = (data ?? []) as ConversaRow[];

  /* Uma consulta só para tudo que está por ler, em vez de uma por conversa.
     Traz também o corpo da última mensagem para a prévia da lista. */
  const { data: naoLidas } = await supabase
    .from("messages")
    .select("conversation_id")
    .is("read_at", null)
    .neq("sender_id", user.id);

  const temNaoLida = new Set((naoLidas ?? []).map((m) => (m as { conversation_id: string }).conversation_id));

  const { data: ultimas } = await supabase
    .from("messages")
    .select("conversation_id, body, sender_id, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  // A primeira ocorrência de cada conversa já é a mais recente (ordem desc).
  const previa = new Map<string, { body: string; sender_id: string }>();
  for (const m of (ultimas ?? []) as { conversation_id: string; body: string; sender_id: string }[]) {
    if (!previa.has(m.conversation_id)) previa.set(m.conversation_id, { body: m.body, sender_id: m.sender_id });
  }

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Mensagens" titulo="Suas conversas" />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28 }}>
        {conversas.length === 0 && (
          <div style={{ padding: 28, borderRadius: 14, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14.5, textAlign: "center" }}>
            Nenhuma conversa ainda. Abra o perfil de um profissional e toque em
            &ldquo;Enviar mensagem&rdquo; para começar.
          </div>
        )}

        {conversas.map((c) => {
          const souCliente = c.cliente_id === user.id;
          const outro = souCliente
            ? one(one(c.profissional as { profiles: unknown } | null)?.profiles) as { nome: string; avatar_url: string | null } | null
            : one(c.cliente) as { nome: string; avatar_url: string | null } | null;
          const nome = outro?.nome ?? (souCliente ? "Profissional" : "Cliente");
          const idAvatar = souCliente ? c.professional_id : c.cliente_id;
          const nao = temNaoLida.has(c.id);
          const ult = previa.get(c.id);
          const resumo = ult
            ? `${ult.sender_id === user.id ? "Você: " : ""}${ult.body}`
            : souCliente ? "Profissional" : "Cliente";

          return (
            <Link
              key={c.id}
              href={`/painel/mensagens/${c.id}`}
              style={{
                display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderRadius: 14,
                color: "inherit", textDecoration: "none",
              }}
            >
              <Avatar nome={nome} id={idAvatar} url={outro?.avatar_url ?? null} size={52} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: nao ? 700 : 600, fontSize: 15 }}>{nome}</div>
                {/* Prévia numa linha só, cortada — o texto longo não pode empurrar
                    a bolinha nem quebrar o cartão. */}
                <div
                  style={{
                    fontSize: 13.5, marginTop: 2,
                    color: nao ? "var(--ink)" : "var(--ink-faint)",
                    fontWeight: nao ? 600 : 400,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}
                >
                  {resumo}
                  <span style={{ color: "var(--ink-faint)", fontWeight: 400 }}> · {quando(c.last_message_at)}</span>
                </div>
              </div>
              {/* Bolinha de não lida, no lugar do contador — é o sinal que o
                  Instagram usa e o que basta aqui. */}
              <span
                aria-label={nao ? "Mensagens não lidas" : undefined}
                style={{
                  width: 9, height: 9, borderRadius: "50%", flexShrink: 0,
                  background: nao ? "var(--cool)" : "transparent",
                }}
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

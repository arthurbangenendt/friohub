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

type PerfilResumo = { nome: string; avatar_url: string | null };

const POR_PAGINA_ADMIN = 50;

const quando = (iso: string | null) => {
  if (!iso) return "sem mensagens";
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  return mesmoDia
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
};

export default async function MensagensPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: perfilLogado } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const admin = perfilLogado?.role === "admin";
  const parametros = await searchParams;
  const paginaSolicitada = Number.parseInt(parametros.pagina ?? "1", 10);
  const pagina = Number.isFinite(paginaSolicitada) && paginaSolicitada > 0 ? paginaSolicitada : 1;
  const inicio = (pagina - 1) * POR_PAGINA_ADMIN;

  /* Participantes veem apenas as próprias linhas. O admin não recebe o filtro:
     a policy de SELECT já lhe dá a leitura global prevista para auditoria. A
     paginação impede que uma operação com milhares de atendimentos vire uma
     resposta sem limite. */
  let consulta = supabase
    .from("conversations")
    .select(`id, cliente_id, professional_id, last_message_at, created_at,
             cliente:profiles!conversations_cliente_id_fkey ( nome, avatar_url ),
             profissional:professionals ( profiles ( nome, avatar_url ) )`, { count: "exact" });

  if (!admin) consulta = consulta.or(`cliente_id.eq.${user.id},professional_id.eq.${user.id}`);

  consulta = consulta.order("last_message_at", { ascending: false, nullsFirst: false });
  if (admin) consulta = consulta.range(inicio, inicio + POR_PAGINA_ADMIN - 1);

  const { data, count, error: conversasErro } = await consulta;

  const conversas = (data ?? []) as ConversaRow[];

  /* Uma consulta só para tudo que está por ler, em vez de uma por conversa.
     Traz também o corpo da última mensagem para a prévia da lista. */
  const { data: naoLidas } = admin
    ? { data: [] }
    : await supabase
      .from("messages")
      .select("conversation_id")
      .is("read_at", null)
      .neq("sender_id", user.id);

  const temNaoLida = new Set((naoLidas ?? []).map((m) => (m as { conversation_id: string }).conversation_id));

  const ids = conversas.map((conversa) => conversa.id);
  const { data: ultimas } = ids.length === 0
    ? { data: [] }
    : await supabase
      .from("messages")
      .select("conversation_id, body, sender_id, created_at")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(admin ? 500 : 200);

  // A primeira ocorrência de cada conversa já é a mais recente (ordem desc).
  const previa = new Map<string, { body: string; sender_id: string }>();
  for (const m of (ultimas ?? []) as { conversation_id: string; body: string; sender_id: string }[]) {
    if (!previa.has(m.conversation_id)) previa.set(m.conversation_id, { body: m.body, sender_id: m.sender_id });
  }

  return (
    <div style={wrap}>
      <Cabecalho eyebrow={admin ? "Auditoria" : "Mensagens"} titulo={admin ? "Conversas do sistema" : "Suas conversas"} />

      {admin && (
        <div className="chat-admin-aviso">
          <span className="chat-admin-aviso-icone" aria-hidden>●</span>
          <span><strong>Modo somente leitura.</strong> Acompanhe os atendimentos sem interferir na conversa entre cliente e profissional.</span>
          <span className="chat-admin-total">{count ?? 0} conversa{count === 1 ? "" : "s"}</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 28 }}>
        {conversasErro && (
          <div className="chat-lista-erro">Não foi possível carregar as conversas: {conversasErro.message}</div>
        )}
        {conversas.length === 0 && (
          <div style={{ padding: 28, borderRadius: 14, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14.5, textAlign: "center" }}>
            {admin
              ? "Nenhuma conversa foi iniciada no sistema até agora."
              : <>Nenhuma conversa ainda. Abra o perfil de um profissional e toque em &ldquo;Enviar mensagem&rdquo; para começar.</>}
          </div>
        )}

        {conversas.map((c) => {
          const cliente = one(c.cliente) as PerfilResumo | null;
          const profissional = one(one(c.profissional as { profiles: unknown } | null)?.profiles) as PerfilResumo | null;
          const souCliente = c.cliente_id === user.id;
          const outro = souCliente
            ? profissional
            : cliente;
          const nome = outro?.nome ?? (souCliente ? "Profissional" : "Cliente");
          const idAvatar = souCliente ? c.professional_id : c.cliente_id;
          const nao = temNaoLida.has(c.id);
          const ult = previa.get(c.id);
          const autorAdmin = ult?.sender_id === c.cliente_id
            ? cliente?.nome ?? "Cliente"
            : profissional?.nome ?? "Profissional";
          const resumo = ult
            ? `${admin ? `${autorAdmin}: ` : ult.sender_id === user.id ? "Você: " : ""}${ult.body}`
            : admin ? "Conversa aberta, ainda sem mensagens" : souCliente ? "Profissional" : "Cliente";

          return (
            <Link
              key={c.id}
              href={`/painel/mensagens/${c.id}`}
              className="chat-lista-item"
            >
              {admin ? (
                <span className="chat-lista-avatares" aria-label={`${cliente?.nome ?? "Cliente"} e ${profissional?.nome ?? "Profissional"}`}>
                  <Avatar nome={cliente?.nome ?? "Cliente"} id={c.cliente_id} url={cliente?.avatar_url ?? null} size={42} />
                  <Avatar nome={profissional?.nome ?? "Profissional"} id={c.professional_id} url={profissional?.avatar_url ?? null} size={42} />
                </span>
              ) : (
                <Avatar nome={nome} id={idAvatar} url={outro?.avatar_url ?? null} size={52} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: nao ? 700 : 650, fontSize: 15 }}>
                  {admin ? `${cliente?.nome ?? "Cliente"} ↔ ${profissional?.nome ?? "Profissional"}` : nome}
                </div>
                {admin && (
                  <div className="chat-lista-papeis"><span>Cliente</span><span>Profissional</span></div>
                )}
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

      {admin && (count ?? 0) > POR_PAGINA_ADMIN && (
        <nav className="chat-paginacao" aria-label="Paginação das conversas">
          {pagina > 1 ? <Link href={`/painel/mensagens?pagina=${pagina - 1}`}>← Anterior</Link> : <span />}
          <span>Página {pagina} de {Math.ceil((count ?? 0) / POR_PAGINA_ADMIN)}</span>
          {inicio + conversas.length < (count ?? 0)
            ? <Link href={`/painel/mensagens?pagina=${pagina + 1}`}>Próxima →</Link>
            : <span />}
        </nav>
      )}
    </div>
  );
}

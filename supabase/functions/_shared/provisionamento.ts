/* Criação sob demanda dos objetos do Chatwoot que espelham nossos perfis.
 *
 * Tudo aqui é idempotente por `chatwoot_identities`: chamar duas vezes devolve
 * o mesmo id. É o que permite provisionar preguiçosamente — na primeira
 * mensagem — em vez de manter um job de sincronização de cadastro inteiro.
 *
 * ---------------------------------------------------------------------------
 * A regra que não pode ser afrouxada aqui
 * ---------------------------------------------------------------------------
 * O contato nasce SEM telefone e SEM e-mail. O painel de contato do Chatwoot
 * mostra a ficha inteira para qualquer agente da inbox, e a equipe FrioHub usa
 * o painel de verdade — mandar o telefone na criação anularia o duplo
 * consentimento que /privacidade 4.1 promete. Quem libera é
 * `pii_liberado_para_chatwoot()`, que exige handoff + os dois consentimentos.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { chatwoot, plataforma, MARKETPLACE_INBOX_ID } from "./chatwoot.ts";

export type Identidade = {
  profile_id: string;
  chatwoot_contact_id: number | null;
  chatwoot_user_id: number | null;
};

export async function identidade(db: SupabaseClient, profileId: string): Promise<Identidade | null> {
  const { data } = await db
    .from("chatwoot_identities")
    .select("profile_id, chatwoot_contact_id, chatwoot_user_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  return (data as Identidade | null) ?? null;
}

async function registrar(
  db: SupabaseClient,
  profileId: string,
  contactId: number | null,
  userId: number | null,
) {
  const { error } = await db.rpc("registrar_identidade_chatwoot", {
    p_profile_id: profileId,
    p_contact_id: contactId,
    p_user_id: userId,
  });
  if (error) throw new Error(`registrar_identidade_chatwoot: ${error.message}`);
}

type PerfilFrioHub = {
  id: string;
  nome: string;
  role: string;
};

async function perfil(db: SupabaseClient, profileId: string): Promise<PerfilFrioHub> {
  const { data, error } = await db
    .from("profiles")
    .select("id, nome, role")
    .eq("id", profileId)
    .single();
  if (error || !data) throw new Error(`perfil ${profileId} não encontrado`);
  return data as PerfilFrioHub;
}

/* Os atributos que as automações de roteamento leem. `friohub_jornada` é o que
   decide a régua, então precisa refletir o estado real e não um chute. */
async function atributosDoContato(
  db: SupabaseClient,
  p: PerfilFrioHub,
): Promise<Record<string, string>> {
  const atributos: Record<string, string> = {
    friohub_profile_id: p.id,
    friohub_papel: p.role === "profissional" || p.role === "distribuidora" || p.role === "cliente"
      ? p.role
      : "visitante",
    friohub_jornada: "ativo",
  };

  if (p.role === "profissional") {
    const { data } = await db
      .from("professionals")
      .select("verification_status, subscription_status, cidade")
      .eq("id", p.id)
      .maybeSingle();

    const pro = data as
      | { verification_status: string; subscription_status: string; cidade: string }
      | null;

    if (pro) {
      atributos.friohub_verificacao = pro.verification_status;
      atributos.friohub_plano = pro.subscription_status;
      atributos.friohub_cidade = pro.cidade ?? "";
      /* Técnico que ainda não passou pela verificação está em cadastro, e a
         régua dele é Onboarding — não Pós-venda. */
      atributos.friohub_jornada =
        pro.verification_status === "verificado" ? "ativo" : "cadastro";
    }
  }

  return atributos;
}

export async function garantirContato(db: SupabaseClient, profileId: string): Promise<number> {
  const atual = await identidade(db, profileId);
  if (atual?.chatwoot_contact_id) return atual.chatwoot_contact_id;

  const p = await perfil(db, profileId);
  const custom_attributes = await atributosDoContato(db, p);

  /* `identifier` é único por conta no Chatwoot, então o profile_id é a chave
     natural. Se o contato já existir (provisionado por outro caminho), o
     Chatwoot devolve 422 e a busca por identifier resolve. */
  let contactId: number | null = null;
  try {
    const criado = await chatwoot("POST", "/contacts", {
      identifier: profileId,
      name: p.nome,
      inbox_id: MARKETPLACE_INBOX_ID || undefined,
      custom_attributes,
    });
    contactId = criado?.payload?.contact?.id ?? null;
  } catch (erro) {
    const encontrado = await chatwoot(
      "GET",
      `/contacts/search?q=${encodeURIComponent(profileId)}`,
    );
    contactId =
      (encontrado?.payload as Array<{ id: number; identifier: string }> | undefined)?.find(
        (c) => c.identifier === profileId,
      )?.id ?? null;
    if (!contactId) throw erro;
  }

  if (!contactId) throw new Error(`Chatwoot não devolveu id de contato para ${profileId}`);
  await registrar(db, profileId, contactId, null);
  return contactId;
}

/* O usuário do profissional.
 *
 * Pela Platform API, e não por `POST /agents`, por um motivo concreto: o
 * AgentBuilder cria o usuário sem confirmar e `User` tem `devise :confirmable`,
 * então cada técnico cadastrado receberia um "confirme sua conta Chatwoot".
 * `POST /platform/api/v1/users` chama `skip_confirmation!` e não manda e-mail.
 *
 * O usuário entra na conta como `agent` e NÃO é adicionado a inbox nenhuma:
 * `User#assigned_inboxes` devolve vazio para não-admin, então mesmo que
 * conseguisse logar (não consegue — senha aleatória, sem confirmação) veria
 * zero conversas. Ele existe só para ser `assignee`.
 */
export async function garantirUsuario(db: SupabaseClient, profileId: string): Promise<number> {
  const atual = await identidade(db, profileId);
  if (atual?.chatwoot_user_id) return atual.chatwoot_user_id;

  const p = await perfil(db, profileId);

  /* E-mail só existe em `auth.users` — nenhuma tabela de `public` guarda.
     Por isso a Admin API, e não um select. */
  const { data: authUser, error: erroAuth } = await db.auth.admin.getUserById(profileId);
  if (erroAuth || !authUser?.user?.email) {
    throw new Error(`sem e-mail em auth.users para ${profileId}`);
  }

  const senha = `Fh-${crypto.randomUUID()}-9a!`;
  let userId: number | null = null;

  try {
    const criado = await plataforma("POST", "/users", {
      name: p.nome,
      email: authUser.user.email,
      password: senha,
      custom_attributes: { friohub_profile_id: profileId },
    });
    userId = criado?.id ?? null;
  } catch (erro) {
    /* `User.from_email` já devolve o existente na criação, então 422 aqui é
       outra coisa — vale propagar em vez de mascarar. */
    throw new Error(
      `falha ao criar usuário no Chatwoot para ${profileId}: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }

  if (!userId) throw new Error(`Chatwoot não devolveu id de usuário para ${profileId}`);

  await plataforma("POST", `/accounts/${Deno.env.get("CHATWOOT_ACCOUNT_ID")}/account_users`, {
    user_id: userId,
    role: "agent",
  });

  await registrar(db, profileId, null, userId);
  return userId;
}

export type ConversaLocal = {
  id: string;
  cliente_id: string;
  professional_id: string;
  chatwoot_conversation_id: number | null;
};

/* Devolve o `display_id` da conversa no Chatwoot — que é o identificador que a
   API aceita na URL e o que o webhook manda de volta. */
export async function garantirConversa(
  db: SupabaseClient,
  conversa: ConversaLocal,
): Promise<number> {
  if (conversa.chatwoot_conversation_id) return conversa.chatwoot_conversation_id;
  if (!MARKETPLACE_INBOX_ID) throw new Error("CHATWOOT_MARKETPLACE_INBOX_ID não configurada.");

  const contactId = await garantirContato(db, conversa.cliente_id);

  /* Atribuir ao profissional é o que faz a conversa aparecer para ele nos
     relatórios e nas automações. Ele não é membro da inbox — e não precisa
     ser: AssignmentService busca em `account.users`, sem checar membership. */
  let assigneeId: number | undefined;
  try {
    assigneeId = await garantirUsuario(db, conversa.professional_id);
  } catch (erro) {
    /* Sem o vínculo do PlatformApp com a conta (Fase 0), criar usuário falha.
       A conversa ainda assim tem que existir — fica sem dono, e um sweep
       posterior atribui. Perder a mensagem seria pior que perder a atribuição. */
    console.warn(
      `conversa ${conversa.id} ficará sem assignee: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }

  const criada = await chatwoot("POST", "/conversations", {
    inbox_id: MARKETPLACE_INBOX_ID,
    contact_id: contactId,
    assignee_id: assigneeId,
    status: "open",
    custom_attributes: {
      friohub_profissional_id: conversa.professional_id,
      friohub_contexto: "servico",
    },
  });

  const displayId = criada?.id;
  if (!displayId) throw new Error(`Chatwoot não devolveu display_id para a conversa ${conversa.id}`);

  const { error } = await db.rpc("vincular_conversa_chatwoot", {
    p_conversation_id: conversa.id,
    p_chatwoot_conversation_id: displayId,
    p_chatwoot_inbox_id: MARKETPLACE_INBOX_ID,
  });
  if (error) throw new Error(`vincular_conversa_chatwoot: ${error.message}`);

  return displayId;
}

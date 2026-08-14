import type { ItemNav } from "./PainelNav";

/* Navegação da área logada, por papel.
 *
 * Estava num ternário `isPro ? [...] : [...]` dentro do layout, o que fazia o
 * admin cair no ramo do cliente — ele via "Meus pedidos" com um link "Admin"
 * pendurado no fim. Com um papel novo entrando (distribuidora), o ternário
 * deixa de comportar.
 *
 * Regra herdada do layout e mantida: só entra aqui item cuja rota já existe.
 * Link morto na navegação principal é pior do que funcionalidade ausente.
 */
export type Papel = "cliente" | "profissional" | "distribuidora" | "admin";

export const NAV_POR_PAPEL: Record<Papel, ItemNav[]> = {
  cliente: [
    { href: "/painel", label: "Meus pedidos", icone: "servicos" },
    { href: "/painel/orcamentos", label: "Orçamentos", icone: "orcamentos" },
    { href: "/painel/pmoc", label: "PMOC", icone: "pmoc" },
    { href: "/painel/equipamentos", label: "Equipamentos", icone: "equipamentos", feature: "ux_portfolio" },
    { href: "/painel/mensagens", label: "Mensagens", icone: "mensagens" },
    { href: "/painel/financeiro", label: "Financeiro", icone: "financeiro" },
    { href: "/painel/notificacoes", label: "Notificações", icone: "notificacoes" },
    { href: "/painel/perfil-cliente", label: "Meu perfil", icone: "perfil" },
  ],
  profissional: [
    { href: "/painel", label: "Visão geral", icone: "visao" },
    /* Agenda vem cedo de propósito: é a tela que o técnico abre de manhã,
       antes de qualquer outra, para saber onde precisa estar. */
    { href: "/painel/agenda", label: "Agenda", icone: "agenda" },
    { href: "/painel/oportunidades", label: "Oportunidades", icone: "oportunidades", feature: "ux_pipeline" },
    { href: "/painel/clientes", label: "Clientes", icone: "clientes", feature: "ux_portfolio" },
    { href: "/painel/desempenho", label: "Desempenho", icone: "desempenho", feature: "ux_growth" },
    { href: "/painel/orcamentos", label: "Orçamentos", icone: "orcamentos" },
    { href: "/painel/pmoc", label: "PMOC", icone: "pmoc" },
    { href: "/painel/mensagens", label: "Mensagens", icone: "mensagens" },
    { href: "/painel/financeiro", label: "Financeiro", icone: "financeiro" },
    { href: "/painel/avaliacoes", label: "Avaliações", icone: "avaliacoes" },
    { href: "/painel/ferramentas", label: "Ferramentas", icone: "ferramentas" },
    { href: "/painel/notificacoes", label: "Notificações", icone: "notificacoes" },
    { href: "/painel/perfil", label: "Meu perfil", icone: "perfil" },
  ],
  distribuidora: [
    { href: "/painel/distribuidora", label: "Visão geral", icone: "visao" },
    { href: "/painel/distribuidora/pedidos", label: "Pedidos", icone: "orcamentos" },
    { href: "/painel/distribuidora/catalogo", label: "Catálogo", icone: "servicos" },
    { href: "/painel/notificacoes", label: "Notificações", icone: "notificacoes" },
    { href: "/painel/distribuidora/perfil", label: "Meu perfil", icone: "perfil" },
  ],
  /* O admin também é um usuário comum do lado cliente, então mantém os pedidos
     dele — mas a moderação vem primeiro, que é o motivo de ele entrar aqui. */
  admin: [
    { href: "/admin", label: "Administração", icone: "admin" },
    { href: "/painel/pmoc", label: "PMOC", icone: "pmoc" },
    { href: "/painel", label: "Meus pedidos", icone: "servicos" },
    { href: "/painel/notificacoes", label: "Notificações", icone: "notificacoes" },
    { href: "/painel/perfil-cliente", label: "Meu perfil", icone: "perfil" },
  ],
};

export const ROTULO_PAPEL: Record<Papel, string> = {
  cliente: "Cliente",
  profissional: "Parceiro",
  distribuidora: "Distribuidora",
  admin: "Administrador",
};

/** Onde o clique no avatar leva — cada papel edita o perfil num lugar diferente. */
export const HREF_PERFIL: Record<Papel, string> = {
  cliente: "/painel/perfil-cliente",
  profissional: "/painel/perfil",
  distribuidora: "/painel/distribuidora/perfil",
  admin: "/painel/perfil-cliente",
};

/** `profiles.role` vindo do banco pode ser qualquer texto; normaliza para um papel conhecido. */
export function comoPapel(role: string | null | undefined): Papel {
  return role === "profissional" || role === "admin" || role === "distribuidora" ? role : "cliente";
}

/* Navegação interna do admin — grupos temáticos em vez do hub único que
 * misturava funil, verificação de profissional, verificação de distribuidora
 * e leads na mesma página. Cada item aqui é uma rota que já existe; sem
 * grupo tem sentido próprio (dashboard sozinho), com grupo o rótulo do grupo
 * não repete o nome do item (mesma regra de bom senso do NAV_POR_PAPEL em
 * painel/navegacao.ts).
 */
export type ItemNavAdmin = { href: string; label: string; badge?: keyof BadgesAdmin };

export type BadgesAdmin = {
  profissionais: number;
  distribuidoras: number;
  leads: number;
  disputas: number;
};

export type GrupoNavAdmin = { titulo: string | null; itens: ItemNavAdmin[] };

export const GRUPOS_ADMIN: GrupoNavAdmin[] = [
  {
    titulo: null,
    itens: [{ href: "/admin", label: "Visão geral" }],
  },
  {
    titulo: "Verificação",
    itens: [
      { href: "/admin/profissionais", label: "Profissionais", badge: "profissionais" },
      { href: "/admin/distribuidoras", label: "Distribuidoras", badge: "distribuidoras" },
      { href: "/admin/leads", label: "Leads", badge: "leads" },
    ],
  },
  {
    titulo: "Operação",
    itens: [
      { href: "/admin/disputas", label: "Disputas", badge: "disputas" },
      { href: "/admin/pmoc", label: "PMOC" },
      { href: "/admin/repasses", label: "Repasses" },
    ],
  },
  {
    titulo: "Financeiro",
    itens: [
      { href: "/admin/financeiro", label: "Ledger" },
      { href: "/admin/assinaturas", label: "Assinaturas" },
    ],
  },
  {
    titulo: "Pessoas",
    itens: [
      { href: "/admin/usuarios", label: "Usuários" },
      { href: "/admin/avaliacoes", label: "Avaliações" },
    ],
  },
  {
    titulo: "Sistema",
    itens: [
      { href: "/admin/rollout", label: "Rollout" },
      { href: "/admin/saude", label: "Saúde" },
      { href: "/admin/auditoria", label: "Auditoria" },
    ],
  },
];

// Chaves de operação da plataforma.

/**
 * Se `true`, só profissionais com `verification_status = 'verificado'` aparecem
 * nas buscas do cliente.
 *
 * Desligado durante o piloto: a base é pequena e conhecida, e segurar cada
 * cadastro numa fila de aprovação manual deixaria a busca vazia — sem oferta,
 * não há o que o cliente contratar.
 *
 * O status continua sendo gravado e o painel de admin continua aprovando; o que
 * muda é só o filtro da busca. Para religar o portão, basta trocar para `true`:
 * nenhum dado precisa ser migrado, e quem já foi aprovado segue aprovado.
 *
 * Ao religar, revisar também os textos de /parceiros, que descrevem ao
 * profissional o que acontece depois do cadastro.
 */
export const EXIGIR_VERIFICACAO = false;

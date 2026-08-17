// Versão vigente dos documentos legais.
//
// Fica fora de actions.ts porque um módulo "use server" só pode exportar
// funções async — e este valor é lido também pelas páginas.
//
// Ao publicar um texto novo de Termos ou Política, altere esta data. É ela que
// fica gravada em `profile_private.termos_versao` e prova a qual texto cada
// pessoa consentiu.
// 2026-08-17.1 — atendimento omnichannel: Termos 6.1 passou a dizer que a
// conversa pode continuar por WhatsApp/e-mail/redes reunida no mesmo histórico,
// e a Política ganhou a seção 4.2 (canais de atendimento e mensagens enviadas).
// Nada no código compara a versão gravada com esta: quem se cadastrou antes
// segue com a versão antiga em `profile_private.termos_versao`. Se o time
// quiser reconsentimento, é preciso construir o fluxo — hoje ele não existe.
export const TERMOS_VERSAO = "2026-08-17.1";

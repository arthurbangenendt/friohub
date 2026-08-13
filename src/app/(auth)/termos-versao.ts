// Versão vigente dos documentos legais.
//
// Fica fora de actions.ts porque um módulo "use server" só pode exportar
// funções async — e este valor é lido também pelas páginas.
//
// Ao publicar um texto novo de Termos ou Política, altere esta data. É ela que
// fica gravada em `profile_private.termos_versao` e prova a qual texto cada
// pessoa consentiu.
export const TERMOS_VERSAO = "2026-08-12.2";

import "server-only";
import OpenAI from "openai";

// Guard `server-only` (mesmo padrão de `feature-flags.ts`): evita que a chave
// vaze por importação acidental num client component.
//
// Construção sob demanda, não no escopo do módulo: o construtor do SDK
// valida a apiKey e lança na hora — se isso rodasse ao carregar o módulo, o
// Next tentar "coletar" esta rota em build (sem OPENAI_API_KEY setada,
// ex.: antes de configurar a env var na Vercel) derrubava o build inteiro
// em vez de só a chamada falhar em runtime quando de fato invocada.
let instancia: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  instancia ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return instancia;
}

// gpt-5.6-terra: bom equilíbrio de qualidade técnica e custo para o
// assistente HVAC — conferido na tabela de preços oficial em 2026-08-27.
// Configurável por env var para trocar sem precisar mexer em código.
export const MODELO_ASSISTENTE = process.env.OPENAI_ASSISTENTE_MODEL?.trim() || "gpt-5.6-terra";

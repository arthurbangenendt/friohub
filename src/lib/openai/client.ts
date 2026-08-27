import "server-only";
import OpenAI from "openai";

// Guard `server-only` (mesmo padrão de `feature-flags.ts`): evita que a chave
// vaze por importação acidental num client component.
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// gpt-5.6-terra: bom equilíbrio de qualidade técnica e custo para o
// assistente HVAC — conferido na tabela de preços oficial em 2026-08-27.
// Configurável por env var para trocar sem precisar mexer em código.
export const MODELO_ASSISTENTE = process.env.OPENAI_ASSISTENTE_MODEL?.trim() || "gpt-5.6-terra";

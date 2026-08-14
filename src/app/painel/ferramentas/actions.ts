"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { CATEGORIA_FERRAMENTA_IDS } from "./categorias";

type NovaFerramenta = {
  nome: string;
  categoria: string;
  marca: string;
  modelo: string;
  observacoes: string;
  quantidade: number;
  valor: number | null;
  data: string;
};

function dataValida(valor: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T12:00:00`));
}

export async function registrarFerramenta(input: NovaFerramenta) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "profissional") {
    return { ok: false as const, error: "Apenas profissionais podem cadastrar ferramentas." };
  }

  const nome = input.nome.trim();
  const marca = input.marca.trim();
  const modelo = input.modelo.trim();
  const observacoes = input.observacoes.trim();
  if (nome.length < 2 || nome.length > 80) {
    return { ok: false as const, error: "Informe um nome entre 2 e 80 caracteres." };
  }
  if (!CATEGORIA_FERRAMENTA_IDS.includes(input.categoria)) {
    return { ok: false as const, error: "Categoria inválida." };
  }
  if (!Number.isInteger(input.quantidade) || input.quantidade < 1 || input.quantidade > 999) {
    return { ok: false as const, error: "A quantidade deve estar entre 1 e 999." };
  }
  if (marca.length > 60 || modelo.length > 60 || observacoes.length > 240) {
    return { ok: false as const, error: "Marca, modelo ou observações excedem o tamanho permitido." };
  }
  if (input.valor !== null && (!Number.isFinite(input.valor) || input.valor <= 0 || input.valor > 99_999_999.99)) {
    return { ok: false as const, error: "O valor precisa ser maior que zero." };
  }
  if (!dataValida(input.data)) {
    return { ok: false as const, error: "Informe uma data válida." };
  }

  /* O trigger do banco cria a despesa antes de concluir este INSERT. É uma só
     transação: ou ferramenta e despesa são salvas juntas, ou nada é salvo. */
  const { error } = await supabase.from("professional_tools").insert({
    professional_id: user.id,
    name: nome,
    category: input.categoria,
    brand: marca || null,
    model: modelo || null,
    notes: observacoes || null,
    quantity: input.quantidade,
    purchase_price: input.valor,
    acquired_on: input.data,
  });
  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return {
        ok: false as const,
        error: "O banco de dados ainda não recebeu a atualização de ferramentas.",
      };
    }
    if (error.code === "42501") {
      return {
        ok: false as const,
        error: "Seu usuário não tem permissão para cadastrar ferramentas.",
      };
    }
    return {
      ok: false as const,
      error: `Não foi possível salvar a ferramenta (código ${error.code || "desconhecido"}).`,
    };
  }

  revalidatePath("/painel/ferramentas");
  if (input.valor !== null) revalidatePath("/painel/financeiro");
  return { ok: true as const, expenseCreated: input.valor !== null };
}

export async function removerFerramenta(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Não autenticado." };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false as const, error: "Ferramenta inválida." };

  const { error } = await supabase
    .from("professional_tools")
    .delete()
    .eq("id", id)
    .eq("professional_id", user.id);
  if (error) return { ok: false as const, error: "Não foi possível remover a ferramenta." };

  // A despesa vinculada é histórico contábil e permanece no Financeiro.
  revalidatePath("/painel/ferramentas");
  return { ok: true as const };
}

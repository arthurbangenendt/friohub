import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { comoPeriodo, janela, rotuloPeriodo } from "../periodo";

/* Exportação do financeiro em CSV.
 *
 * É Route Handler, e não Server Action, porque o resultado é um arquivo: o
 * navegador precisa de uma resposta com `Content-Disposition`, o que uma action
 * não devolve. Assim o botão é um link comum — funciona com clique do meio,
 * "salvar como" e sem JavaScript.
 *
 * Público-alvo real: o contador. Por isso o separador é ponto e vírgula e o
 * decimal é vírgula — é o que o Excel em português entende sem pedir para
 * importar coluna a coluna.
 */

/** Escapa um campo para CSV. Aspas dobram; qualquer campo com separador, aspas
 *  ou quebra de linha é envolvido — sem isso, uma descrição de despesa com
 *  ponto e vírgula desloca todas as colunas seguintes. */
function campo(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const linha = (celulas: unknown[]) => celulas.map(campo).join(";");
const moeda = (n: number) => n.toFixed(2).replace(".", ",");
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Não autenticado.", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  /* A exportação existe para a contabilidade do profissional. O cliente tem o
     próprio histórico na tela, sem comissão nem despesa para declarar. */
  if (profile?.role !== "profissional") return new Response("Disponível apenas para profissionais.", { status: 403 });

  const periodo = comoPeriodo(request.nextUrl.searchParams.get("p"));
  const { inicio, fim } = janela(periodo);

  const [{ data: orders }, { data: despesas }, { data: jobs }] = await Promise.all([
    supabase
      .from("orders")
      .select("job_id, preco_servico, comissao_servico, total, payment_status, created_at")
      .gte("created_at", inicio).lt("created_at", fim)
      .order("created_at"),
    supabase
      .from("expenses")
      .select("data, categoria, descricao, valor, job_id")
      .gte("data", inicio.slice(0, 10)).lt("data", fim.slice(0, 10))
      .order("data"),
    supabase
      .from("jobs")
      .select("id, job_type, status")
      .gte("created_at", inicio).lt("created_at", fim),
  ]);

  const tipoPorJob = new Map((jobs ?? []).map((j) => [j.id, j.job_type]));

  const linhas: string[] = [];

  linhas.push(linha(["RECEITAS"]));
  linhas.push(linha(["Data", "Serviço", "Tipo", "Bruto", "Comissão", "Líquido", "Situação"]));
  for (const o of orders ?? []) {
    const liquido = Number(o.preco_servico) - Number(o.comissao_servico ?? 0);
    linhas.push(linha([
      dia(o.created_at),
      o.job_id.slice(0, 8),
      tipoPorJob.get(o.job_id) ?? "",
      moeda(Number(o.preco_servico)),
      moeda(Number(o.comissao_servico ?? 0)),
      moeda(liquido),
      o.payment_status,
    ]));
  }

  linhas.push("");
  linhas.push(linha(["DESPESAS"]));
  linhas.push(linha(["Data", "Categoria", "Descrição", "Serviço vinculado", "Valor"]));
  for (const d of despesas ?? []) {
    linhas.push(linha([
      dia(d.data),
      d.categoria,
      d.descricao ?? "",
      d.job_id ? d.job_id.slice(0, 8) : "",
      moeda(Number(d.valor)),
    ]));
  }

  /* O resumo repete só o que é liquidado. Somar pendente aqui produziria um
     total que não bate com extrato nenhum. */
  const pagos = (orders ?? []).filter((o) => o.payment_status === "pago");
  const bruto = pagos.reduce((s, o) => s + Number(o.preco_servico), 0);
  const comissao = pagos.reduce((s, o) => s + Number(o.comissao_servico ?? 0), 0);
  const gasto = (despesas ?? []).reduce((s, d) => s + Number(d.valor), 0);

  linhas.push("");
  linhas.push(linha(["RESUMO — considera apenas pagamentos liquidados"]));
  linhas.push(linha(["Período", rotuloPeriodo(periodo)]));
  linhas.push(linha(["Recebido bruto", moeda(bruto)]));
  linhas.push(linha(["Comissão FrioHub", moeda(comissao)]));
  linhas.push(linha(["Despesas", moeda(gasto)]));
  linhas.push(linha(["Resultado", moeda(bruto - comissao - gasto)]));

  /* BOM no início: sem ele o Excel no Windows lê o arquivo como Latin-1 e
     "Comissão" vira "ComissÃ£o". */
  const corpo = "﻿" + linhas.join("\r\n");
  const arquivo = `friohub-financeiro-${periodo}-${inicio.slice(0, 10)}.csv`;

  return new Response(corpo, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${arquivo}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

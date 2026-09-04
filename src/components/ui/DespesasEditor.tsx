"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { WeeklyExpenseCard, type ExpenseItem } from "@/components/ui/card-20";
import { formatarBRL } from "@/lib/pricing";

export type Despesa = {
  id: string;
  vinculoId: string | null;
  categoria: string;
  descricao: string | null;
  valor: number;
  data: string;
};

export type ItemParaVinculo = { id: string; label: string };

type Resultado = { ok: true } | { ok: false; error: string };

const CORES = ["var(--chart-1)", "var(--chart-2)", "var(--good)", "var(--warning)"];
const inputClass = "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--cool)] focus:ring-2 focus:ring-[var(--cool-wash)]";
const labelClass = "flex flex-col gap-1.5 text-xs font-bold text-[var(--ink-soft)]";

function hojeLocal() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function moedaParaNumero(valor: string) {
  const limpo = valor.trim().replace(/\s/g, "");
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  return Number(normalizado);
}

function resumirCategorias(lista: Despesa[], label: Record<string, string>): ExpenseItem[] {
  const totais = new Map<string, number>();
  for (const item of lista) totais.set(item.categoria, (totais.get(item.categoria) ?? 0) + item.valor);
  const ordenadas = [...totais.entries()].sort((a, b) => b[1] - a[1]);
  const principais: ExpenseItem[] = ordenadas.slice(0, 3).map(([categoria, amount], index) => ({
    category: label[categoria] ?? categoria,
    amount,
    color: CORES[index],
  }));
  const restante = ordenadas.slice(3).reduce((soma, [, valor]) => soma + valor, 0);
  if (restante > 0) principais.push({ category: "Outras", amount: restante, color: CORES[3] });
  return principais;
}

/* Editor de despesas genérico — usado pelo técnico (vincula a um serviço) e
   pela distribuidora (vincula a um pedido). O que muda entre os dois é a
   lista de categorias, as server actions e o vocabulário do "vínculo"; toda a
   UI (resumo por categoria, formulário, lista animada) é compartilhada para
   não ter duas versões divergindo em bugfix. */
export function DespesasEditor({
  inicial: lista,
  periodo,
  categorias,
  itensVinculo,
  vinculoLabel,
  vinculoPlaceholder,
  vinculoDica,
  registrar,
  remover,
}: {
  inicial: Despesa[];
  periodo: string;
  categorias: readonly { id: string; label: string }[];
  itensVinculo: ItemParaVinculo[];
  vinculoLabel: string;
  vinculoPlaceholder: string;
  vinculoDica: string;
  registrar: (input: { categoria: string; descricao: string; valor: number; data: string; vinculoId: string | null }) => Promise<Resultado>;
  remover: (id: string) => Promise<Resultado>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null);
  const categoriaRef = useRef<HTMLSelectElement>(null);
  const [categoria, setCategoria] = useState<string>(categorias[0]?.id ?? "outros");
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hojeLocal);
  const [vinculoId, setVinculoId] = useState("");
  const [pending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const label = useMemo(() => Object.fromEntries(categorias.map((c) => [c.id, c.label])), [categorias]);
  const resumo = useMemo(() => resumirCategorias(lista, label), [lista, label]);
  const itemPorId = useMemo(
    () => new Map(itensVinculo.map((item) => [item.id, item.label])),
    [itensVinculo],
  );

  const valorNum = moedaParaNumero(valor);
  const podeSalvar = valor.trim().length > 0 && valorNum > 0 && Number.isFinite(valorNum) && !pending;

  function irParaFormulario() {
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => categoriaRef.current?.focus(), 350);
  }

  function salvar() {
    setErro(null);
    setSucesso(null);
    startTransition(async () => {
      const resposta = await registrar({
        categoria,
        descricao,
        valor: valorNum,
        data,
        vinculoId: vinculoId || null,
      });
      if (!resposta.ok) {
        setErro(resposta.error);
        return;
      }
      setDescricao("");
      setValor("");
      setVinculoId("");
      setSucesso(
        vinculoId
          ? "Despesa registrada e vinculada."
          : "Despesa geral registrada no resultado do período.",
      );
      router.refresh();
    });
  }

  function apagar(item: Despesa) {
    if (!window.confirm(`Remover a despesa de ${formatarBRL(item.valor)}? O histórico financeiro será atualizado.`)) return;
    setErro(null);
    setSucesso(null);
    startTransition(async () => {
      const resposta = await remover(item.id);
      if (!resposta.ok) {
        setErro(resposta.error);
        return;
      }
      setSucesso("Despesa removida.");
      router.refresh();
    });
  }

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
      <WeeklyExpenseCard
        title="Despesas do período"
        dateRange={periodo}
        data={resumo}
        buttonText="Nova despesa"
        onButtonClick={irParaFormulario}
      />

      <div className="min-w-0">
        <div ref={formRef} className="rounded-2xl border border-[var(--line)] bg-[var(--bg-subtle)] p-4 sm:p-5">
          <div className="mb-4">
            <h3 className="text-lg font-extrabold text-[var(--ink)]">Registrar outra despesa</h3>
            <p className="mt-1 text-sm text-[var(--ink-faint)]">Registre os custos da operação neste período.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Categoria
              <select ref={categoriaRef} value={categoria} onChange={(e) => setCategoria(e.target.value)} className={inputClass}>
                {categorias.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              Valor
              <input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" placeholder="R$ 0,00" className={inputClass} />
            </label>
            <label className={labelClass}>
              Data
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputClass} />
            </label>
            <label className={labelClass}>
              Descrição <span className="font-normal text-[var(--ink-faint)]">(opcional)</span>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: frete até o cliente" maxLength={180} className={inputClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              {vinculoLabel} <span className="font-normal text-[var(--ink-faint)]">(opcional)</span>
              <select value={vinculoId} onChange={(e) => setVinculoId(e.target.value)} className={inputClass}>
                <option value="">{vinculoPlaceholder}</option>
                {itensVinculo.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
              <span className="font-normal leading-5 text-[var(--ink-faint)]">{vinculoDica}</span>
            </label>
          </div>

          <button type="button" onClick={salvar} disabled={!podeSalvar} className="btn btn-primary mt-4 h-11 w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
            {pending ? "Registrando..." : "Registrar despesa"}
          </button>
        </div>

        <div aria-live="polite">
          {erro && <p className="mt-3 rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">{erro}</p>}
          {sucesso && <p className="mt-3 rounded-xl bg-[var(--good-wash)] px-4 py-3 text-sm font-semibold text-[var(--good)]">{sucesso}</p>}
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-extrabold text-[var(--ink)]">Lançamentos recentes</h3>
            <span className="text-xs font-semibold text-[var(--ink-faint)]">{lista.length} {lista.length === 1 ? "lançamento" : "lançamentos"}</span>
          </div>
          {lista.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--line)] px-5 py-8 text-center text-sm text-[var(--ink-faint)]">
              Nenhuma despesa neste período. Use o formulário acima para registrar a primeira.
            </div>
          ) : (
            <motion.div layout className="flex max-h-[430px] flex-col gap-2 overflow-y-auto pr-1">
              <AnimatePresence mode="popLayout">
                {lista.map((item, index) => (
                  <motion.article
                    layout
                    key={item.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ delay: Math.min(index * 0.025, 0.18) }}
                    className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-3"
                  >
                    <span className="hidden rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[11px] font-extrabold text-[var(--ink-soft)] sm:inline">{label[item.categoria] ?? item.categoria}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--ink)]">{item.descricao || label[item.categoria] || "Despesa"}</p>
                      <p className="text-xs text-[var(--ink-faint)]">{new Date(`${item.data}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}</p>
                      {item.vinculoId && (
                        <p className="mt-0.5 truncate text-xs font-semibold text-[var(--cool)]">
                          {itemPorId.get(item.vinculoId) ?? `#${item.vinculoId.slice(0, 8)}`}
                        </p>
                      )}
                    </div>
                    <strong className="whitespace-nowrap text-sm text-[var(--ink)]">{formatarBRL(item.valor)}</strong>
                    <button type="button" onClick={() => apagar(item)} disabled={pending} aria-label={`Remover despesa de ${formatarBRL(item.valor)}`} className="rounded-lg px-2 py-1 text-lg text-[var(--ink-faint)] transition hover:bg-[var(--danger-wash)] hover:text-[var(--danger)]">×</button>
                  </motion.article>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

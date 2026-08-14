"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { Tool } from "@/components/icons";
import { registrarFerramenta, removerFerramenta } from "./actions";
import { CATEGORIAS_FERRAMENTA } from "./categorias";

export type Ferramenta = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  notes: string | null;
  quantity: number;
  purchase_price: number | null;
  expense_id: string | null;
  acquired_on: string;
};

const LABEL = Object.fromEntries(CATEGORIAS_FERRAMENTA.map((item) => [item.id, item.label]));
const inputClass = "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--cool)] focus:ring-2 focus:ring-[var(--cool-wash)]";
const labelClass = "flex flex-col gap-1.5 text-xs font-bold text-[var(--ink-soft)]";

function hojeLocal() {
  const agora = new Date();
  const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function moedaParaNumero(valor: string) {
  const limpo = valor.trim().replace(/\s/g, "");
  if (!limpo) return null;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : Number.NaN;
}

export function FerramentasEditor({ inicial: ferramentas }: { inicial: Ferramenta[] }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(ferramentas.length === 0);
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("diagnostico");
  const [marca, setMarca] = useState("");
  const [modelo, setModelo] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hojeLocal);
  const [observacoes, setObservacoes] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const totalInvestido = useMemo(
    () => ferramentas.reduce((total, item) => total + (item.purchase_price ?? 0), 0),
    [ferramentas],
  );
  const valorNumero = moedaParaNumero(valor);
  const valorValido = valorNumero === null || (Number.isFinite(valorNumero) && valorNumero > 0);
  const podeSalvar = nome.trim().length >= 2 && valorValido && !pending;

  function limpar() {
    setNome("");
    setCategoria("diagnostico");
    setMarca("");
    setModelo("");
    setQuantidade("1");
    setValor("");
    setData(hojeLocal());
    setObservacoes("");
  }

  function salvar() {
    const preco = moedaParaNumero(valor);
    setErro(null);
    setSucesso(null);
    if (Number.isNaN(preco)) {
      setErro("Informe um valor válido ou deixe o campo vazio.");
      return;
    }
    startTransition(async () => {
      const resposta = await registrarFerramenta({
        nome,
        categoria,
        marca,
        modelo,
        observacoes,
        quantidade: Number(quantidade),
        valor: preco,
        data,
      });
      if (!resposta.ok) {
        setErro(resposta.error);
        return;
      }
      limpar();
      setAberto(false);
      setSucesso(
        resposta.expenseCreated
          ? "Ferramenta salva e despesa enviada ao Financeiro."
          : "Ferramenta salva sem gerar despesa.",
      );
      router.refresh();
    });
  }

  function remover(item: Ferramenta) {
    const aviso = item.expense_id
      ? "Remover esta ferramenta do inventário? A despesa já lançada continuará no Financeiro."
      : "Remover esta ferramenta do inventário?";
    if (!window.confirm(aviso)) return;
    setErro(null);
    setSucesso(null);
    startTransition(async () => {
      const resposta = await removerFerramenta(item.id);
      if (!resposta.ok) {
        setErro(resposta.error);
        return;
      }
      setSucesso("Ferramenta removida do inventário.");
      router.refresh();
    });
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-sm)]">
      <div className="grid gap-5 bg-[linear-gradient(135deg,var(--brand-ink),#0d5268)] p-6 text-white sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <span className="text-xs font-bold uppercase tracking-[.16em] text-[#9ed7e6]">Inventário de campo</span>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">Seu kit de trabalho em um só lugar</h2>
          <p className="mt-1 max-w-xl text-sm text-[#d6e9ee]">
            Informe o valor apenas quando quiser que a compra entre automaticamente como despesa.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { setAberto((valorAtual) => !valorAtual); setErro(null); }}
          aria-expanded={aberto}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-extrabold text-[var(--brand-ink)] transition hover:-translate-y-0.5 hover:shadow-lg"
        >
          <span aria-hidden="true" className="text-xl leading-none">{aberto ? "×" : "+"}</span>
          {aberto ? "Fechar cadastro" : "Registrar ferramenta"}
        </button>
      </div>

      <div className="grid grid-cols-3 border-b border-[var(--line)] bg-[var(--surface)]">
        <Resumo label="Itens cadastrados" valor={String(ferramentas.reduce((soma, item) => soma + item.quantity, 0))} />
        <Resumo label="Tipos de ferramenta" valor={String(ferramentas.length)} />
        <Resumo label="Investimento informado" valor={formatarBRL(totalInvestido)} />
      </div>

      <AnimatePresence initial={false}>
        {aberto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="border-b border-[var(--line)] bg-[var(--bg-subtle)] p-5 sm:p-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className={`${labelClass} sm:col-span-2`}>
                  Nome da ferramenta <span className="sr-only">obrigatório</span>
                  <input className={inputClass} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Bomba de vácuo 12 CFM" maxLength={80} />
                </label>
                <label className={labelClass}>
                  Categoria
                  <select className={inputClass} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                    {CATEGORIAS_FERRAMENTA.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label className={labelClass}>
                  Quantidade
                  <input className={inputClass} type="number" min="1" max="999" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
                </label>
                <label className={labelClass}>
                  Marca <span className="font-normal text-[var(--ink-faint)]">(opcional)</span>
                  <input className={inputClass} value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ex.: Suryha" maxLength={60} />
                </label>
                <label className={labelClass}>
                  Modelo <span className="font-normal text-[var(--ink-faint)]">(opcional)</span>
                  <input className={inputClass} value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Ex.: Prime 12" maxLength={60} />
                </label>
                <label className={labelClass}>
                  Data da compra
                  <input className={inputClass} type="date" value={data} onChange={(e) => setData(e.target.value)} />
                </label>
                <label className={labelClass}>
                  Valor pago <span className="font-normal text-[var(--ink-faint)]">(opcional)</span>
                  <input className={inputClass} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$ 0,00" />
                </label>
                <label className={`${labelClass} sm:col-span-2 lg:col-span-4`}>
                  Observações <span className="font-normal text-[var(--ink-faint)]">(opcional)</span>
                  <textarea className={`${inputClass} min-h-20 resize-y py-3`} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} placeholder="Estado, número de série ou lembrete de manutenção" maxLength={240} />
                </label>
              </div>

              <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cool-wash)] text-[var(--cool)]" aria-hidden="true">R$</span>
                  <p className="m-0 text-sm leading-5 text-[var(--ink-soft)]">
                    <strong className="block text-[var(--ink)]">Integração automática com o Financeiro</strong>
                    Com valor: gera uma despesa. Sem valor: salva somente no inventário.
                  </p>
                </div>
                <button type="button" onClick={salvar} disabled={!podeSalvar} className="btn btn-primary h-11 disabled:cursor-not-allowed disabled:opacity-50">
                  {pending ? "Salvando..." : valor.trim() ? "Salvar e lançar despesa" : "Salvar ferramenta"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="p-5 sm:p-6">
        <div aria-live="polite">
          {erro && <p className="mb-4 rounded-xl bg-[var(--danger-wash)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">{erro}</p>}
          {sucesso && <p className="mb-4 rounded-xl bg-[var(--good-wash)] px-4 py-3 text-sm font-semibold text-[var(--good)]">{sucesso}</p>}
        </div>

        {ferramentas.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center rounded-2xl border border-dashed border-[var(--line)] px-5 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--cool-wash)] text-[var(--cool)]"><Tool size={28} /></span>
            <h3 className="mt-4 text-lg font-extrabold">Seu inventário começa aqui</h3>
            <p className="mt-1 max-w-md text-sm text-[var(--ink-faint)]">Cadastre bomba de vácuo, manifold, multímetro, escada e tudo o que acompanha você nos atendimentos.</p>
          </motion.div>
        ) : (
          <motion.div layout className="grid gap-3 sm:grid-cols-2">
            <AnimatePresence mode="popLayout">
              {ferramentas.map((item, index) => (
                <motion.article
                  layout
                  key={item.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ delay: Math.min(index * 0.04, 0.24) }}
                  className="group rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--cool)] hover:shadow-[var(--shadow-md)]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--cool-wash)] text-[var(--cool)]"><Tool size={20} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-extrabold uppercase tracking-[.1em] text-[var(--cool)]">{LABEL[item.category] ?? item.category}</span>
                          <h3 className="mt-0.5 truncate text-base font-extrabold text-[var(--ink)]">{item.name}</h3>
                        </div>
                        <button type="button" onClick={() => remover(item)} disabled={pending} aria-label={`Remover ${item.name}`} className="rounded-lg px-2 py-1 text-lg text-[var(--ink-faint)] transition hover:bg-[var(--danger-wash)] hover:text-[var(--danger)]">×</button>
                      </div>
                      {(item.brand || item.model) && <p className="mt-1 truncate text-sm text-[var(--ink-soft)]">{[item.brand, item.model].filter(Boolean).join(" · ")}</p>}
                    </div>
                  </div>
                  {item.notes && <p className="mt-3 line-clamp-2 text-sm text-[var(--ink-faint)]">{item.notes}</p>}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line-soft)] pt-3 text-xs">
                    <span className="font-semibold text-[var(--ink-soft)]">Qtd. {item.quantity}</span>
                    {item.purchase_price === null ? (
                      <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 font-bold text-[var(--ink-faint)]">Sem despesa</span>
                    ) : item.expense_id ? (
                      <Link href="/painel/financeiro" className="rounded-full bg-[var(--good-wash)] px-2.5 py-1 font-bold text-[var(--good)]">{formatarBRL(item.purchase_price)} · No financeiro</Link>
                    ) : (
                      <span className="rounded-full bg-[var(--warning-wash)] px-2.5 py-1 font-bold text-[var(--warning)]">Despesa removida</span>
                    )}
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </section>
  );
}

function Resumo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="min-w-0 border-r border-[var(--line)] px-3 py-4 text-center last:border-r-0 sm:px-5">
      <strong className="block truncate text-base font-extrabold text-[var(--ink)] sm:text-lg">{valor}</strong>
      <span className="mt-0.5 block text-[10px] font-bold uppercase leading-4 tracking-[.06em] text-[var(--ink-faint)] sm:text-xs">{label}</span>
    </div>
  );
}

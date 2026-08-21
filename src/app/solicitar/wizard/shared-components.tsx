import Link from "next/link";
import { calcularBtu, formatarBtu } from "@/lib/btu";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { MapPin } from "@/components/icons";
import type { AmbienteForm, GeoState, StepId } from "./types";
import { AMBIENTES, STEP_LABEL, mono } from "./constants";
import {
  avisoBox, btnGhost, btnPrimary, btnRemover, btuBox, cardBtn, cartaoAmbiente,
  grid2, hint, input, labelTxt, prodCardSel, selo,
} from "./styles";

export function Shell({ children, geo }: { children: React.ReactNode; geo: GeoState }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px 80px" }}>
      <Link href="/painel" style={{ fontFamily: mono, fontSize: 13, color: "var(--ink-faint)", textDecoration: "none" }}>← Painel</Link>
      <GeoBanner geo={geo} />
      <div style={{ marginTop: 20 }}>{children}</div>
    </main>
  );
}

// Painel de análise ao vivo: mostra COMO a capacidade foi calculada, em vez de
// só cuspir o número. `btu.detalhe` já existia em lib/btu e não era exibido.
export function AnaliseBtu({ btu }: { btu: ReturnType<typeof calcularBtu> }) {
  return (
    <div style={btuBox}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontFamily: mono, color: "var(--ink-faint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Capacidade recomendada</div>
          <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--cool-deep)" }}>{formatarBtu(btu.btuRecomendado)}</div>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--ink-faint)", maxWidth: 220, textAlign: "right" }}>
          Cálculo assistivo. O profissional confirma na visita.
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 12, display: "flex", flexDirection: "column", gap: 5 }}>
        {btu.detalhe.map((d) => (
          <div key={d.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: "var(--ink-soft)" }}>
            <span>{d.label}</span>
            <span style={{ fontFamily: mono }}>+{d.valor.toLocaleString("pt-BR")}</span>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700, color: "var(--ink)", marginTop: 3 }}>
          <span>Carga térmica estimada</span>
          <span style={{ fontFamily: mono }}>{btu.btuCalculado.toLocaleString("pt-BR")} BTU/h</span>
        </div>
      </div>
    </div>
  );
}

/* Um cômodo do pedido. Cada cartão é auto-contido: nome, carga térmica e
   quantidade. Manter tudo de um ambiente junto é o que permite o cliente
   revisar a sala sem perder de vista o que respondeu para o quarto. */
export function CartaoAmbiente({ indice, ambiente, btu, podeRemover, onAlterar, onRemover }: {
  indice: number;
  ambiente: AmbienteForm;
  btu: ReturnType<typeof calcularBtu>;
  podeRemover: boolean;
  onAlterar: (mudanca: Partial<AmbienteForm>) => void;
  onRemover: () => void;
}) {
  return (
    <div style={cartaoAmbiente}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <span style={selo}>{indice + 1}</span>
        <input
          value={ambiente.nome}
          onChange={(e) => onAlterar({ nome: e.target.value })}
          list={`comodos-${ambiente.chave}`}
          placeholder="Ex.: Quarto do casal"
          aria-label={`Nome do ambiente ${indice + 1}`}
          style={{ ...input, flex: 1, fontWeight: 600 }}
        />
        <datalist id={`comodos-${ambiente.chave}`}>
          {AMBIENTES.map((a) => <option key={a} value={a} />)}
        </datalist>
        {podeRemover && (
          <button type="button" onClick={onRemover} aria-label={`Remover ${ambiente.nome || "ambiente"}`}
            title="Remover este ambiente" style={btnRemover}>
            Remover
          </button>
        )}
      </div>

      <div style={grid2}>
        <Campo label={`Área: ${ambiente.areaM2} m²`}>
          <input type="range" min={6} max={120} value={ambiente.areaM2}
            onChange={(e) => onAlterar({ areaM2: +e.target.value })} style={{ width: "100%" }} />
        </Campo>
        <Campo label={`Pessoas no ambiente: ${ambiente.numPessoas}`}>
          <input type="range" min={1} max={20} value={ambiente.numPessoas}
            onChange={(e) => onAlterar({ numPessoas: +e.target.value })} style={{ width: "100%" }} />
        </Campo>
        <Campo label={`Eletrônicos que esquentam: ${ambiente.eletronicos}`}>
          <input type="range" min={0} max={10} value={ambiente.eletronicos}
            onChange={(e) => onAlterar({ eletronicos: +e.target.value })} style={{ width: "100%" }} />
          <span style={hint}>TV, computador, forno, geladeira no mesmo ambiente.</span>
        </Campo>
        <Campo label="Aparelhos neste ambiente">
          <input type="number" min={1} max={20} value={ambiente.quantidade}
            onChange={(e) => onAlterar({ quantidade: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
            style={input} />
          <span style={hint}>Salão grande às vezes pede dois aparelhos.</span>
        </Campo>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "4px 0 14px" }}>
        <Check label="O ambiente pega muito sol" checked={ambiente.insolacaoAlta}
          onChange={(v) => onAlterar({ insolacaoAlta: v })} />
        <Check label="Último andar / laje exposta" checked={ambiente.andarOuTelhado}
          onChange={(v) => onAlterar({ andarOuTelhado: v })} />
      </div>

      <AnaliseBtu btu={btu} />
    </div>
  );
}

export function EscolhaGrande({ titulo, desc, ativo, onClick }: { titulo: string; desc: string; ativo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ ...cardBtn, ...(ativo ? prodCardSel : {}), gap: 4 }}>
      <span style={{ fontWeight: 700, fontSize: 15.5 }}>{titulo}</span>
      <span style={{ fontSize: 13, color: "var(--ink-faint)" }}>{desc}</span>
    </button>
  );
}

export function GeoBanner({ geo }: { geo: GeoState }) {
  let texto: string, cor = "var(--ink-soft)", bg = "var(--surface-2)";
  if (geo.status === "pedindo") texto = "Detectando sua localização…";
  else if (geo.status === "coordenadas") texto = "Localização encontrada. Confirmando o CEP…";
  else if (geo.status === "ok") {
    const naArea = (geo.uf ?? "") === ESTADO;
    texto = naArea
      ? `Você está em ${geo.cidade || CIDADE}${geo.uf ? " — " + geo.uf : ""}. Sua posição pode validar o raio dos técnicos.`
      : `Você parece estar em ${geo.cidade || "outra região"}${geo.uf ? " — " + geo.uf : ""}. Atendemos ${CIDADE} — ${ESTADO}.`;
    cor = naArea ? "var(--cool-deep)" : "var(--warm)";
    bg = naArea ? "var(--cool-wash)" : "var(--warm-wash)";
  } else if (geo.status === "negado") texto = `Localização não permitida — sem problema, é só informar o CEP. Atendemos ${CIDADE} — ${ESTADO}.`;
  else if (geo.status === "idle") return null;
  else texto = `Atendemos ${CIDADE} — ${ESTADO}. Informe o CEP para confirmar a cobertura.`;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 16, padding: "10px 14px", borderRadius: 10, background: bg, color: cor, fontSize: 13.5 }}>
      <MapPin size={16} /> {texto}
    </div>
  );
}

export function Progress({ steps, current, onIr, podeIr }: {
  steps: StepId[];
  current: number;
  onIr: (i: number) => void;
  podeIr: (i: number) => boolean;
}) {
  return (
    <nav aria-label="Etapas do pedido" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 28 }}>
      {steps.map((s, i) => {
        const ativo = i === current;
        const concluido = i < current;
        const habilitado = !ativo && podeIr(i);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onIr(i)}
            disabled={!habilitado}
            aria-current={ativo ? "step" : undefined}
            title={habilitado
              ? `Ir para ${STEP_LABEL[s]}`
              : ativo ? undefined : "Responda as etapas anteriores para chegar aqui"}
            style={{
              fontFamily: mono, fontSize: 11.5, padding: "4px 10px", borderRadius: 100,
              background: ativo ? "var(--cool)" : concluido ? "var(--cool-wash)" : "var(--surface-2)",
              color: ativo ? "#fff" : concluido ? "var(--cool-deep)" : "var(--ink-faint)",
              border: "1px solid var(--line)",
              cursor: habilitado ? "pointer" : ativo ? "default" : "not-allowed",
              opacity: habilitado || ativo ? 1 : 0.7,
            }}
          >{i + 1}. {STEP_LABEL[s]}</button>
        );
      })}
    </nav>
  );
}
export function H({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h1 style={{ fontSize: "1.55rem", fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 4px" }}>{titulo}</h1>
      <p style={{ color: "var(--ink-faint)", margin: 0 }}>{sub}</p>
    </div>
  );
}
export function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
      <span style={labelTxt}>{label}</span>
      {children}
    </label>
  );
}
export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, color: "var(--ink-soft)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--cool)" }} />
      {label}
    </label>
  );
}
export function Nav({ onBack, onNext, nextLabel, disabled }: { onBack: () => void; onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
      <button onClick={onBack} style={btnGhost}>Voltar</button>
      <button onClick={onNext} disabled={disabled} style={{ ...btnPrimary, flex: 1, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>{nextLabel}</button>
    </div>
  );
}
export function Aviso({ children, erro }: { children: React.ReactNode; erro?: boolean }) {
  return <div style={{ ...avisoBox, background: erro ? "var(--danger-wash)" : "var(--warm-wash)", color: erro ? "var(--danger)" : "var(--warm)" }}>{children}</div>;
}
export function LinhaResumo({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", fontSize: 14 }}>
      <span style={{ color: "var(--ink-faint)" }}>{k}</span>
      <span style={{ textAlign: "right", color: "var(--ink)" }}>{v}</span>
    </div>
  );
}

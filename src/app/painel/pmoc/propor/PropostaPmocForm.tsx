"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { proporPmoc } from "./actions";

export type ClienteOpcao = { id: string; nome: string; cep: string | null; cidade: string | null };

/* Periodicidades aceitas pelo banco (`pmoc_plans_interval_months_check`).
   Mudar aqui sem mudar o CHECK só troca um erro claro por um erro feio. */
const INTERVALOS = [
  { meses: 1, label: "Mensal" },
  { meses: 2, label: "Bimestral" },
  { meses: 3, label: "Trimestral" },
  { meses: 6, label: "Semestral" },
  { meses: 12, label: "Anual" },
];

const campo: React.CSSProperties = {
  width: "100%",
  height: 44,
  padding: "0 12px",
  borderRadius: 10,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  fontSize: 15,
};

export function PropostaPmocForm({ clientes }: { clientes: ClienteOpcao[] }) {
  const router = useRouter();
  const [enviando, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);

  const [clientId, setClientId] = useState(clientes[0]?.id ?? "");
  const [companyName, setCompanyName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [cep, setCep] = useState(clientes[0]?.cep ?? "");
  const [cidade, setCidade] = useState(clientes[0]?.cidade ?? "São Paulo");
  const [equipamentos, setEquipamentos] = useState(1);
  const [intervalo, setIntervalo] = useState(3);
  const [preco, setPreco] = useState("");
  const [data, setData] = useState("");
  const [notas, setNotas] = useState("");

  const precoNum = Number(preco.replace(",", "."));
  // Quantas visitas cabem em um ano, para o técnico ver o contrato, não a visita.
  const porAno = 12 / intervalo;
  const anual = precoNum > 0 ? precoNum * porAno : 0;

  function enviar() {
    setErro(null);
    start(async () => {
      const r = await proporPmoc({
        clientId,
        companyName,
        siteName,
        cep,
        cidade,
        equipmentCount: equipamentos,
        intervalMonths: intervalo,
        pricePerVisit: precoNum,
        firstDueDate: data,
        notes: notas,
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setPronto(true);
      router.refresh();
    });
  }

  if (clientes.length === 0) {
    return (
      <div className="card" style={{ padding: 24 }}>
        <strong style={{ display: "block", marginBottom: 6 }}>Você ainda não tem clientes atendidos.</strong>
        <span style={{ color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.6 }}>
          A proposta de PMOC só pode ser enviada a quem você já atendeu pelo FrioHub — é o que
          impede que o sistema vire canal de proposta não solicitada. Conclua um serviço com o
          cliente e a opção aparece aqui.
        </span>
      </div>
    );
  }

  if (pronto) {
    return (
      <div className="card" style={{ padding: 24, borderLeft: "4px solid var(--good)" }}>
        <strong style={{ display: "block", marginBottom: 6 }}>Proposta enviada.</strong>
        <span style={{ color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.6 }}>
          O cliente foi notificado e precisa aceitar antes de o contrato valer. Enquanto isso o
          plano fica como <em>aguardando cliente</em> e nenhuma visita é gerada.
        </span>
        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost" onClick={() => { setPronto(false); setSiteName(""); setPreco(""); setData(""); setNotas(""); }}>
            Propor outro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Campo label="Cliente">
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            const c = clientes.find((x) => x.id === e.target.value);
            if (c?.cep) setCep(c.cep);
            if (c?.cidade) setCidade(c.cidade);
          }}
          style={campo}
        >
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </Campo>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Campo label="Empresa">
          <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Padaria do Zé Ltda" style={campo} />
        </Campo>
        <Campo label="Unidade atendida">
          <input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Loja Centro" style={campo} />
        </Campo>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Campo label="CEP">
          <input value={cep} onChange={(e) => setCep(e.target.value)} placeholder="01310-100" inputMode="numeric" style={campo} />
        </Campo>
        <Campo label="Cidade">
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} style={campo} />
        </Campo>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Campo label="Equipamentos">
          <input type="number" min={1} max={10000} value={equipamentos} onChange={(e) => setEquipamentos(Number(e.target.value))} style={campo} />
        </Campo>
        <Campo label="Periodicidade">
          <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} style={campo}>
            {INTERVALOS.map((i) => (
              <option key={i.meses} value={i.meses}>{i.label}</option>
            ))}
          </select>
        </Campo>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Campo label="Valor por visita">
          <input value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="380,00" inputMode="decimal" style={campo} />
        </Campo>
        <Campo label="Primeira visita">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={campo} />
        </Campo>
      </div>

      {anual > 0 && (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-soft)" }}>
          {porAno} visita{porAno > 1 ? "s" : ""} por ano · <strong style={{ color: "var(--ink)" }}>{formatarBRL(anual)}</strong> de contrato anual
        </p>
      )}

      <Campo label="Observações técnicas (opcional)">
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={3}
          placeholder="4 splits de 12.000 e 1 cassete. Filtro trocado a cada visita."
          style={{ ...campo, height: "auto", padding: "10px 12px", resize: "vertical", fontFamily: "inherit" }}
        />
      </Campo>

      {erro && (
        <p role="alert" style={{ margin: 0, padding: "11px 14px", borderRadius: 10, background: "var(--warm-wash)", color: "var(--ink)", fontSize: 14 }}>
          {erro}
        </p>
      )}

      <button type="button" className="btn btn-primary" onClick={enviar} disabled={enviando}>
        {enviando ? "Enviando…" : "Enviar proposta ao cliente"}
      </button>
      <p style={{ margin: 0, fontSize: 12.5, color: "var(--ink-faint)", lineHeight: 1.6 }}>
        A proposta não cria contrato sozinha: o cliente precisa aceitar. Até lá nada é cobrado e
        nenhuma visita entra na sua agenda.
      </p>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-soft)" }}>{label}</span>
      {children}
    </label>
  );
}

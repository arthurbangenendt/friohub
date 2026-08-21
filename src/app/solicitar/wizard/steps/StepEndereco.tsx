import { formatarCep } from "@/lib/cep";
import { CIDADE, ESTADO } from "@/lib/regiao";
import { Aviso, Campo, H, Nav } from "../shared-components";
import { avisoBox, btnGhost, hint, input } from "../styles";
import type { CoordenadasServico, GeoState } from "../types";

export function StepEndereco({
  cep, onDigitarCep, cepStatus, cidadeCep, ufCep, bairro, onBairroChange,
  coordenadasServico, geo, geoCepDigitos, cepDigitos, onUsarLocalizacaoAtual,
  geoTemCoordenadas, onConfirmarCepDaLocalizacaoAtual, foraDaArea, disabled, onBack, onNext,
}: {
  cep: string;
  onDigitarCep: (v: string) => void;
  cepStatus: "idle" | "buscando" | "ok" | "nao";
  cidadeCep: string;
  ufCep: string;
  bairro: string;
  onBairroChange: (v: string) => void;
  coordenadasServico: CoordenadasServico | null;
  geo: GeoState;
  geoCepDigitos: string;
  cepDigitos: string;
  onUsarLocalizacaoAtual: () => void;
  geoTemCoordenadas: boolean;
  onConfirmarCepDaLocalizacaoAtual: () => void;
  foraDaArea: boolean;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo="Onde é o serviço?" sub="O endereço completo só é informado quando você aceitar uma proposta." />
      <Campo label="CEP">
        <input value={cep} onChange={(e) => onDigitarCep(e.target.value)} inputMode="numeric" placeholder="00000-000" style={input} />
        {cepStatus === "buscando" && <span style={hint}>Buscando endereço…</span>}
        {cepStatus === "nao" && <span style={{ ...hint, color: "var(--warm)" }}>CEP não encontrado. Informe o bairro abaixo.</span>}
        {cepStatus === "ok" && <span style={{ ...hint, color: "var(--good)" }}>{cidadeCep} — {ufCep}</span>}
      </Campo>
      <Campo label="Bairro"><input value={bairro} onChange={(e) => onBairroChange(e.target.value)} placeholder="Bairro" style={input} /></Campo>
      {coordenadasServico && (
        <div style={{ ...avisoBox, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
          <strong>Localização confirmada.</strong> A lista será filtrada pela distância real até a base privada de cada técnico.
        </div>
      )}
      {geo.status === "ok" && geoCepDigitos.length === 8 && geoCepDigitos !== cepDigitos && (
        <div style={{ ...avisoBox, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
          <div>Sua localização atual parece estar no CEP {formatarCep(geoCepDigitos)}. O CEP informado será usado sem GPS.</div>
          <button type="button" onClick={onUsarLocalizacaoAtual} style={{ ...btnGhost, height: 38, marginTop: 10 }}>
            Usar minha localização atual
          </button>
        </div>
      )}
      {geoTemCoordenadas && geoCepDigitos.length !== 8 && cepDigitos.length === 8 && !coordenadasServico && (
        <div style={{ ...avisoBox, background: "var(--surface-2)", color: "var(--ink-soft)" }}>
          <div>Encontramos sua posição, mas não foi possível identificar o CEP automaticamente.</div>
          <button type="button" onClick={onConfirmarCepDaLocalizacaoAtual} style={{ ...btnGhost, height: 38, marginTop: 10 }}>
            Este CEP é onde estou agora
          </button>
        </div>
      )}
      {foraDaArea && <Aviso>Este CEP fica em {ufCep}. No momento atendemos {CIDADE} — {ESTADO}. Você pode continuar, mas talvez não haja profissionais na região.</Aviso>}
      <Nav onBack={onBack} onNext={onNext} nextLabel="Buscar profissionais" disabled={disabled} />
    </>
  );
}

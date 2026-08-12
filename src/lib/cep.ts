// Utilitários de CEP (ViaCEP) e geolocalização (BigDataCloud) — client-side, sem chave.

export type CepInfo = {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
};

export function formatarCep(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

// Busca endereço a partir do CEP (ViaCEP). Retorna null se inválido/não encontrado.
export async function buscarCep(cepRaw: string): Promise<CepInfo | null> {
  const cep = cepRaw.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.erro) return null;
    return {
      cep: d.cep ?? cepRaw,
      logradouro: d.logradouro ?? "",
      bairro: d.bairro ?? "",
      cidade: d.localidade ?? "",
      uf: d.uf ?? "",
    };
  } catch {
    return null;
  }
}

export type GeoResultado =
  | { status: "ok"; cidade: string; uf: string }
  | { status: "negado" }
  | { status: "erro" }
  | { status: "indisponivel" };

// Pede a localização do navegador e faz reverse-geocode (BigDataCloud, sem chave).
export async function detectarLocalizacao(): Promise<GeoResultado> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return { status: "indisponivel" };
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const r = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=pt`,
          );
          const d = await r.json();
          const cidade = d.city || d.locality || d.localityInfo?.administrative?.[3]?.name || "";
          const uf = (d.principalSubdivisionCode || "").replace("BR-", "");
          resolve({ status: "ok", cidade, uf });
        } catch {
          resolve({ status: "erro" });
        }
      },
      () => resolve({ status: "negado" }),
      { timeout: 10000, enableHighAccuracy: false },
    );
  });
}

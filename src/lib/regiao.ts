// Uma implantação atende uma praça ativa. Os defaults mantêm o piloto local;
// produção escolhe a praça por configuração, sem espalhar cidade pelo código.
export const CIDADE = process.env.NEXT_PUBLIC_MARKETPLACE_CITY?.trim() || "São Paulo";
export const ESTADO = process.env.NEXT_PUBLIC_MARKETPLACE_STATE?.trim().toUpperCase() || "SP";
export const REGIAO_SLUG = process.env.NEXT_PUBLIC_MARKETPLACE_REGION?.trim() || "sao-paulo-sp";
export const REGIAO_LABEL = `${CIDADE} — ${ESTADO}`;

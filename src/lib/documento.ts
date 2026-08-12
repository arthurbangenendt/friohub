// Validação e formatação de CPF / CNPJ.
//
// Valida dígito verificador de verdade. Conferir só o tamanho deixa passar
// "111.111.111-11" e qualquer sequência inventada, o que suja a base logo no
// cadastro — e depois vira problema na emissão de nota fiscal.

export type TipoDocumento = "cpf" | "cnpj";

export function apenasDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

export function validarCPF(entrada: string): boolean {
  const cpf = apenasDigitos(entrada);
  if (cpf.length !== 11) return false;
  // Sequências repetidas passam no cálculo do DV, mas não são CPFs válidos.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const dv = (base: string, pesoInicial: number) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return dv(cpf.slice(0, 9), 10) === Number(cpf[9]) && dv(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

export function validarCNPJ(entrada: string): boolean {
  const cnpj = apenasDigitos(entrada);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const dv = (base: string) => {
    // Pesos do CNPJ: começam em 5 (ou 6 no segundo dígito) e voltam a 9 após o 2.
    let peso = base.length - 7;
    let soma = 0;
    for (let i = 0; i < base.length; i++) {
      soma += Number(base[i]) * peso;
      peso = peso - 1 < 2 ? 9 : peso - 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  return dv(cnpj.slice(0, 12)) === Number(cnpj[12]) && dv(cnpj.slice(0, 13)) === Number(cnpj[13]);
}

export function validarDocumento(entrada: string): boolean {
  const d = apenasDigitos(entrada);
  if (d.length === 11) return validarCPF(d);
  if (d.length === 14) return validarCNPJ(d);
  return false;
}

export function tipoDocumento(entrada: string): TipoDocumento | null {
  const d = apenasDigitos(entrada);
  if (d.length === 11) return "cpf";
  if (d.length === 14) return "cnpj";
  return null;
}

// Formata progressivamente enquanto a pessoa digita: até 11 dígitos vira CPF,
// acima disso vira CNPJ.
export function formatarDocumento(v: string): string {
  const d = apenasDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

export function formatarTelefone(v: string): string {
  const d = apenasDigitos(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

export function validarTelefone(v: string): boolean {
  const d = apenasDigitos(v);
  return d.length === 10 || d.length === 11;
}

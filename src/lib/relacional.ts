/* O PostgREST devolve um relacionamento "para um" ora como objeto, ora como
   array de um item, dependendo de como o join foi escrito. Cada tela resolvia
   isso do seu jeito — `one()` em três arquivos, `uma()` num quarto e
   `Array.isArray(x) ? x[0] : x` solto em cerca de dez lugares. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

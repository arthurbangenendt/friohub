/* Primitivos de interface.
 *
 * O FrioHub estiliza por `style={{}}` inline com variáveis CSS, e não por
 * classes utilitárias. Estes componentes seguem esse mesmo idioma de propósito:
 * a ideia não é trocar a forma de escrever o front, é parar de reimplementar as
 * mesmas seis peças em cada tela nova.
 *
 * Adoção é incremental — nada do que já existe quebra por eles existirem. A
 * regra daqui para a frente é: tela nova usa estes; tela antiga migra quando
 * for mexida por outro motivo. */
export { Skeleton, SkeletonKpi, SkeletonLinha, SkeletonPainel, SkeletonFormulario } from "./Skeleton";
export { Alert, MensagemErro } from "./Alert";
export { EmptyState } from "./EmptyState";
export { StatusPill } from "./StatusPill";
export { Campo, CampoTexto, CampoSelecao, controle } from "./Field";
export { ToastProvider, useToast } from "./Toast";
export { SecaoComIcone } from "./SecaoComIcone";

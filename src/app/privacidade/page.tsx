import { LegalShell, Secao } from "./LegalShell";
import { TERMOS_VERSAO } from "../(auth)/termos-versao";

export const metadata = { title: "Política de Privacidade — FrioHub" };

export default function PrivacidadePage() {
  return (
    <LegalShell titulo="Política de Privacidade" versao={TERMOS_VERSAO}>
      <Secao t="1. Quais dados coletamos">
        Nome, e-mail, telefone e CPF ou CNPJ no cadastro. Endereço e CEP quando você
        solicita um serviço. Dados do ambiente (área, número de pessoas, insolação)
        para calcular a capacidade recomendada. Para parceiros, também dados
        profissionais: especialidades, equipamentos que domina, região de atendimento
        e fotos de portfólio que você mesmo envia.
      </Secao>
      <Secao t="2. Para que usamos">
        Para conectar você ao profissional ou ao cliente certo, executar a solicitação
        de serviço, calcular a capacidade recomendada do equipamento, processar
        pagamentos e exibir reputação pública dos parceiros.
      </Secao>
      <Secao t="3. O que é público e o que não é">
        São públicos: nome do profissional, foto de portfólio, especialidades,
        avaliações e nota. <strong>Não são públicos</strong>: CPF ou CNPJ, telefone e
        endereço — esses ficam em armazenamento restrito, acessível apenas a você e à
        administração da plataforma. O perfil de cliente não é exibido publicamente.
      </Secao>
      <Secao t="4. Com quem compartilhamos">
        Com o profissional escolhido, os dados necessários para executar o serviço
        (nome, endereço e descrição do problema). Com distribuidoras parceiras, os
        dados necessários para entrega do equipamento. Com processadores de pagamento,
        os dados necessários para a transação. Não vendemos dados pessoais.
      </Secao>
      <Secao t="5. Por quanto tempo guardamos">
        Enquanto sua conta existir e pelo prazo exigido pela legislação fiscal e civil
        aplicável aos serviços contratados.
      </Secao>
      <Secao t="6. Seus direitos (LGPD)">
        Você pode solicitar acesso, correção, portabilidade ou exclusão dos seus dados
        pessoais, além de revogar consentimentos. Pedidos podem ser feitos pelos canais
        de atendimento informados no site.
      </Secao>
      <Secao t="7. Segurança">
        Os dados sensíveis ficam em tabelas com controle de acesso por linha, separadas
        dos dados de exibição pública. O acesso administrativo é restrito e registrado.
      </Secao>
      <Secao t="8. Cookies">
        Usamos cookies estritamente necessários para manter sua sessão autenticada.
      </Secao>
      <Secao t="9. Alterações">
        Esta política pode ser atualizada. A versão vigente e a data do seu aceite ficam
        registradas na sua conta.
      </Secao>
    </LegalShell>
  );
}

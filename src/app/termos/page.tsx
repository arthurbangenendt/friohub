import { LegalShell, Secao } from "../privacidade/LegalShell";
import { TERMOS_VERSAO } from "../(auth)/termos-versao";

export const metadata = { title: "Termos de Uso — FrioHub" };

export default function TermosPage() {
  return (
    <LegalShell titulo="Termos de Uso" versao={TERMOS_VERSAO}>
      <Secao t="1. Quem somos e o que a FrioHub faz">
        A FrioHub é uma plataforma que conecta clientes que precisam de serviços de
        climatização a profissionais e empresas que executam esses serviços, e que
        intermedeia a venda de equipamentos de distribuidoras parceiras. A FrioHub
        não executa os serviços diretamente.
      </Secao>
      <Secao t="2. Cadastro">
        Para usar a plataforma é necessário criar uma conta com dados verdadeiros,
        incluindo nome, e-mail, telefone e CPF ou CNPJ. Você é responsável por manter
        seus dados atualizados e por tudo que acontecer na sua conta.
      </Secao>
      <Secao t="3. Papel do cliente">
        O cliente solicita serviços, escolhe o profissional e é responsável por
        fornecer informações corretas sobre o ambiente e o equipamento. O cálculo de
        capacidade (BTU) oferecido pela plataforma é assistivo e não substitui a
        avaliação técnica presencial.
      </Secao>
      <Secao t="4. Papel do profissional parceiro">
        O parceiro declara possuir a qualificação técnica necessária para os serviços
        que se propõe a executar, responde tecnicamente por eles e é responsável por
        suas obrigações fiscais, trabalhistas e previdenciárias. O vínculo com a
        FrioHub é de parceria comercial, não de emprego.
      </Secao>
      <Secao t="5. Valores, comissão e pagamentos">
        Os valores de serviço e de equipamento são exibidos antes da contratação. A
        FrioHub retém uma comissão sobre o serviço intermediado, informada ao parceiro.
        As condições de repasse são descritas no painel do parceiro.
      </Secao>
      <Secao t="6. Avaliações">
        Após a conclusão, o cliente pode avaliar o profissional. As avaliações são
        públicas e organizadas por especialidade. É proibido publicar avaliação falsa
        ou ofensiva.
      </Secao>
      <Secao t="7. Cancelamento">
        Cliente e profissional podem cancelar uma solicitação antes do início da
        execução. Cancelamentos recorrentes e injustificados podem levar à suspensão
        da conta.
      </Secao>
      <Secao t="8. Limitação de responsabilidade">
        A FrioHub responde pela disponibilidade e pelo funcionamento da plataforma. A
        execução técnica do serviço é de responsabilidade do profissional contratado.
      </Secao>
      <Secao t="9. Alterações destes termos">
        Estes termos podem ser atualizados. A versão vigente e a data do seu aceite
        ficam registradas na sua conta.
      </Secao>
      <Secao t="10. Contato">
        Dúvidas sobre estes termos podem ser enviadas pelos canais de atendimento
        informados no site.
      </Secao>
    </LegalShell>
  );
}

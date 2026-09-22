# Clientes — paridade Legacy × Master-detail

## Objetivo

A tela **Clientes** passa a usar uma apresentação master-detail sem substituir o cadastro atual nem reduzir a superfície funcional. A UI existente continua sendo a fonte canônica dos handlers de busca, cadastro e edição.

## Feature flag

- `customersMasterDetailView: true`
- A flag é reversível.
- Quando desativada, o controller remove apenas os elementos adicionados pela nova UX e restaura o card/lista Legacy existente.
- O renderer Legacy permanece obrigatório durante esta fase.

## Regra de paridade

**funcionalidades depois >= funcionalidades antes**.

O Master-detail pode reorganizar densidade, hierarquia e contexto, mas não pode remover operações ou campos existentes.

| Capacidade | Legacy | Master-detail | Regra |
|---|---|---|---|
| Novo cliente | Botão `#new-customer` | Mesmo botão | Preservar handler original |
| Busca | `#customer-page-search` por nome, CPF/CNPJ e telefone | Mesmo campo + `Ctrl+K` | Não reconstruir o input |
| Lista | `data-card` + `.data-row` | Mesma lista reorganizada em grid denso | Mover DOM é permitido; reconstruir handlers não |
| Editar ficha | `[data-edit-customer]` | Botão original + atalho no painel | Painel deve delegar para o botão original |
| CPF/CNPJ | Cadastro e lista | Lista + painel | Não remover |
| Telefone | Cadastro e lista | Lista + painel | Não remover |
| E-mail | Cadastro | Painel + cadastro | Cadastro continua canônico |
| Crédito | Limite e crédito usado persistidos | Limite, usado e disponível derivados dos mesmos dados | Sem cálculo financeiro inventado |
| Endereço de entrega | Extensão `delivery-address-ui.js` no formulário | Resumo no painel + formulário completo intacto | Não substituir a extensão |
| Observações | Formulário | Resumo no painel + formulário | Não remover |
| Ativo/Inativo | Formulário | Badge de status + formulário | Persistência original |
| Última compra | Não exposta na lista | Derivada de vendas canônicas `COMPLETED` | Nunca armazenar cópia frontend |
| Histórico | Histórico global de vendas | Lista recente filtrada por `customerId` no painel | Fonte: vendas canônicas |
| Cliente → Venda | `setSaleCustomer` no checkout | Sem alteração | Fluxo permanece intacto |

## Master-detail

A lista permanece visível enquanto o cliente selecionado abre no painel lateral. O painel é **resumo operacional**, não substituto da ficha completa.

O painel apresenta:

- nome;
- CPF/CNPJ;
- telefone;
- e-mail;
- limite de crédito;
- crédito utilizado;
- crédito disponível;
- última compra;
- endereço de entrega;
- observações;
- status ativo/inativo;
- **Editar ficha**;
- **Ver histórico**.

## Histórico

`Ver histórico` usa as vendas concluídas retornadas pela API canônica e filtra por `customerId`. O painel não cria tabela paralela, não grava snapshot de compra e não recalcula vendas.

## Endereço de entrega

`delivery-address-ui.js` continua responsável por injetar e persistir CEP, logradouro, número, complemento, bairro, cidade, UF e referência no formulário `#customer-form`. O Master-detail apenas lê o endereço já persistido para exibição resumida.

## Critério para remover Legacy

Nesta etapa é proibido remover o renderer legado de Clientes. Antes de qualquer remoção futura devem existir, no mínimo:

1. testes de paridade completos;
2. validação do cadastro e edição;
3. validação do endereço de entrega;
4. validação de crédito;
5. validação do histórico;
6. validação Cliente → Venda;
7. fallback comprovado.

Até isso ocorrer, **não remover o renderer legado**.

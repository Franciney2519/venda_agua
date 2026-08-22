# HydroFlow PRD
## Problema original
SaaS para empresa que revende água, com cadastro/estoque, vendas, entregas, rotas, recebimentos e despesas por funcionário, perfis administrativo e entregador.
## Arquitetura
React + React Router + Axios no frontend; FastAPI com JWT e bcrypt; MongoDB via Motor; API prefixada em `/api`.
## Personas
- Administrador: acompanha receita, despesa, estoque, clientes e rotas.
- Entregador: consulta rotas, atualiza status e lança recebimentos/despesas.
## Requisitos principais
Perfis Admin/Entregador; entregas com rota e ordem; statuses pendente, em rota, entregue, não realizada e avaria; estoque mínimo e galões retornáveis; aprovação financeira.
## Implementado (2026-06-18)
- Login por perfil com usuários seed.
- Dashboard, entregas, estoque, financeiro e clientes com navegação responsiva.
- APIs MongoDB para dashboard, produtos, entregas, despesas e atualização de status.
- Dados iniciais de operação para demonstração.
- Editor de rotas com ordenação manual de paradas e salvamento da sequência, sem integração com mapas externos.
- Relatórios operacionais com receita, despesas, alertas de estoque e desempenho por entregador.
- Formulários validados para produtos, clientes, entregas e despesas, persistidos via API.
- Proteção para impedir acesso de entregador ao relatório administrativo.
## Implementado (2026-08-22)
- Cadastro de clientes com marca de água preferida e preço combinado por cliente (pode variar de cliente para cliente).
- Produtos com marca e custo de compra (`cost_price`) para cálculo de margem.
- Tela "Controle Diário" do entregador (rota `/controle-diario`), nos moldes do controle em planilha: ao selecionar o cliente, marca e preço vêm automaticamente do cadastro (somente leitura); o entregador só preenche quantidade, MF (troca por microfuro/avaria), comp e valores recebidos (Pix/Dinheiro). Coleção `daily_entries` no backend.
- Relatório "Lucro por cliente" em Relatórios: receita − custo (via `cost_price` do produto/marca) por cliente, no período filtrado.
## Backlog priorizado
- P0: aprovação de despesas e tela mobile dedicada do entregador.
- P1: filtros de período aplicados às consultas de relatórios.
- P1: vincular consumo do Controle Diário ao abatimento de estoque por marca.
- P2: relatórios exportáveis e notificações de estoque.

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
## Backlog priorizado
- P0: formulários completos para criar entrega, produto, cliente e despesa.
- P1: aprovação de despesas e tela mobile dedicada do entregador.
- P1: editor de rotas com ordenação de paradas e mapa.
- P2: relatórios exportáveis e notificações de estoque.
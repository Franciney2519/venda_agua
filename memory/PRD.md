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
## Backlog priorizado
- P0: aprovação de despesas e tela mobile dedicada do entregador.
- P1: filtros de período aplicados às consultas de relatórios.
- P2: relatórios exportáveis e notificações de estoque.

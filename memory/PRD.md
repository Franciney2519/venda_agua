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
- MF agora abate quantidade e valor da entrega (`billed_quantity`); COMP virou venda a prazo (15/30 dias) com `due_date` calculada a partir da data de entrega.
- Tela "Provisão de Pagamento" (admin, `/provisao`): contas a receber a prazo por vencimento, com marcação de recebido/pendente.
- Aba "Despesas do Dia" dentro do Controle Diário: entregador lança despesa (alimentação, combustível, internet, outros) sem precisar de aprovação do admin; tela mostra recebido do dia − despesas = saldo a repassar.
- Rascunhos de formulário (Controle Diário e Despesas do Dia) persistidos em `localStorage` por usuário+data, para não perder lançamento em andamento se a página recarregar.
- Ao lançar Pix, o campo Dinheiro completa automaticamente o restante do total esperado do lançamento (qtd líquida × preço − valor a prazo), e vice-versa.
- Programação de entrega deixou de ser exclusiva do admin: o entregador programa a própria entrega em "Entregas"/"Rotas" (`POST /deliveries` liberado para qualquer usuário autenticado; o campo entregador é preenchido automaticamente com o próprio nome quando quem lança não é admin).
- Cliente pode ter mais de uma marca de água preferida, cada uma com preço próprio (`customers.brands: [{brand, price}]`). Cadastro de cliente ganhou modal dedicado com linhas dinâmicas de marca/preço. No Controle Diário, se o cliente tiver mais de uma marca, o entregador escolhe qual está entregando naquele lançamento e o preço daquela marca é aplicado automaticamente.
## Implementado (2026-08-22, handoff app mobile do entregador)
- App mobile dedicado do entregador (`DriverMobileApp` em `App.js`), ativado automaticamente quando `user.role==='driver'` e viewport ≤700px (`useMediaQuery`); acima disso mantém as telas atuais (`MyRoute`/`DailyControl`/etc.) intactas, e o painel admin (≥1000px) não foi alterado visualmente.
- 5 abas: Clientes (lista + busca + progresso do dia + botão "＋ Nova entrega"), Diário (cards), Caixa (dinheiro a entregar na base), Despesas (grade de categorias, envia para aprovação), Ajustes (tema claro/escuro + escala de texto 1/1.1/1.2, ambos persistidos em `localStorage`: `hydro_theme`, `hydro_text_scale`).
- Painel de lançamento por cliente: uma linha por marca do cadastro (`customers.brands[]`), contador de galões e MF por marca (`+MF` move 1 galão de `qty` pra `mf`, nunca cobrado), "＋ Outra marca (fora do cadastro)", decisão do MF (reagendar/trocar agora/cliente não quis) quando MF>0, Pix/Dinheiro que se completam automaticamente sobre o restante (`total − a prazo`) mantendo o Pix ao recalcular, atalhos "Tudo Pix"/"Tudo dinheiro", COMP 15/30 dias, assinatura reaproveitando `SignaturePad` como está.
- Contadores usam `setState` funcional (`prev => ...`) para não perder toques rápidos.
- Backend (`server.py`): `daily_entries` aceita `items: [{brand, price, quantity, mf_quantity, out_of_catalog}]` (soma vira `total`/`billed_quantity`/`mf_quantity`), novos campos `mf_plan` (`reschedule|swap|refused`) e `mf_date`, e valida no servidor `pix_value + cash_value + comp_value == total` (erro 400 com mensagem em PT-BR se não bater). `customers.brands[]` (já existia) confirmado como base do painel de marcas.
- Testado: suíte `backend/tests` rodando contra instância local + banco Mongo Atlas isolado (`DB_NAME` temporário, apagado depois) — 41 passaram; 4 falhas em `test_delivery_signature.py` são pré-existentes (fixture espera `r.json()["user"]`, mas o login retorna o usuário "achatado" na raiz) e não têm relação com esta mudança. Testado manualmente via curl: criação de cliente com múltiplas marcas, lançamento com `items[]`, e rejeição 400 quando Pix+Dinheiro+A prazo não fecha com o total. `craco build` com `CI=true` compilou sem erros/warnings.
## Backlog priorizado
- P0: aprovação de despesas.
- P1: filtros de período aplicados às consultas de relatórios.
- P1: vincular consumo do Controle Diário ao abatimento de estoque por marca; usar `mf_plan`/`mf_date` para reprogramar a próxima rota.
- P1: revisar/consertar a fixture de login em `test_delivery_signature.py` (espera chave "user" que a API não retorna).
- P2: relatórios exportáveis e notificações de estoque; admin poder promover marca "fora do cadastro" (`out_of_catalog`) para o cadastro oficial do cliente.

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
## Implementado (2026-08-22, tela de assinatura + automações de MF/marca extra)
- Tela de assinatura do app mobile agora é tela cheia dedicada (`SignaturePad` ganhou prop `variant="mobile"`, reaproveitando a mesma lógica de canvas/desenho): fundo opaco, área tracejada ocupando o espaço disponível, "Concluir parada" (verde) e "Voltar" (texto), igual ao protótipo. Versão desktop/admin do `SignaturePad` não mudou.
- **MF → estoque**: quando o entregador escolhe "Trocar agora no caminhão" (`mf_plan=swap`), o backend abate a quantidade de MF do estoque do produto cuja `brand` bate com a marca do item (`db.products`).
- **MF → reagendamento**: quando escolhe "Entregar outro dia" (`mf_plan=reschedule`), o backend cria automaticamente uma entrega pendente em `deliveries` com a observação da data combinada (`mf_date`).
- **Promoção de marca fora do cadastro**: novo endpoint `GET /customers/out-of-catalog-brands` (agrupa itens `out_of_catalog:true` ainda não promovidos, por cliente+marca) e `POST /customers/{id}/promote-brand` (adiciona a marca/preço ao `customers.brands[]` e marca os lançamentos como `promoted`). Nova tela admin "Marcas Extras" (`/marcas-extras`) lista essas pendências com botão "Salvar no cadastro".
- **Provisão de Pagamento** ganhou filtro de período por data de vencimento (`start`/`end` em `/reports/receivables`), além do filtro de status que já existia.
- Testado via curl contra Mongo Atlas isolado: abatimento de estoque (100→97 após duas trocas), criação da entrega de reposição, listagem/promoção de marca extra (some da lista após promovida), e filtro de data da Provisão excluindo/incluindo corretamente. `pytest tests` 45/45. `craco build` limpo.
## Implementado (2026-08-23, remoção do fluxo antigo de Entregas/Rotas e unificação financeira)
- **Fluxo antigo de "Entregas"/"Rotas" removido por completo** (decisão do usuário: "não deve existir mais"). Removidos: coleção `deliveries`, endpoints `GET/POST/PATCH /deliveries`, componentes `Deliveries`, `MyRoute`, `RoutesPage`, `CompleteDeliveryModal`, itens de menu "Rotas"/"Entregas" e o botão "Nova entrega" do Dashboard. `daily_entries` (Controle Diário) passou a ser a única fonte de verdade de vendas/entregas, tanto no desktop quanto no app mobile.
- MF "reagendar" não cria mais um registro em `deliveries` (coleção removida) — a informação já fica registrada em `mf_plan`/`mf_date` no próprio lançamento.
- **Dashboard, Fechamento do Dia e Relatórios** recalculados a partir de `daily_entries` em vez de `deliveries` (receita, lançamentos do dia/mês, desempenho por entregador). Mantive os mesmos nomes de campo na API (`deliveries`, `deliveries_total`, `deliveries_done` etc.) para não precisar reescrever as telas que já liam esses campos — só troquei a fonte dos dados.
- Painel "Últimos lançamentos" no Dashboard substitui o antigo card fake "Rotas de hoje" (que tinha nomes de entregador e status hardcoded no código) por dados reais de hoje.
- **Financeiro unificado**: novo endpoint `GET /finance/summary` (Pix+Dinheiro recebidos hoje, despesas de hoje, saldo do dia, total a prazo pendente/recebido — com escopo automático por entregador quando não é admin). O card "Recebido hoje" que estava com `R$486` fixo no código agora usa dado real. A tela ganhou um atalho "Ver Provisão de Pagamento" e um resumo de vendas a prazo, ligando as duas telas que antes não se conversavam.
- CSV de relatórios (`/reports/export.csv`) trocou a seção "ENTREGAS" por "LANÇAMENTOS (CONTROLE DIÁRIO)", com colunas de marca, Pix, Dinheiro, a prazo e MF.
- Testes do backend atualizados para reflear o novo modelo: `test_delivery_signature.py` agora testa assinatura via `daily-entries` (o fluxo real usado pelo app mobile), `test_patch_preserve_fields.py` testa PATCH em `daily-entries`, `test_hydroflow_review.py` testa o ciclo de vida de um lançamento em vez de status de entrega. `pytest tests` 44/44. `craco build` com `CI=true` limpo.
## Backlog priorizado
- P0: aprovação de despesas.
- P2: relatórios exportáveis e notificações de estoque.
- P2: variantes 1b (teclado numérico) e 1c (wizard passo a passo) do handoff mobile — não implementadas, só a 1a completa.
- P2: testar visualmente o app mobile num navegador/celular real (só foi validado por build limpo até agora).

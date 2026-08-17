import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { LayoutDashboard, Truck, Package, WalletCards, Users, Map, LogOut, Plus, Menu, X, Droplets, ArrowUpRight, AlertTriangle, CheckCircle2, Clock3, CircleDollarSign, BarChart3, GripVertical, Save, MapPin, Loader2, FileDown, FileText, ShieldCheck, UserPlus, KeyRound, Trash2, Pencil, Activity, Check, XCircle, CalendarCheck, Wallet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import "@/App.css";
import "@/Operations.css";

const api = axios.create({ baseURL: `${process.env.REACT_APP_BACKEND_URL}/api` });
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("hydro_token")}` } });
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const nav = [['/', 'Visão geral', LayoutDashboard], ['/rotas', 'Rotas', Map], ['/entregas', 'Entregas', Truck], ['/estoque', 'Estoque', Package], ['/financeiro', 'Financeiro', WalletCards], ['/clientes', 'Clientes', Users], ['/usuarios', 'Usuários', ShieldCheck], ['/fechamento', 'Fechamento', CalendarCheck], ['/atividade', 'Atividade', Activity], ['/relatorios', 'Relatórios', BarChart3]];

function Shell({ user, onLogout, notifications, children }) {
  const [open, setOpen] = useState(false);
  const links = user.role === 'driver' ? nav.filter(x => ['/', '/rotas', '/entregas', '/financeiro'].includes(x[0])) : nav;
  const badges = { '/usuarios': notifications?.pending_users || 0, '/financeiro': notifications?.pending_expenses || 0 };
  const total = notifications?.total || 0;
  return <div className="app-shell"><aside className={open ? 'sidebar open' : 'sidebar'}><div className="brand"><span className="brand-mark"><Droplets size={20} /></span><span>hydro<span>flow</span></span></div><div className="workspace"><small>OPERAÇÃO</small><b>{user.role === 'admin' ? 'Admin · Base Central' : 'Entregador'} <span>⌄</span></b></div>
    <nav>{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} data-testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <Icon size={18} />{label}
      {badges[to] > 0 && <span className="nav-badge" data-testid={`badge-${to.replace('/', '')}`}>{badges[to]}</span>}
    </NavLink>)}</nav>
    <div className="sidebar-bottom"><div className="support"><span className="live-dot" /> Operação normal</div><button className="logout" data-testid="logout-button" onClick={onLogout}><LogOut size={17} /> Sair da conta</button></div></aside>
    <main className="main"><header><button className="mobile-menu" data-testid="mobile-menu-button" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button><div><p className="eyebrow">{user.role === 'driver' ? 'PORTAL DO ENTREGADOR' : 'PAINEL ADMINISTRATIVO'}</p><h1>Olá, {user.name.split(' ')[0]} <span className="wave">✦</span></h1></div>
      <div className="header-actions">
        <div className="notification" data-testid="notification-indicator" title={total ? `${total} pendências` : 'Sem pendências'}>{total > 0 && <span data-testid="notification-count">{total}</span>}◌</div>
        <div className="avatar">{user.name.split(' ').map(x => x[0]).join('').slice(0, 2)}</div>
      </div></header>{children}</main></div>
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('admin@hydroflow.com'), [password, setPassword] = useState('admin123'), [name, setName] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState('');
  async function submit(e) {
    e.preventDefault(); setError(''); setInfo('');
    try {
      if (mode === 'signup') {
        if (!name.trim() || !email.trim() || password.length < 6) return setError('Preencha nome, e-mail e senha (mín. 6 caracteres).');
        await api.post('/auth/signup', { name, email, password });
        setInfo('Cadastro enviado! Aguarde a aprovação do administrador para acessar.');
        setMode('login'); setName(''); setPassword('');
      } else if (mode === 'forgot') {
        setInfo('A recuperação de senha é feita pelo administrador. Entre em contato com ele para redefinir seu acesso.');
      } else {
        const { data } = await api.post('/auth/login', { email, password });
        localStorage.setItem('hydro_token', data.token); onLogin(data);
      }
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível concluir a operação'); }
  }
  const isLogin = mode === 'login', isSignup = mode === 'signup', isForgot = mode === 'forgot';
  return <div className="login-page"><div className="login-art"><div className="login-brand"><Droplets /> hydro<span>flow</span></div><div className="login-quote">Água em movimento.<br /><em>Operação sob controle.</em></div></div>
    <form className="login-form" onSubmit={submit}>
      <p className="eyebrow">{isLogin ? 'BEM-VINDO DE VOLTA' : isSignup ? 'CRIAR CONTA' : 'RECUPERAR ACESSO'}</p>
      <h1>{isLogin ? 'Acesse sua operação' : isSignup ? 'Cadastre-se para começar' : 'Esqueceu a senha?'}</h1>
      <p className="muted">{isLogin ? 'Entre para acompanhar tudo que acontece na sua base.' : isSignup ? 'Você entrará como entregador. O administrador precisa aprovar o cadastro.' : 'Peça ao administrador para redefinir sua senha diretamente na plataforma.'}</p>
      {isSignup && <label>Nome completo<input data-testid="signup-name-input" value={name} onChange={e => setName(e.target.value)} /></label>}
      <label>E-mail<input data-testid="login-email-input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      {!isForgot && <label>Senha<input data-testid="login-password-input" type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>}
      {error && <div className="error" data-testid="login-error">{error}</div>}
      {info && <div className="info-box" data-testid="login-info">{info}</div>}
      <button className="primary full" data-testid={isSignup ? 'signup-submit-button' : isForgot ? 'forgot-submit-button' : 'login-submit-button'}>
        {isLogin ? <>Entrar na plataforma <ArrowUpRight size={17} /></> : isSignup ? <>Enviar cadastro <UserPlus size={17} /></> : <>Solicitar ajuda <KeyRound size={17} /></>}
      </button>
      <div className="auth-switch">
        {!isLogin && <button type="button" className="link-btn" data-testid="switch-to-login" onClick={() => { setMode('login'); setError(''); setInfo(''); }}>← Voltar ao login</button>}
        {isLogin && <><button type="button" className="link-btn" data-testid="switch-to-signup" onClick={() => { setMode('signup'); setError(''); setInfo(''); setPassword(''); }}>Criar conta</button><button type="button" className="link-btn" data-testid="switch-to-forgot" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>Esqueci a senha</button></>}
      </div>
      <div className="demo-hint">Admin: admin@hydroflow.com / admin123<br />Entregador: carlos@hydroflow.com / driver123</div>
    </form></div>
}

function Head({ eyebrow, title, subtitle, action, onAction, actionTestId }) { return <section className="section-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{subtitle}</p></div>{action && <button className="primary" onClick={onAction} data-testid={actionTestId || `new-${title.toLowerCase().replaceAll(' ', '-')}-button`}><Plus size={17} />{action}</button>}</section> }

function Stat({ label, value, detail, Icon, tone = '' }) { return <div className="stat" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}><div className={`stat-icon ${tone}`}><Icon size={19} /></div><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></div> }

function Modal({ title, fields, onClose, onSave }) { const [form, setForm] = useState({}), [error, setError] = useState(''); async function submit(e) { e.preventDefault(); if (fields.some(x => x.required !== false && !String(form[x.key] || '').trim())) return setError('Preencha os campos obrigatórios.'); try { await onSave(form) } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.') } } return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} data-testid="modal-close-button"><X /></button><p className="eyebrow">NOVO LANÇAMENTO</p><h3>{title}</h3>{fields.map(f => <label key={f.key}>{f.label}{f.options ? <select required={f.required !== false} data-testid={`modal-${f.key}-input`} onChange={e => setForm({ ...form, [f.key]: e.target.value })}><option value="">Selecione</option>{f.options.map(x => <option key={x}>{x}</option>)}</select> : <input required={f.required !== false} type={f.type || 'text'} data-testid={`modal-${f.key}-input`} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}</label>)}{error && <div className="error" data-testid="form-validation-error">{error}</div>}<button className="primary full" data-testid="modal-submit-button"><Save size={16} /> Salvar lançamento</button></form></div> }

const fields = { product: [{ key: 'name', label: 'Nome do produto' }, { key: 'category', label: 'Categoria', options: ['Retornável', 'Descartável'] }, { key: 'quantity', label: 'Quantidade', type: 'number' }, { key: 'minimum', label: 'Estoque mínimo', type: 'number' }], delivery: [{ key: 'customer', label: 'Cliente' }, { key: 'address', label: 'Endereço' }, { key: 'driver', label: 'Entregador' }, { key: 'product', label: 'Produto' }, { key: 'quantity', label: 'Quantidade', type: 'number' }, { key: 'value', label: 'Valor', type: 'number' }], expense: [{ key: 'type', label: 'Categoria', options: ['Combustível', 'Pedágio', 'Manutenção', 'Outros'] }, { key: 'driver', label: 'Entregador' }, { key: 'amount', label: 'Valor', type: 'number' }], customer: [{ key: 'name', label: 'Nome / empresa' }, { key: 'address', label: 'Endereço' }, { key: 'phone', label: 'Telefone', required: false }] };

function Dashboard({ data, create }) { return <><Head eyebrow="PAINEL DE CONTROLE" title="Visão geral" subtitle="Acompanhe a saúde da sua operação em um só lugar." action="Nova entrega" onAction={() => create('delivery')} /><div className="stats"><Stat label="Receita no mês" value={money(data?.revenue)} detail="Receitas concluídas" Icon={CircleDollarSign} /><Stat label="Despesas pendentes" value={money(data?.expenses)} detail="Aguardando aprovação" Icon={WalletCards} tone="orange" /><Stat label="Entregas hoje" value={data?.deliveries?.length || 0} detail="Rotas em acompanhamento" Icon={Truck} tone="green" /><Stat label="Alertas de estoque" value={data?.products?.filter(x => x.quantity < x.minimum).length || 0} detail="Itens abaixo do mínimo" Icon={AlertTriangle} tone="red" /></div><div className="dashboard-grid"><section className="panel performance"><div className="panel-head"><div><h3>Desempenho financeiro</h3><p className="muted">Visão acumulada da operação</p></div><BarChart3 className="blue-text" /></div><div className="chart"><div className="bars">{[45, 62, 54, 78, 66, 92].map((h, i) => <div className="bar-group" key={i}><div className="bar revenue" style={{ height: `${h}%` }} /><div className="bar expense" style={{ height: `${h * .3}%` }} /><span>{['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun'][i]}</span></div>)}</div></div></section><section className="panel route-panel"><div className="panel-head"><div><h3>Rotas de hoje</h3><p className="muted">Status da operação</p></div><Map size={20} className="blue-text" /></div>{['Rota Norte · Carlos Mendes', 'Rota Centro · Ana Souza', 'Rota Sul · João Lima'].map((x, i) => <div className="route" key={x}><div className={`route-icon ${i === 0 ? 'green-bg' : i === 1 ? 'blue-bg' : 'gray-bg'}`}>{i === 0 ? <CheckCircle2 size={18} /> : i === 1 ? <Truck size={18} /> : <Clock3 size={18} />}</div><div><b>{x}</b><small>{i === 0 ? '8 de 8 paradas concluídas' : i === 1 ? '4 de 7 paradas concluídas' : '6 paradas programadas'}</small></div><span className={`tag ${i === 0 ? 'green' : i === 1 ? 'blue' : 'gray'}`}>{i === 0 ? 'Concluída' : i === 1 ? 'Em rota' : 'Pendente'}</span></div>)}</section></div></> }

function Deliveries({ data, setData, create }) { const [filter, setFilter] = useState('all'); const rows = (data?.deliveries || []).filter(x => filter === 'all' || x.status === filter); async function change(d, status) { await api.patch(`/deliveries/${d.id}`, { status }, auth()); setData({ ...data, deliveries: data.deliveries.map(x => x.id === d.id ? { ...x, status } : x) }) } return <><Head eyebrow="LOGÍSTICA" title="Entregas" subtitle="Acompanhe cada entrega e status da rota." action="Lançar entrega" onAction={() => create('delivery')} /><div className="filter-row"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} data-testid="delivery-filter-all">Todas</button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')} data-testid="delivery-filter-pending">Pendentes</button><button className={filter === 'in_transit' ? 'active' : ''} onClick={() => setFilter('in_transit')} data-testid="delivery-filter-in-transit">Em rota</button></div><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>PRODUTO</th><th>ENTREGADOR</th><th>VALOR</th><th>STATUS</th></tr></thead><tbody>{rows.map(d => <tr key={d.id}><td><b>{d.customer}</b><small>{d.address}</small></td><td>{d.product}<small>{d.quantity} unidades</small></td><td>{d.driver}</td><td>{money(d.value)}</td><td><select data-testid={`delivery-status-${d.id}`} value={d.status} onChange={e => change(d, e.target.value)}><option value="pending">Pendente</option><option value="in_transit">Em rota</option><option value="delivered">Entregue</option><option value="failed">Não realizada</option><option value="damaged">Avaria</option></select></td></tr>)}</tbody></table></div></section></> }

function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.strokeStyle = '#10253f';
    const pos = e => { const r = c.getBoundingClientRect(); const t = e.touches?.[0] || e; return [t.clientX - r.left, t.clientY - r.top]; };
    const start = e => { e.preventDefault(); drawing.current = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); setEmpty(false); };
    const move = e => { if (!drawing.current) return; e.preventDefault(); const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
    const end = () => { drawing.current = false; };
    c.addEventListener('mousedown', start); c.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    c.addEventListener('touchstart', start, { passive: false }); c.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end);
    return () => { c.removeEventListener('mousedown', start); c.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); c.removeEventListener('touchstart', start); c.removeEventListener('touchmove', move); window.removeEventListener('touchend', end); };
  }, []);
  function clear() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setEmpty(true); }
  function save() { onSave(canvasRef.current.toDataURL('image/png')); }
  return <div className="modal-backdrop"><div className="quick-modal signature-modal">
    <button type="button" className="modal-close" onClick={onCancel} data-testid="signature-close"><X /></button>
    <p className="eyebrow">CONFIRMAÇÃO DE ENTREGA</p>
    <h3>Assinatura do cliente</h3>
    <p className="muted">Peça para o cliente assinar abaixo confirmando o recebimento.</p>
    <canvas ref={canvasRef} width={360} height={180} className="signature-canvas" data-testid="signature-canvas" />
    <div className="signature-actions">
      <button type="button" className="ghost-btn" data-testid="signature-clear" onClick={clear}>Limpar</button>
      <button type="button" className="primary" data-testid="signature-save" onClick={save} disabled={empty}><Check size={16} /> Concluir parada</button>
    </div>
  </div></div>
}

function MyRoute({ data, setData, user }) {
  const [signing, setSigning] = useState(null);
  const [busy, setBusy] = useState(null);
  const stops = (data?.deliveries || []).filter(d => d.driver === user.name);
  const done = stops.filter(x => x.status === 'delivered').length;

  async function updateStatus(d, status, extra = {}) {
    setBusy(d.id);
    const patch = { status, ...extra };
    const { data: updated } = await api.patch(`/deliveries/${d.id}`, patch, auth());
    setData({ ...data, deliveries: data.deliveries.map(x => x.id === d.id ? { ...x, ...updated } : x) });
    setBusy(null);
  }
  async function completeWithSignature(signature) {
    const d = signing; setSigning(null);
    await updateStatus(d, 'delivered', { signature, delivered_at: new Date().toISOString() });
  }

  const tag = { pending: ['gray', 'Aguardando'], in_transit: ['blue', 'Em rota'], delivered: ['green', 'Entregue'], failed: ['red', 'Não realizada'], damaged: ['orange', 'Avaria'] };
  return <><Head eyebrow="MINHA JORNADA" title="Rota do dia" subtitle={`${done} de ${stops.length} paradas concluídas`} />
    <div className="progress-track" data-testid="route-progress"><div className="progress-fill" style={{ width: stops.length ? `${(done / stops.length) * 100}%` : '0%' }} /></div>
    {stops.length === 0 && <div className="empty-state" data-testid="no-stops">Nenhuma parada atribuída para você hoje. Fale com o administrador.</div>}
    <div className="mobile-stops">
      {stops.map((d, i) => {
        const [tone, label] = tag[d.status] || ['gray', d.status];
        const isDone = d.status === 'delivered';
        return <article className={`stop-card ${isDone ? 'done' : ''}`} key={d.id} data-testid={`mobile-stop-${d.id}`}>
          <div className="stop-card-head">
            <span className="stop-index">{i + 1}</span>
            <div>
              <b>{d.customer}</b>
              <small><MapPin size={11} /> {d.address}</small>
            </div>
            <span className={`tag ${tone}`}>{label}</span>
          </div>
          <div className="stop-card-body">
            <span><Package size={13} /> {d.product} · {d.quantity} un</span>
            <span><CircleDollarSign size={13} /> {money(d.value)}</span>
          </div>
          {d.signature && <div className="stop-signature-preview"><img src={d.signature} alt="Assinatura" data-testid={`signature-preview-${d.id}`} /><small>Recebido{d.delivered_at ? ` em ${new Date(d.delivered_at).toLocaleString('pt-BR')}` : ''}</small></div>}
          {!isDone && <div className="stop-card-actions">
            {d.status === 'pending' && <button className="ghost-btn" data-testid={`start-stop-${d.id}`} disabled={busy === d.id} onClick={() => updateStatus(d, 'in_transit')}><Truck size={14} /> Iniciar</button>}
            <button className="primary" data-testid={`complete-stop-${d.id}`} disabled={busy === d.id} onClick={() => setSigning(d)}><Check size={14} /> Concluir parada</button>
            <button className="action-btn reject" data-testid={`fail-stop-${d.id}`} disabled={busy === d.id} onClick={() => updateStatus(d, 'failed')}><XCircle size={13} /> Não realizada</button>
          </div>}
        </article>
      })}
    </div>
    {signing && <SignaturePad onSave={completeWithSignature} onCancel={() => setSigning(null)} />}
  </>
}

function RoutesPage({ data, setData }) {
  const [stops, setStops] = useState(data?.deliveries || []);
  useEffect(() => setStops(data?.deliveries || []), [data]);

  function move(i, d) { const a = [...stops], j = i + d; if (j >= 0 && j < a.length)[a[i], a[j]] = [a[j], a[i]]; setStops(a) }

  return <><Head eyebrow="PLANEJAMENTO" title="Rotas" subtitle="Defina manualmente a sequência das entregas do dia." />
    <div className="manual-route">
      <section className="panel stop-list" data-testid="stop-list-panel">
        <div className="panel-head"><div><h3>Rota Centro · 18 junho</h3><p className="muted">Sequência de paradas</p></div><span className="tag blue" data-testid="stop-count-tag">{stops.length} paradas</span></div>
        {stops.length === 0 && <div className="empty-state" data-testid="no-route-stops">Nenhuma entrega disponível para organizar.</div>}
        {stops.map((s, i) => <div className="stop-row" key={s.id} data-testid={`stop-row-${s.id}`}>
            <GripVertical size={18} className="grip" />
            <span className="stop-number">{i + 1}</span>
            <div>
              <b>{s.customer}</b>
              <small>{s.address}</small>
            </div>
            <div className="stop-actions">
              <button aria-label={`Mover ${s.customer} para cima`} disabled={i === 0} data-testid={`route-up-${s.id}`} onClick={() => move(i, -1)}>↑</button>
              <button aria-label={`Mover ${s.customer} para baixo`} disabled={i === stops.length - 1} data-testid={`route-down-${s.id}`} onClick={() => move(i, 1)}>↓</button>
            </div>
          </div>)}
        {stops.length > 0 && <button className="secondary-btn" data-testid="save-order-button" onClick={() => setData({ ...data, deliveries: stops })}><Save size={14} /> Salvar sequência</button>}
      </section>
    </div>
  </>
}

function Stock({ data, create }) { return <><Head eyebrow="INVENTÁRIO" title="Estoque" subtitle="Produtos, galões retornáveis e níveis mínimos." action="Novo produto" onAction={() => create('product')} /><div className="stock-alert" data-testid="stock-alert"><AlertTriangle size={19} /><div><b>{data?.products?.filter(x => x.quantity < x.minimum).length || 0} produtos precisam de reposição</b><span>Confira os itens antes da próxima rota.</span></div></div><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>PRODUTO</th><th>CATEGORIA</th><th>DISPONÍVEL</th><th>MÍNIMO</th><th>SITUAÇÃO</th></tr></thead><tbody>{(data?.products || []).map(p => <tr key={p.id}><td><b>{p.name}</b><small>SKU-{p.id}</small></td><td>{p.category}</td><td>{p.quantity} {p.unit || 'un'}</td><td>{p.minimum}</td><td><span className={`tag ${p.quantity < p.minimum ? 'red' : 'green'}`}>{p.quantity < p.minimum ? 'Repor' : 'Saudável'}</span></td></tr>)}</tbody></table></div></section></> }

function Finance({ data, setData, create, user }) {
  async function reviewExpense(e, status) {
    const { data: updated } = await api.patch(`/expenses/${e.id}`, { status }, auth());
    setData({ ...data, expenses_list: data.expenses_list.map(x => x.id === e.id ? updated : x) });
    window.hydroRefreshNotifications?.();
  }
  const isAdmin = user?.role === 'admin';
  return <><Head eyebrow="CONTROLE FINANCEIRO" title="Financeiro" subtitle="Recebimentos e despesas lançados pela equipe." action="Lançar despesa" onAction={() => create('expense')} />
    <div className="stats"><Stat label="Recebido hoje" value={money(486)} detail="Entregas confirmadas" Icon={CircleDollarSign} /><Stat label="A aprovar" value={money((data?.expenses_list || []).filter(x => x.status === 'pending').reduce((s, x) => s + Number(x.amount || 0), 0))} detail="Despesas pendentes" Icon={Clock3} tone="orange" /><Stat label="Saldo líquido" value={money((data?.revenue || 0) - (data?.expenses || 0))} detail="Período atual" Icon={ArrowUpRight} tone="green" /></div>
    <section className="panel table-panel"><div className="panel-head"><div><h3>Movimentações recentes</h3><p className="muted">{isAdmin ? 'Aprove ou reprove os lançamentos' : 'Seus lançamentos'}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>TIPO</th><th>ENTREGADOR</th><th>VALOR</th><th>STATUS</th>{isAdmin && <th>AÇÕES</th>}</tr></thead><tbody>
        {(data?.expenses_list || []).map(e => {
          const st = e.status || 'pending';
          const tag = st === 'approved' ? 'green' : st === 'rejected' ? 'red' : 'orange';
          const label = st === 'approved' ? 'Aprovada' : st === 'rejected' ? 'Reprovada' : 'Aguardando aprovação';
          return <tr key={e.id} data-testid={`expense-row-${e.id}`}>
            <td><b>{e.type}</b>{e.reviewed_by && <small>Revisado por {e.reviewed_by}</small>}</td>
            <td>{e.driver}</td>
            <td>{money(e.amount)}</td>
            <td><span className={`tag ${tag}`}>{label}</span></td>
            {isAdmin && <td>
              {st === 'pending' ? <div className="row-actions">
                <button className="action-btn approve" data-testid={`approve-expense-${e.id}`} onClick={() => reviewExpense(e, 'approved')}><Check size={13} /> Aprovar</button>
                <button className="action-btn reject" data-testid={`reject-expense-${e.id}`} onClick={() => reviewExpense(e, 'rejected')}><XCircle size={13} /> Reprovar</button>
              </div> : <button className="action-btn ghost" data-testid={`reopen-expense-${e.id}`} onClick={() => reviewExpense(e, 'pending')}>Reabrir</button>}
            </td>}
          </tr>
        })}
      </tbody></table></div></section></>
}

function Customers({ items, create }) { return <><Head eyebrow="RELACIONAMENTO" title="Clientes" subtitle="Sua carteira e endereços de entrega." action="Novo cliente" onAction={() => create('customer')} /><div className="customer-grid">{items.map(x => <div className="customer-card" key={x.id}><div className="customer-avatar">{x.name?.[0]}</div><div><b>{x.name}</b><span>{x.address}</span><small>{x.phone || 'Cliente ativo'}</small></div><ArrowUpRight size={18} /></div>)}</div></> }

function UsersPage({ me }) {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('all');
  async function load() { const { data } = await api.get('/users', auth()); setItems(data); window.hydroRefreshNotifications?.(); }
  useEffect(() => { load(); }, []);
  const filtered = items.filter(x => filter === 'all' || (filter === 'pending' && x.status === 'pending') || (filter === 'active' && x.active !== false && x.status === 'approved') || (filter === 'inactive' && (x.active === false || x.status === 'rejected')));
  async function approve(u) { await api.post(`/users/${u.id}/approve`, {}, auth()); load(); }
  async function reject(u) { await api.post(`/users/${u.id}/reject`, {}, auth()); load(); }
  async function toggleActive(u) { await api.patch(`/users/${u.id}`, { active: !u.active }, auth()); load(); }
  async function changeRole(u, role) { await api.patch(`/users/${u.id}`, { role }, auth()); load(); }
  async function del(u) { if (!window.confirm(`Excluir ${u.name}?`)) return; await api.delete(`/users/${u.id}`, auth()); load(); }
  return <><Head eyebrow="ACESSOS" title="Usuários" subtitle="Aprove cadastros, gerencie perfis e reset de senhas." action="Novo usuário" onAction={() => setModal({ mode: 'create' })} />
    <div className="filter-row"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} data-testid="users-filter-all">Todos</button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')} data-testid="users-filter-pending">Pendentes ({items.filter(x => x.status === 'pending').length})</button><button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')} data-testid="users-filter-active">Ativos</button><button className={filter === 'inactive' ? 'active' : ''} onClick={() => setFilter('inactive')} data-testid="users-filter-inactive">Inativos</button></div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>USUÁRIO</th><th>E-MAIL</th><th>PERFIL</th><th>STATUS</th><th>AÇÕES</th></tr></thead><tbody>
      {filtered.map(u => {
        const st = u.status || 'approved';
        const active = u.active !== false;
        const tag = st === 'pending' ? 'orange' : st === 'rejected' || !active ? 'red' : 'green';
        const label = st === 'pending' ? 'Aguardando' : st === 'rejected' ? 'Reprovado' : !active ? 'Desativado' : 'Ativo';
        return <tr key={u.id} data-testid={`user-row-${u.id}`}>
          <td><b>{u.name}</b><small>Cadastro: {new Date(u.created_at || Date.now()).toLocaleDateString('pt-BR')}</small></td>
          <td>{u.email}</td>
          <td><select value={u.role} data-testid={`user-role-${u.id}`} onChange={e => changeRole(u, e.target.value)} disabled={u.id === me.id}><option value="admin">Administrador</option><option value="driver">Entregador</option></select></td>
          <td><span className={`tag ${tag}`}>{label}</span></td>
          <td><div className="row-actions">
            {st === 'pending' && <><button className="action-btn approve" data-testid={`approve-user-${u.id}`} onClick={() => approve(u)}><Check size={13} /> Aprovar</button><button className="action-btn reject" data-testid={`reject-user-${u.id}`} onClick={() => reject(u)}><XCircle size={13} /> Reprovar</button></>}
            {st !== 'pending' && u.id !== me.id && <button className="action-btn ghost" data-testid={`toggle-user-${u.id}`} onClick={() => toggleActive(u)}>{active ? 'Desativar' : 'Ativar'}</button>}
            <button className="action-btn ghost" data-testid={`edit-user-${u.id}`} onClick={() => setModal({ mode: 'edit', user: u })}><Pencil size={13} /></button>
            <button className="action-btn ghost" data-testid={`reset-user-${u.id}`} onClick={() => setModal({ mode: 'reset', user: u })}><KeyRound size={13} /></button>
            {u.id !== me.id && <button className="action-btn reject" data-testid={`delete-user-${u.id}`} onClick={() => del(u)}><Trash2 size={13} /></button>}
          </div></td>
        </tr>
      })}
    </tbody></table></div></section>
    {modal && <UserModal modal={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
  </>
}

function UserModal({ modal, onClose, onDone }) {
  const [form, setForm] = useState(modal.user ? { name: modal.user.name, email: modal.user.email, role: modal.user.role } : { role: 'driver' });
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      if (modal.mode === 'create') { await api.post('/users', form, auth()); }
      else if (modal.mode === 'edit') { await api.patch(`/users/${modal.user.id}`, { name: form.name, email: form.email, role: form.role }, auth()); }
      else if (modal.mode === 'reset') {
        if (!form.password || form.password.length < 6) return setError('Nova senha precisa ter ao menos 6 caracteres.');
        await api.post(`/users/${modal.user.id}/reset-password`, { password: form.password }, auth());
      }
      onDone();
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }
  const isReset = modal.mode === 'reset';
  return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose} data-testid="user-modal-close"><X /></button>
    <p className="eyebrow">{isReset ? 'REDEFINIR SENHA' : modal.mode === 'edit' ? 'EDITAR USUÁRIO' : 'NOVO USUÁRIO'}</p>
    <h3>{isReset ? modal.user.name : modal.mode === 'edit' ? 'Atualizar dados' : 'Cadastrar novo usuário'}</h3>
    {!isReset && <><label>Nome<input required value={form.name || ''} data-testid="user-form-name" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>E-mail<input required type="email" value={form.email || ''} data-testid="user-form-email" onChange={e => setForm({ ...form, email: e.target.value })} /></label>
      <label>Perfil<select value={form.role} data-testid="user-form-role" onChange={e => setForm({ ...form, role: e.target.value })}><option value="driver">Entregador</option><option value="admin">Administrador</option></select></label></>}
    {(modal.mode === 'create' || isReset) && <label>{isReset ? 'Nova senha' : 'Senha inicial'}<input required type="password" data-testid="user-form-password" onChange={e => setForm({ ...form, password: e.target.value })} /></label>}
    {error && <div className="error" data-testid="user-form-error">{error}</div>}
    <button className="primary full" data-testid="user-form-submit"><Save size={16} /> {isReset ? 'Redefinir senha' : 'Salvar'}</button>
  </form></div>
}

function ActivityPage() {
  const [items, setItems] = useState([]);
  useEffect(() => { api.get('/activity', auth()).then(x => setItems(x.data)).catch(() => setItems([])); }, []);
  const labels = { signup: 'Cadastro recebido', user_created: 'Usuário criado', user_approved: 'Usuário aprovado', user_rejected: 'Usuário reprovado', user_updated: 'Usuário editado', user_deleted: 'Usuário excluído', password_reset: 'Senha redefinida', expense_approved: 'Despesa aprovada', expense_rejected: 'Despesa reprovada', expense_pending: 'Despesa reaberta' };
  const tones = { user_approved: 'green', expense_approved: 'green', user_rejected: 'red', expense_rejected: 'red', user_deleted: 'red', user_created: 'blue', signup: 'blue', password_reset: 'orange', user_updated: 'gray', expense_pending: 'gray' };
  return <><Head eyebrow="AUDITORIA" title="Atividade" subtitle="Todas as ações do administrador em ordem cronológica." />
    <section className="panel activity-panel"><ul className="activity-list" data-testid="activity-list">
      {items.length === 0 && <li className="muted" style={{ padding: 20 }}>Nenhuma atividade registrada ainda.</li>}
      {items.map(a => <li key={a.id} data-testid={`activity-${a.id}`}><span className={`activity-dot tag ${tones[a.action] || 'gray'}`}>●</span>
        <div><b>{labels[a.action] || a.action}</b><small>{a.actor_name || 'Sistema'} → {a.target_name || a.target_email || '—'}</small></div>
        <time>{new Date(a.created_at).toLocaleString('pt-BR')}</time>
      </li>)}
    </ul></section></>
}

function DailyClosing() {
  const [date, setDate] = useState(todayISO(0));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try { const { data: r } = await api.get('/daily-closing', { ...auth(), params: { date } }); setData(r); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [date]);

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(8, 120, 209);
    doc.text('HydroFlow · Fechamento do Dia', 14, 20);
    doc.setFontSize(10); doc.setTextColor(110, 130, 152);
    doc.text(`Data: ${date}`, 14, 28);
    doc.setFontSize(11); doc.setTextColor(16, 37, 63);
    const t = data?.totals || {};
    doc.text(`Receita bruta: ${money(t.revenue)}`, 14, 40);
    doc.text(`Despesas aprovadas: ${money(t.expenses_approved)}`, 14, 47);
    doc.text(`Saldo líquido do dia: ${money(t.balance)}`, 14, 54);
    doc.text(`Entregas concluídas: ${t.deliveries_done || 0} de ${t.deliveries_total || 0}`, 14, 61);
    autoTable(doc, {
      startY: 70,
      head: [['Entregador', 'Entregas', 'Receita', 'Desp. aprov.', 'Desp. pend.', 'Saldo']],
      body: (data?.drivers || []).map(d => [d.driver, `${d.deliveries_done}/${d.deliveries_total}`, money(d.revenue), money(d.expenses_approved), money(d.expenses_pending), money(d.balance)]),
      headStyles: { fillColor: [8, 120, 209] },
    });
    doc.save(`hydroflow-fechamento-${date}.pdf`);
  }

  const totals = data?.totals || {};
  const rows = data?.drivers || [];
  return <><Head eyebrow="FECHAMENTO DIÁRIO" title="Fechamento do dia" subtitle="Resumo por entregador — recebimentos, despesas aprovadas e saldo final." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>Data<input type="date" value={date} data-testid="closing-date-input" onChange={e => setDate(e.target.value)} /></label>
        <button className="ghost-btn" data-testid="closing-today-button" onClick={() => setDate(todayISO(0))}>Hoje</button>
        <button className="ghost-btn" data-testid="closing-yesterday-button" onClick={() => setDate(todayISO(-1))}>Ontem</button>
      </div>
      <div className="report-actions">
        {loading && <Loader2 size={16} className="spin blue-text" />}
        <button className="primary" data-testid="closing-export-pdf" onClick={exportPDF}><FileText size={15} /> Exportar PDF</button>
      </div>
    </div>
    <div className="stats">
      <Stat label="Receita bruta" value={money(totals.revenue)} detail="Entregas concluídas" Icon={CircleDollarSign} tone="green" />
      <Stat label="Despesas aprovadas" value={money(totals.expenses_approved)} detail="Descontadas do dia" Icon={Wallet} tone="orange" />
      <Stat label="Saldo líquido" value={money(totals.balance)} detail="Receita − Despesas" Icon={ArrowUpRight} tone="" />
      <Stat label="Entregas" value={`${totals.deliveries_done || 0}/${totals.deliveries_total || 0}`} detail="Concluídas / Programadas" Icon={Truck} />
    </div>
    <section className="panel table-panel" data-testid="closing-panel">
      <div className="panel-head"><div><h3>Fechamento por entregador</h3><p className="muted">{rows.length ? `${rows.length} entregador(es) com movimentação no dia` : 'Nenhuma movimentação encontrada para essa data'}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>ENTREGADOR</th><th>ENTREGAS</th><th>RECEITA</th><th>DESP. APROVADAS</th><th>DESP. PENDENTES</th><th>SALDO</th></tr></thead><tbody>
        {rows.map(d => <tr key={d.driver} data-testid={`closing-row-${d.driver}`}>
          <td><b>{d.driver}</b><small>{d.deliveries_done} de {d.deliveries_total} concluídas</small></td>
          <td><span className="tag blue">{d.deliveries_done}/{d.deliveries_total}</span></td>
          <td>{money(d.revenue)}</td>
          <td className="green-text">{money(d.expenses_approved)}</td>
          <td className="orange-text">{money(d.expenses_pending)}</td>
          <td><b>{money(d.balance)}</b></td>
        </tr>)}
      </tbody></table></div>
    </section></>
}

function todayISO(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); }

function Reports() {
  const [r, setR] = useState(null);
  const [start, setStart] = useState(todayISO(-30));
  const [end, setEnd] = useState(todayISO(0));
  const [preset, setPreset] = useState('30');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get('/reports', { ...auth(), params: { start, end } });
      setR(data);
    } catch {
      setR({ revenue: 0, expenses: 0, deliveries: 0, low_stock: 0, drivers: [] });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [start, end]);

  function applyPreset(v) {
    setPreset(v);
    if (v === '7') { setStart(todayISO(-7)); setEnd(todayISO(0)); }
    else if (v === '30') { setStart(todayISO(-30)); setEnd(todayISO(0)); }
    else if (v === '90') { setStart(todayISO(-90)); setEnd(todayISO(0)); }
    else if (v === 'today') { setStart(todayISO(0)); setEnd(todayISO(0)); }
  }

  async function exportCSV() {
    const url = `${process.env.REACT_APP_BACKEND_URL}/api/reports/export.csv?start=${start}&end=${end}`;
    const res = await fetch(url, auth());
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `hydroflow-relatorio-${start}-a-${end}.csv`;
    link.click();
  }

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(8, 120, 209);
    doc.text('HydroFlow · Relatório Operacional', 14, 20);
    doc.setFontSize(10); doc.setTextColor(110, 130, 152);
    doc.text(`Período: ${start} a ${end}`, 14, 28);
    doc.setFontSize(11); doc.setTextColor(16, 37, 63);
    doc.text(`Receita: ${money(r?.revenue)}`, 14, 40);
    doc.text(`Despesas: ${money(r?.expenses)}`, 14, 47);
    doc.text(`Entregas: ${r?.deliveries || 0}`, 14, 54);
    doc.text(`Alertas de estoque: ${r?.low_stock || 0}`, 14, 61);
    autoTable(doc, {
      startY: 70,
      head: [['Entregador', 'Entregas', 'Concluídas', 'Receita', 'Eficiência']],
      body: (r?.drivers || []).map(d => [d.driver, d.deliveries, d.delivered, money(d.revenue), `${d.deliveries ? Math.round(d.delivered / d.deliveries * 100) : 0}%`]),
      headStyles: { fillColor: [8, 120, 209] },
    });
    doc.save(`hydroflow-relatorio-${start}-a-${end}.pdf`);
  }

  return <><Head eyebrow="INTELIGÊNCIA" title="Relatórios" subtitle="Indicadores para decidir melhor a cada período." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>De<input type="date" value={start} max={end} data-testid="report-start-date" onChange={e => { setStart(e.target.value); setPreset('custom'); }} /></label>
        <label>Até<input type="date" value={end} min={start} data-testid="report-end-date" onChange={e => { setEnd(e.target.value); setPreset('custom'); }} /></label>
        <select data-testid="report-period-select" value={preset} onChange={e => applyPreset(e.target.value)}>
          <option value="today">Hoje</option>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="custom">Personalizado</option>
        </select>
      </div>
      <div className="report-actions">
        {loading && <Loader2 size={16} className="spin blue-text" />}
        <button data-testid="export-csv-button" className="ghost-btn" onClick={exportCSV}><FileDown size={15} /> CSV</button>
        <button data-testid="export-pdf-button" className="primary" onClick={exportPDF}><FileText size={15} /> Exportar PDF</button>
      </div>
    </div>
    <div className="stats"><Stat label="Receita realizada" value={money(r?.revenue)} detail="Entregas concluídas" Icon={CircleDollarSign} /><Stat label="Despesas" value={money(r?.expenses)} detail="Lançamentos" Icon={WalletCards} tone="orange" /><Stat label="Entregas" value={r?.deliveries || 0} detail="No período" Icon={Truck} tone="green" /><Stat label="Alertas estoque" value={r?.low_stock || 0} detail="Atenção necessária" Icon={AlertTriangle} tone="red" /></div>
    <section className="panel table-panel"><div className="panel-head"><div><h3>Desempenho por entregador</h3><p className="muted">Volume, receita e conclusão</p></div></div><div className="table-wrap"><table><thead><tr><th>ENTREGADOR</th><th>ENTREGAS</th><th>CONCLUÍDAS</th><th>RECEITA</th><th>EFICIÊNCIA</th></tr></thead><tbody>{(r?.drivers || []).map(d => <tr key={d.driver}><td><b>{d.driver}</b></td><td>{d.deliveries}</td><td>{d.delivered}</td><td>{money(d.revenue)}</td><td><span className="tag green">{d.deliveries ? Math.round(d.delivered / d.deliveries * 100) : 0}%</span></td></tr>)}</tbody></table></div></section></>
}

function App() {
  const [user, setUser] = useState(null), [data, setData] = useState(null), [customers, setCustomers] = useState([]), [checking, setChecking] = useState(true), [modal, setModal] = useState(null), [notifications, setNotifications] = useState({ pending_users: 0, pending_expenses: 0, total: 0 });
  useEffect(() => { const t = localStorage.getItem('hydro_token'); if (t) api.get('/auth/me', auth()).then(x => setUser(x.data)).catch(() => localStorage.removeItem('hydro_token')).finally(() => setChecking(false)); else setChecking(false) }, []);
  useEffect(() => { if (user) Promise.all([api.get('/dashboard', auth()), api.get('/customers', auth())]).then(([a, c]) => { setData(a.data); setCustomers(c.data) }) }, [user]);
  useEffect(() => {
    if (!user) return;
    const fetchNotif = () => api.get('/notifications', auth()).then(x => setNotifications(x.data)).catch(() => { });
    fetchNotif();
    const id = setInterval(fetchNotif, 30000);
    window.hydroRefreshNotifications = fetchNotif;
    return () => clearInterval(id);
  }, [user, data]);
  if (checking) return <div className="loading">Carregando operação...</div>;
  if (!user) return <Login onLogin={setUser} />;
  const logout = () => { localStorage.removeItem('hydro_token'); setUser(null) };
  async function save(kind, form) { const endpoints = { product: '/products', delivery: '/deliveries', expense: '/expenses', customer: '/customers' }; const payload = { ...form };['quantity', 'minimum', 'value', 'amount'].forEach(k => { if (payload[k] !== undefined) payload[k] = Number(payload[k]) }); if (kind === 'delivery') payload.status = 'pending'; if (kind === 'expense') { payload.status = 'pending'; if (!payload.driver) payload.driver = user.name; } const { data: x } = await api.post(endpoints[kind], payload, auth()); if (kind === 'customer') setCustomers([...customers, x]); else { const key = kind === 'product' ? 'products' : kind === 'delivery' ? 'deliveries' : 'expenses_list'; setData({ ...data, [key]: [...(data?.[key] || []), x] }) } setModal(null) }
  const adminOnly = el => user.role === 'admin' ? el : <Navigate to="/" replace />;
  return <Shell user={user} onLogout={logout} notifications={notifications}>
    <Routes>
      <Route path="/" element={<Dashboard data={data} create={setModal} />} />
      <Route path="/rotas" element={user.role === 'driver' ? <MyRoute data={data} setData={setData} user={user} /> : <RoutesPage data={data} setData={setData} />} />
      <Route path="/entregas" element={<Deliveries data={data} setData={setData} create={setModal} />} />
      <Route path="/estoque" element={<Stock data={data} create={setModal} />} />
      <Route path="/financeiro" element={<Finance data={data} setData={setData} create={setModal} user={user} />} />
      <Route path="/clientes" element={<Customers items={customers} create={setModal} />} />
      <Route path="/usuarios" element={adminOnly(<UsersPage me={user} />)} />
      <Route path="/fechamento" element={adminOnly(<DailyClosing />)} />
      <Route path="/atividade" element={adminOnly(<ActivityPage />)} />
      <Route path="/relatorios" element={adminOnly(<Reports />)} />
    </Routes>
    {modal && <Modal title={{ product: 'Cadastrar produto', delivery: 'Lançar entrega', expense: 'Lançar despesa', customer: 'Cadastrar cliente' }[modal]} fields={fields[modal]} onClose={() => setModal(null)} onSave={x => save(modal, x)} />}
  </Shell>
}
export default () => <BrowserRouter><App /></BrowserRouter>;

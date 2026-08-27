import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { BrowserRouter, Routes, Route, NavLink, Navigate, Link } from "react-router-dom";
import { LayoutDashboard, Truck, Package, WalletCards, Users, LogOut, Plus, Menu, X, Droplets, ArrowUpRight, AlertTriangle, Clock3, CircleDollarSign, BarChart3, Save, Loader2, FileDown, FileText, ShieldCheck, UserPlus, KeyRound, Trash2, Pencil, Activity, Check, XCircle, CalendarCheck, Wallet, Eye, EyeOff, Minus, Sun, Moon, Camera, Search, MoreHorizontal, Fuel, Utensils, Wrench, Receipt, ChevronRight, RefreshCw, Eraser } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import logoImg from "./assets/logo.png";
import { LOGO_PNG_BASE64 } from "./logoBase64";
import "@/App.css";
import "@/Operations.css";

const api = axios.create({ baseURL: `${process.env.REACT_APP_BACKEND_URL}/api` });
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem("hydro_token")}` } });
const money = v => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

function formatDateTimeManaus(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Manaus', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' (Manaus)'; }
  catch { return iso; }
}

function entryItemsList(entry) {
  return entry.items?.length ? entry.items : (entry.brand ? [{ brand: entry.brand, quantity: entry.billed_quantity ?? entry.quantity, price: entry.price }] : []);
}

function buildReceiptDoc(entry) {
  const doc = new jsPDF();
  const dt = formatDateTimeManaus(entry.created_at);
  try { doc.addImage(LOGO_PNG_BASE64, 'PNG', 14, 10, 18, 17.6); } catch (err) { /* logo indisponível, ignora */ }
  doc.setFontSize(17); doc.setTextColor(8, 120, 209);
  doc.text('Distribuidora Diane', 36, 18);
  doc.setFontSize(12); doc.setTextColor(16, 37, 63);
  doc.text('Comprovante de Entrega / Recibo de Pagamento', 36, 26);
  doc.setFontSize(9); doc.setTextColor(110, 130, 152);
  doc.text(`${entry.entry_number ? `Nº ${entry.entry_number} · ` : ''}${dt}`, 36, 32);
  doc.setFontSize(10); doc.setTextColor(16, 37, 63);
  let y = 42;
  doc.text(`Cliente: ${entry.customer || '-'}`, 14, y); y += 6;
  if (entry.address) { doc.text(`Endereço: ${entry.address}`, 14, y); y += 6; }
  doc.text(`Entregador: ${entry.driver || '-'}`, 14, y); y += 8;
  const items = entryItemsList(entry);
  autoTable(doc, {
    startY: y,
    head: [['Produto', 'Qtd', 'Preço un.', 'Subtotal']],
    body: items.map(it => [it.brand, it.quantity, money(it.price), money((it.quantity || 0) * (it.price || 0))]),
    headStyles: { fillColor: [8, 120, 209] },
  });
  y = doc.lastAutoTable.finalY + 10;
  doc.setFontSize(12); doc.setTextColor(16, 37, 63);
  doc.text(`Total: ${money(entry.total)}`, 14, y); y += 8;
  doc.setFontSize(9); doc.setTextColor(80, 100, 120);
  if (entry.pix_value > 0) { doc.text(`Pix: ${money(entry.pix_value)}`, 14, y); y += 6; }
  if (entry.cash_value > 0) { doc.text(`Dinheiro: ${money(entry.cash_value)}`, 14, y); y += 6; }
  if (entry.comp_value > 0) { doc.text(`A prazo (${entry.comp_days} dias${entry.due_date ? `, vence ${entry.due_date}` : ''}): ${money(entry.comp_value)}${entry.received ? ' · recebido' : ' · pendente'}`, 14, y); y += 6; }
  y += 6;
  if (entry.signature) {
    doc.setFontSize(9); doc.setTextColor(16, 37, 63);
    doc.text('Assinatura do cliente:', 14, y); y += 4;
    try { doc.addImage(entry.signature, 'PNG', 14, y, 80, 38); } catch (err) { /* imagem inválida, ignora */ }
    y += 42;
    if (entry.signature_name) {
      doc.setDrawColor(200, 210, 220); doc.line(14, y, 94, y); y += 5;
      doc.setFontSize(9); doc.setTextColor(16, 37, 63);
      doc.text(entry.signature_name, 14, y); y += 6;
    }
    doc.setFontSize(8); doc.setTextColor(110, 130, 152);
    doc.text(`Assinado eletronicamente em ${dt}`, 14, y);
  } else {
    doc.setFontSize(9); doc.setTextColor(213, 78, 78);
    doc.text('Sem assinatura registrada para este lançamento.', 14, y);
  }
  return doc;
}

function receiptFileName(entry) { return `comprovante-${entry.entry_number || entry.id.slice(0, 8)}.pdf`; }
function downloadReceiptPdf(entry) { buildReceiptDoc(entry).save(receiptFileName(entry)); }

function receiptWhatsappMessage(entry) {
  return `Olá! Segue o comprovante da entrega Nº ${entry.entry_number || ''} no valor de ${money(entry.total)}.`;
}
function whatsappTextLink(phone, text) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
async function shareReceiptViaSystem(entry) {
  const blob = buildReceiptDoc(entry).output('blob');
  const file = new File([blob], receiptFileName(entry), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Comprovante de entrega', text: receiptWhatsappMessage(entry) });
    return true;
  }
  return false;
}

function useDraft(key, initial) {
  const [value, setValue] = useState(() => { try { const saved = localStorage.getItem(key); return saved ? JSON.parse(saved) : initial; } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { } }, [key, value]);
  function clear() { try { localStorage.removeItem(key); } catch { } setValue(initial); }
  return [value, setValue, clear];
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
const nav = [['/', 'Visão geral', LayoutDashboard], ['/ordens-servico', 'Ordens de Serviço', Truck], ['/comprovantes', 'Comprovantes', FileText], ['/estoque', 'Estoque', Package], ['/financeiro', 'Financeiro', WalletCards], ['/provisao', 'Provisão de Pagamento', Wallet], ['/clientes', 'Clientes', Users], ['/marcas', 'Marcas de Água', Droplets], ['/marcas-extras', 'Marcas Extras', AlertTriangle], ['/usuarios', 'Usuários', ShieldCheck], ['/fechamento', 'Fechamento', CalendarCheck], ['/atividade', 'Atividade', Activity], ['/relatorios', 'Relatórios', BarChart3]];
const driverNav = [['/', 'Visão geral', LayoutDashboard], ['/controle-diario', 'Controle Diário', CalendarCheck], ['/financeiro', 'Financeiro', WalletCards]];

function Shell({ user, onLogout, notifications, children }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useDraft('hydro_theme', 'light');
  const links = user.role === 'driver' ? driverNav : nav;
  const badges = { '/usuarios': notifications?.pending_users || 0, '/financeiro': notifications?.pending_expenses || 0 };
  const total = notifications?.total || 0;
  return <div className={`app-shell${theme === 'dark' ? ' dark' : ''}`}><aside className={open ? 'sidebar open' : 'sidebar'}><div className="brand"><img src={logoImg} alt="Distribuidora Diane" className="brand-logo" /><span>Distribuidora <span>Diane</span></span></div><div className="workspace"><small>OPERAÇÃO</small><b>{user.role === 'admin' ? 'Admin · Base Central' : 'Entregador'} <span>⌄</span></b></div>
    <nav>{links.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} data-testid={`nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
      <Icon size={18} />{label}
      {badges[to] > 0 && <span className="nav-badge" data-testid={`badge-${to.replace('/', '')}`}>{badges[to]}</span>}
    </NavLink>)}</nav>
    <div className="sidebar-bottom"><div className="support"><span className="live-dot" /> Operação normal</div><button className="logout" data-testid="logout-button" onClick={onLogout}><LogOut size={17} /> Sair da conta</button></div></aside>
    <main className="main"><header><button className="mobile-menu" data-testid="mobile-menu-button" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button><div><p className="eyebrow">{user.role === 'driver' ? 'PORTAL DO ENTREGADOR' : 'PAINEL ADMINISTRATIVO'}</p><h1>Olá, {user.name.split(' ')[0]} <span className="wave">✦</span></h1></div>
      <div className="header-actions">
        <button type="button" className="theme-toggle" data-testid="admin-theme-toggle" aria-label="Alternar tema" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}</button>
        <div className="notification" data-testid="notification-indicator" title={total ? `${total} pendências` : 'Sem pendências'}>{total > 0 && <span data-testid="notification-count">{total}</span>}◌</div>
        <div className="avatar">{user.name.split(' ').map(x => x[0]).join('').slice(0, 2)}</div>
      </div></header>{children}</main></div>
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState(''), [error, setError] = useState(''), [info, setInfo] = useState(''), [showPassword, setShowPassword] = useState(false);
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
  return <div className="login-page"><div className="login-art"><div className="login-brand"><img src={logoImg} alt="Distribuidora Diane" className="login-logo" /> Distribuidora <span>Diane</span></div><div className="login-quote">Água em movimento.<br /><em>Operação sob controle.</em></div></div>
    <form className="login-form" onSubmit={submit}>
      <p className="eyebrow">{isLogin ? 'BEM-VINDO DE VOLTA' : isSignup ? 'CRIAR CONTA' : 'RECUPERAR ACESSO'}</p>
      <h1>{isLogin ? 'Acesse sua operação' : isSignup ? 'Cadastre-se para começar' : 'Esqueceu a senha?'}</h1>
      <p className="muted">{isLogin ? 'Entre para acompanhar tudo que acontece na sua base.' : isSignup ? 'Você entrará como entregador. O administrador precisa aprovar o cadastro.' : 'Peça ao administrador para redefinir sua senha diretamente na plataforma.'}</p>
      {isSignup && <label>Nome completo<input data-testid="signup-name-input" value={name} onChange={e => setName(e.target.value)} /></label>}
      <label>E-mail<input data-testid="login-email-input" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      {!isForgot && <label>Senha<div className="password-field"><input data-testid="login-password-input" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} /><button type="button" className="password-toggle" data-testid="toggle-password-visibility" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
      {error && <div className="error" data-testid="login-error">{error}</div>}
      {info && <div className="info-box" data-testid="login-info">{info}</div>}
      <button className="primary full" data-testid={isSignup ? 'signup-submit-button' : isForgot ? 'forgot-submit-button' : 'login-submit-button'}>
        {isLogin ? <>Entrar na plataforma <ArrowUpRight size={17} /></> : isSignup ? <>Enviar cadastro <UserPlus size={17} /></> : <>Solicitar ajuda <KeyRound size={17} /></>}
      </button>
      <div className="auth-switch">
        {!isLogin && <button type="button" className="link-btn" data-testid="switch-to-login" onClick={() => { setMode('login'); setError(''); setInfo(''); }}>← Voltar ao login</button>}
        {isLogin && <><button type="button" className="link-btn" data-testid="switch-to-signup" onClick={() => { setMode('signup'); setError(''); setInfo(''); setPassword(''); }}>Criar conta</button><button type="button" className="link-btn" data-testid="switch-to-forgot" onClick={() => { setMode('forgot'); setError(''); setInfo(''); }}>Esqueci a senha</button></>}
      </div>
    </form></div>
}

function Head({ eyebrow, title, subtitle, action, onAction, actionTestId }) { return <section className="section-head"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p className="muted">{subtitle}</p></div>{action && <button className="primary" onClick={onAction} data-testid={actionTestId || `new-${title.toLowerCase().replaceAll(' ', '-')}-button`}><Plus size={17} />{action}</button>}</section> }

function Stat({ label, value, detail, Icon, tone = '' }) { return <div className="stat" data-testid={`stat-${label.toLowerCase().replaceAll(' ', '-')}`}><div className={`stat-icon ${tone}`}><Icon size={19} /></div><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></div> }

function Modal({ title, fields, onClose, onSave }) { const [form, setForm] = useState({}), [error, setError] = useState(''); async function submit(e) { e.preventDefault(); if (fields.some(x => x.required !== false && !String(form[x.key] || '').trim())) return setError('Preencha os campos obrigatórios.'); try { await onSave(form) } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.') } } return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} data-testid="modal-close-button"><X /></button><p className="eyebrow">NOVO LANÇAMENTO</p><h3>{title}</h3>{fields.map(f => <label key={f.key}>{f.label}{f.options ? <select required={f.required !== false} data-testid={`modal-${f.key}-input`} onChange={e => setForm({ ...form, [f.key]: e.target.value })}><option value="">Selecione</option>{f.options.map(x => <option key={x}>{x}</option>)}</select> : <input required={f.required !== false} type={f.type || 'text'} data-testid={`modal-${f.key}-input`} onChange={e => setForm({ ...form, [f.key]: e.target.value })} />}</label>)}{error && <div className="error" data-testid="form-validation-error">{error}</div>}<button className="primary full" data-testid="modal-submit-button"><Save size={16} /> Salvar lançamento</button></form></div> }

const fields = { expense: [{ key: 'type', label: 'Categoria', options: ['Combustível', 'Alimentação', 'Pedágio', 'Manutenção', 'Outros'] }, { key: 'driver', label: 'Entregador' }, { key: 'amount', label: 'Valor', type: 'number' }], customer: [{ key: 'name', label: 'Nome / empresa' }, { key: 'address', label: 'Endereço' }, { key: 'phone', label: 'Telefone', required: false }] };

function CustomerModal({ onClose, onSave, customer }) {
  const isEdit = !!customer;
  const [form, setForm] = useState(isEdit
    ? { name: customer.name || '', address: customer.address || '', phone: customer.phone || '', code: customer.code || '', payment_type: customer.payment_type || 'normal' }
    : { name: '', address: '', phone: '', code: '', payment_type: 'normal' });
  const [brands, setBrands] = useState(
    isEdit && brandListOf(customer).length
      ? brandListOf(customer).map(b => ({ brand: b.brand || '', price: b.price ?? '', price_full: b.price_full ?? '' }))
      : [{ brand: '', price: '', price_full: '' }]
  );
  const [error, setError] = useState('');

  function updateBrand(i, key, value) { const next = [...brands]; next[i] = { ...next[i], [key]: value }; setBrands(next); }
  function addBrand() { setBrands([...brands, { brand: '', price: '', price_full: '' }]); }
  function removeBrand(i) { setBrands(brands.filter((_, idx) => idx !== i)); }

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.name.trim() || !form.address.trim()) return setError('Preencha os campos obrigatórios.');
    const cleanBrands = brands.filter(b => b.brand.trim()).map(b => ({ brand: b.brand.trim(), price: Number(b.price) || 0, price_full: b.price_full !== '' ? Number(b.price_full) || 0 : undefined }));
    try { await onSave({ ...form, brands: cleanBrands, brand: cleanBrands[0]?.brand, price: cleanBrands[0]?.price }); }
    catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }

  return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose} data-testid="modal-close-button"><X /></button>
    <p className="eyebrow">{isEdit ? 'EDITAR CADASTRO' : 'NOVO LANÇAMENTO'}</p>
    <h3>{isEdit ? `Editar ${customer.name}` : 'Cadastrar cliente'}</h3>
    <label>Código do cliente<input value={form.code} placeholder="ex: 0047" data-testid="modal-code-input" onChange={e => setForm({ ...form, code: e.target.value })} /></label>
    <label>Nome / empresa<input required value={form.name} data-testid="modal-name-input" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label>Endereço<input required value={form.address} data-testid="modal-address-input" onChange={e => setForm({ ...form, address: e.target.value })} /></label>
    <label>Telefone<input value={form.phone} data-testid="modal-phone-input" onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
    <label>Forma de pagamento<select value={form.payment_type} data-testid="modal-payment-type-input" onChange={e => setForm({ ...form, payment_type: e.target.value })}>
      <option value="normal">Normal — paga na entrega</option>
      <option value="prazo">A prazo — 15 ou 30 dias</option>
    </select></label>
    <label>Produtos que este cliente compra (água, gás, etc.) — preço com troca de vasilhame e, se for diferente, preço do vasilhame completo (novo)</label>
    {brands.map((b, i) => <div className="brand-price-row" key={i}>
      <input placeholder="Produto (ex: Minalar 20L, Gás P13)" value={b.brand} data-testid={`modal-brand-input-${i}`} onChange={e => updateBrand(i, 'brand', e.target.value)} />
      <input type="number" step="0.01" placeholder="Preço c/ troca" value={b.price} data-testid={`modal-brand-price-${i}`} onChange={e => updateBrand(i, 'price', e.target.value)} />
      <input type="number" step="0.01" placeholder="Preço completo (opcional)" value={b.price_full} data-testid={`modal-brand-price-full-${i}`} onChange={e => updateBrand(i, 'price_full', e.target.value)} />
      {brands.length > 1 && <button type="button" className="action-btn reject" onClick={() => removeBrand(i)}><Trash2 size={13} /></button>}
    </div>)}
    <button type="button" className="ghost-btn" data-testid="modal-add-brand" onClick={addBrand}><Plus size={14} /> Adicionar outro produto</button>
    {error && <div className="error" data-testid="form-validation-error">{error}</div>}
    <button className="primary full" data-testid="modal-submit-button"><Save size={16} /> {isEdit ? 'Salvar alterações' : 'Salvar lançamento'}</button>
  </form></div>
}

function PerformanceChart() {
  const [monthly, setMonthly] = useState([]);
  const [hover, setHover] = useState(null);
  useEffect(() => { api.get('/dashboard/monthly', auth()).then(x => setMonthly(x.data)).catch(() => setMonthly([])); }, []);
  const maxVal = Math.max(1, ...monthly.map(m => Math.max(m.revenue, m.expenses)));
  return <div className="chart"><div className="bars">
    {monthly.map((m, i) => <div className="bar-group" key={m.month} data-testid={`chart-bar-${m.month}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
      <div className="bar revenue" style={{ height: `${(m.revenue / maxVal) * 100}%` }} />
      <div className="bar expense" style={{ height: `${(m.expenses / maxVal) * 100}%` }} />
      <span>{m.label}</span>
      {hover === i && <div className="chart-tooltip" data-testid={`chart-tooltip-${m.month}`}>
        <b>{m.label}</b>
        <small><span className="dot blue" />Receita: {money(m.revenue)}</small>
        <small><span className="dot yellow" />Despesas: {money(m.expenses)}</small>
        <small>{m.delivered} de {m.deliveries} entregas concluídas</small>
      </div>}
    </div>)}
  </div></div>
}

function Dashboard({ data, onRefresh, refreshing }) {
  const today = (data?.deliveries || []);
  return <><section className="section-head"><div><p className="eyebrow">PAINEL DE CONTROLE</p><h2>Visão geral</h2><p className="muted">Acompanhe a saúde da sua operação em um só lugar.</p></div>
      <button type="button" className="ghost-btn" data-testid="dashboard-refresh-button" disabled={refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Atualizando...' : 'Atualizar dados'}</button>
    </section>
    <div className="stats">
      <Stat label="Receita no mês" value={money(data?.revenue)} detail="Lançamentos do Controle Diário" Icon={CircleDollarSign} />
      <Stat label="Despesas no mês" value={money(data?.expenses)} detail="Lançadas pelos entregadores" Icon={WalletCards} tone="orange" />
      <Stat label="Receita líquida" value={money((data?.revenue || 0) - (data?.expenses || 0))} detail="Receita − despesas do mês" Icon={Wallet} tone={(data?.revenue || 0) - (data?.expenses || 0) >= 0 ? 'green' : 'red'} />
      <Stat label="Lançamentos hoje" value={today.length} detail="Registrados pelos entregadores" Icon={Truck} tone="green" />
      <Stat label="Alertas de estoque" value={data?.products?.filter(x => x.quantity < x.minimum).length || 0} detail="Itens abaixo do mínimo" Icon={AlertTriangle} tone="red" />
    </div>
    <div className="dashboard-grid">
      <section className="panel performance"><div className="panel-head"><div><h3>Desempenho financeiro</h3><p className="muted">Últimos 6 meses · passe o mouse para ver os detalhes</p></div><BarChart3 className="blue-text" /></div><PerformanceChart /></section>
      <section className="panel route-panel">
        <div className="panel-head"><div><h3>Últimos lançamentos</h3><p className="muted">Controle Diário de hoje</p></div><CalendarCheck size={20} className="blue-text" /></div>
        {today.length === 0 && <p className="muted" style={{ padding: '8px 0' }}>Nenhum lançamento ainda hoje.</p>}
        {today.slice(0, 5).map(e => <div className="route" key={e.id}><div className="route-icon blue-bg"><CircleDollarSign size={18} /></div><div><b>{e.customer}</b><small>{e.driver} · {(e.items?.length ? e.items : [{ brand: e.brand, quantity: e.billed_quantity ?? e.quantity }]).map(it => `${it.quantity} ${it.brand}`).join(' + ')}</small></div><span className="tag green">{money(e.total)}</span></div>)}
      </section>
    </div></> }

const SIGNATURE_COLORS = [['#10253f', 'Preto'], ['#0878d1', 'Azul'], ['#d54e4e', 'Vermelho']];

function SignaturePad({ onSave, onCancel, variant = 'desktop', customer, total, signerName: signerNameProp, onSignerNameChange }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [signerName, setSignerNameState] = useState(signerNameProp || '');
  function setSignerName(v) { setSignerNameState(v); onSignerNameChange?.(v); }
  const [penColor, setPenColor] = useState(SIGNATURE_COLORS[0][0]);
  const penColorRef = useRef(penColor);
  useEffect(() => { penColorRef.current = penColor; }, [penColor]);
  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
    if (variant === 'mobile') { const r = c.parentElement.getBoundingClientRect(); c.width = Math.round(r.width); c.height = Math.round(r.height); }
    const ctx = c.getContext('2d'); ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    const pos = e => { const r = c.getBoundingClientRect(); const t = e.touches?.[0] || e; return [t.clientX - r.left, t.clientY - r.top]; };
    const start = e => { e.preventDefault(); drawing.current = true; ctx.strokeStyle = penColorRef.current; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); setEmpty(false); };
    const move = e => { if (!drawing.current) return; e.preventDefault(); const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); };
    const end = () => { drawing.current = false; };
    c.addEventListener('mousedown', start); c.addEventListener('mousemove', move); window.addEventListener('mouseup', end);
    c.addEventListener('touchstart', start, { passive: false }); c.addEventListener('touchmove', move, { passive: false }); window.addEventListener('touchend', end);
    return () => { c.removeEventListener('mousedown', start); c.removeEventListener('mousemove', move); window.removeEventListener('mouseup', end); c.removeEventListener('touchstart', start); c.removeEventListener('touchmove', move); window.removeEventListener('touchend', end); };
  }, [variant]);
  function clear() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setEmpty(true); }
  function save() { onSave(canvasRef.current.toDataURL('image/png'), signerName.trim()); }

  if (variant === 'mobile') return <div className="mob-signature-screen" data-testid="mob-signature-screen">
    <p className="mob-eyebrow">CONFIRMAÇÃO DE ENTREGA</p>
    <h2 className="mob-sign-title">Assinatura do cliente</h2>
    <p className="mob-sign-sub">{customer}{customer && total != null ? ' · ' : ''}{total != null ? money(total) : ''}</p>
    <div className="mob-sign-colors">
      <span>Cor da caneta</span>
      {SIGNATURE_COLORS.map(([hex, label]) => <button type="button" key={hex} aria-label={label} title={label} className={penColor === hex ? 'active' : ''} style={{ background: hex }} data-testid={`mob-sign-color-${hex}`} onClick={() => setPenColor(hex)} />)}
    </div>
    <div className="mob-sign-area">
      <canvas ref={canvasRef} data-testid="signature-canvas" />
      {empty && <span className="mob-sign-placeholder">Assine com o dedo</span>}
    </div>
    <button type="button" className="mob-sign-clear-btn" data-testid="signature-clear" disabled={empty} onClick={clear}><Eraser size={20} /> Apagar assinatura</button>
    <label className="mob-sign-name-field">
      <span>Nome do assinante</span>
      <input value={signerName} placeholder="Digite o nome de quem assinou" data-testid="signature-name-input" onChange={e => setSignerName(e.target.value)} />
    </label>
    <button type="button" className="mob-cta green" data-testid="signature-save" disabled={empty} onClick={save}>Concluir parada</button>
    <button type="button" className="mob-text-btn" data-testid="signature-close" onClick={onCancel}>Voltar</button>
  </div>;

  return <div className="modal-backdrop"><div className="quick-modal signature-modal">
    <button type="button" className="modal-close" onClick={onCancel} data-testid="signature-close"><X /></button>
    <p className="eyebrow">CONFIRMAÇÃO DE ENTREGA</p>
    <h3>Assinatura do cliente</h3>
    <p className="muted">Peça para o cliente assinar abaixo confirmando o recebimento.</p>
    <canvas ref={canvasRef} width={360} height={180} className="signature-canvas" data-testid="signature-canvas" />
    <label className="signature-name-field"><span>Nome do assinante</span><input value={signerName} placeholder="Digite o nome de quem assinou" data-testid="signature-name-input" onChange={e => setSignerName(e.target.value)} /></label>
    <div className="signature-actions">
      <button type="button" className="ghost-btn signature-clear-btn" data-testid="signature-clear" onClick={clear}><Eraser size={16} /> Apagar assinatura</button>
      <button type="button" className="primary" data-testid="signature-save" onClick={save} disabled={empty}><Check size={16} /> Concluir parada</button>
    </div>
  </div></div>
}

function StockAdjustModal({ product, onClose, onSave }) {
  const [quantity, setQuantity] = useState(product.quantity);
  const [reason, setReason] = useState('Recontagem');
  const [batch, setBatch] = useState(product.batch || '');
  const [purchaseDate, setPurchaseDate] = useState(product.purchase_date || '');
  const [error, setError] = useState('');
  const diff = Number(quantity) - Number(product.quantity || 0);
  async function submit(e) {
    e.preventDefault(); setError('');
    if (quantity === '' || isNaN(Number(quantity))) return setError('Informe uma quantidade válida.');
    try { await onSave({ quantity: Number(quantity), notes: reason, batch, purchase_date: purchaseDate || null }); }
    catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }
  return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose} data-testid="stock-adjust-close"><X /></button>
    <p className="eyebrow">AJUSTE DE ESTOQUE</p>
    <h3>{product.name}</h3>
    <p className="muted">Quantidade atual no sistema: <b>{product.quantity} {product.unit || 'un'}</b></p>
    <label>Quantidade real (após contagem)<input required autoFocus type="number" value={quantity} data-testid="stock-adjust-quantity" onChange={e => setQuantity(e.target.value)} /></label>
    {quantity !== '' && !isNaN(Number(quantity)) && diff !== 0 && <p className={diff > 0 ? 'muted' : 'orange-text'}>{diff > 0 ? `+${diff}` : diff} {product.unit || 'un'} em relação ao valor atual</p>}
    <label>Motivo<select value={reason} data-testid="stock-adjust-reason" onChange={e => setReason(e.target.value)}>
      <option>Recontagem</option>
      <option>Avaria</option>
      <option>Perda/roubo</option>
      <option>Entrada de compra</option>
      <option>Outro</option>
    </select></label>
    <label>Lote<input value={batch} placeholder="ex: L2026-0817" data-testid="stock-adjust-batch" onChange={e => setBatch(e.target.value)} /></label>
    <label>Data de compra<input type="date" value={purchaseDate} data-testid="stock-adjust-purchase-date" onChange={e => setPurchaseDate(e.target.value)} /></label>
    {error && <div className="error" data-testid="stock-adjust-error">{error}</div>}
    <button className="primary full" data-testid="stock-adjust-submit"><Save size={16} /> Salvar ajuste</button>
  </form></div>
}

function ProductModal({ onClose, onSave }) {
  const [brands, setBrands] = useState([]);
  const [form, setForm] = useState({ brand: '', name: '', category: 'Retornável', quantity: '', minimum: '', cost_price: '', batch: '', purchase_date: '' });
  const [error, setError] = useState('');

  useEffect(() => { api.get('/brands', auth()).then(({ data }) => setBrands(data.filter(b => b.active !== false))); }, []);

  function pickBrand(brandName) {
    const b = brands.find(x => x.name === brandName);
    setForm({ ...form, brand: brandName, name: form.name || brandName, cost_price: form.cost_price || (b?.cost_price ?? '') });
  }

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.name.trim()) return setError('Informe o nome do produto.');
    if (form.quantity === '' || form.minimum === '') return setError('Informe quantidade e estoque mínimo.');
    try {
      const payload = { ...form, quantity: Number(form.quantity), minimum: Number(form.minimum) };
      if (payload.cost_price !== '') payload.cost_price = Number(payload.cost_price); else delete payload.cost_price;
      if (!payload.batch) delete payload.batch;
      if (!payload.purchase_date) delete payload.purchase_date;
      await onSave(payload);
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }

  return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose} data-testid="modal-close-button"><X /></button>
    <p className="eyebrow">NOVO LANÇAMENTO</p>
    <h3>Cadastrar produto</h3>
    <label>Marca (cadastrada em Marcas de Água)<select value={form.brand} data-testid="modal-brand-input" onChange={e => pickBrand(e.target.value)}>
      <option value="">Sem marca / outro produto</option>
      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
    </select></label>
    {brands.length === 0 && <p className="muted" style={{ marginTop: -8 }}>Nenhuma marca cadastrada ainda — cadastre em <b>Marcas de Água</b> primeiro para vinculá-la ao estoque.</p>}
    <label>Nome do produto<input required value={form.name} data-testid="modal-name-input" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label>Categoria<select value={form.category} data-testid="modal-category-input" onChange={e => setForm({ ...form, category: e.target.value })}>
      <option>Retornável</option><option>Descartável</option>
    </select></label>
    <label>Quantidade<input required type="number" value={form.quantity} data-testid="modal-quantity-input" onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
    <label>Estoque mínimo<input required type="number" value={form.minimum} data-testid="modal-minimum-input" onChange={e => setForm({ ...form, minimum: e.target.value })} /></label>
    <label>Custo de compra (R$/un){form.brand && <small className="muted"> · puxado da marca, edite se mudou</small>}<input type="number" step="0.01" value={form.cost_price} data-testid="modal-cost_price-input" onChange={e => setForm({ ...form, cost_price: e.target.value })} /></label>
    <label>Lote<input value={form.batch} data-testid="modal-batch-input" onChange={e => setForm({ ...form, batch: e.target.value })} /></label>
    <label>Data de compra<input type="date" value={form.purchase_date} data-testid="modal-purchase_date-input" onChange={e => setForm({ ...form, purchase_date: e.target.value })} /></label>
    {error && <div className="error" data-testid="form-validation-error">{error}</div>}
    <button className="primary full" data-testid="modal-submit-button"><Save size={16} /> Salvar lançamento</button>
  </form></div>
}

function Stock({ data, setData, create }) {
  const [adjusting, setAdjusting] = useState(null);
  async function saveAdjustment(payload) {
    const { data: updated } = await api.patch(`/products/${adjusting.id}`, payload, auth());
    setData({ ...data, products: data.products.map(p => p.id === updated.id ? updated : p) });
    setAdjusting(null);
  }
  return <><Head eyebrow="INVENTÁRIO" title="Estoque" subtitle="Produtos, galões retornáveis e níveis mínimos." action="Novo produto" onAction={() => create('product')} /><div className="stock-alert" data-testid="stock-alert"><AlertTriangle size={19} /><div><b>{data?.products?.filter(x => x.quantity < x.minimum).length || 0} produtos precisam de reposição</b><span>Confira os itens antes da próxima rota.</span></div></div><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>PRODUTO</th><th>MARCA</th><th>CATEGORIA</th><th>DISPONÍVEL</th><th>MÍNIMO</th><th>SITUAÇÃO</th><th>LOTE / COMPRA</th><th /></tr></thead><tbody>{(data?.products || []).map(p => <tr key={p.id} data-testid={`stock-row-${p.id}`}><td><b>{p.name}</b><small>SKU-{p.id}</small></td><td>{p.brand || '—'}</td><td>{p.category}</td><td>{p.quantity} {p.unit || 'un'}</td><td>{p.minimum}</td><td><span className={`tag ${p.quantity < p.minimum ? 'red' : 'green'}`}>{p.quantity < p.minimum ? 'Repor' : 'Saudável'}</span></td><td><small className="muted">{p.batch ? `Lote ${p.batch}` : '—'}{p.purchase_date ? ` · ${p.purchase_date}` : ''}</small></td><td><button className="action-btn ghost" data-testid={`stock-adjust-${p.id}`} onClick={() => setAdjusting(p)}><Pencil size={13} /> Ajustar</button></td></tr>)}</tbody></table></div></section>
    {adjusting && <StockAdjustModal product={adjusting} onClose={() => setAdjusting(null)} onSave={saveAdjustment} />}
  </> }

function Finance({ data, setData, create, user }) {
  const [summary, setSummary] = useState(null);
  async function loadSummary() { const { data: s } = await api.get('/finance/summary', auth()); setSummary(s); }
  useEffect(() => { loadSummary(); }, [data]);
  async function reviewExpense(e, status) {
    const { data: updated } = await api.patch(`/expenses/${e.id}`, { status }, auth());
    setData({ ...data, expenses_list: data.expenses_list.map(x => x.id === e.id ? updated : x) });
    window.hydroRefreshNotifications?.(); loadSummary();
  }
  const isAdmin = user?.role === 'admin';
  return <><Head eyebrow="CONTROLE FINANCEIRO" title="Financeiro" subtitle="Recebimentos e despesas lançados pela equipe, direto do Controle Diário." action="Lançar despesa" onAction={() => create('expense')} />
    <div className="stats">
      <Stat label="Recebido hoje" value={money(summary?.received_today)} detail="Pix + Dinheiro do Controle Diário" Icon={CircleDollarSign} tone="green" />
      <Stat label="Despesas hoje" value={money(summary?.expenses_today_total)} detail="Já lançadas pelos entregadores" Icon={WalletCards} tone="orange" />
      <Stat label="Saldo do dia" value={money(summary?.balance_today)} detail="Recebido − despesas de hoje" Icon={ArrowUpRight} />
      <Stat label="A prazo pendente" value={money(summary?.comp_pending_total)} detail="Vendas ainda não recebidas" Icon={Clock3} tone="orange" />
    </div>
    {isAdmin && <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 23px' }}>
        <div><h3>Vendas a prazo (COMP)</h3><p className="muted">{money(summary?.comp_pending_total)} pendentes · {money(summary?.comp_received_total)} já recebidos</p></div>
        <Link to="/provisao" className="ghost-btn" data-testid="finance-provisao-link"><Wallet size={15} /> Ver Provisão de Pagamento</Link>
      </div>
    </section>}
    <section className="panel table-panel"><div className="panel-head"><div><h3>Despesas</h3><p className="muted">{isAdmin ? 'Aprove ou reprove os lançamentos feitos fora do Controle Diário' : 'Seus lançamentos'}</p></div></div>
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

function Customers({ items, create, onEdit }) {
  const [search, setSearch] = useState('');
  const filtered = items.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || (x.code || '').toLowerCase().includes(search.toLowerCase()));
  return <><Head eyebrow="RELACIONAMENTO" title="Clientes" subtitle="Sua carteira, marcas de água e preço combinado por cliente." action="Novo cliente" onAction={() => create('customer')} />
    <div className="mob-search" style={{ marginBottom: 18, maxWidth: 360 }}><Search size={16} /><input placeholder="Buscar por nome ou código" value={search} data-testid="customers-search-input" onChange={e => setSearch(e.target.value)} /></div>
    <div className="customer-grid">{filtered.map(x => { const brandList = x.brands?.length ? x.brands : (x.brand ? [{ brand: x.brand, price: x.price }] : []); return <div className="customer-card" key={x.id} data-testid={`customer-card-${x.id}`}><div className="customer-avatar">{x.name?.[0]}</div><div><b>{x.name}{x.code && <small style={{ display: 'inline', marginLeft: 6, fontWeight: 400 }}>#{x.code}</small>}</b><span>{x.address}</span><small>{x.phone || 'Sem telefone'}{x.payment_type === 'prazo' && <span className="tag orange" style={{ marginLeft: 6 }}>A prazo</span>}</small>{brandList.length > 0 && <div className="customer-brands">{brandList.map((b, i) => <span className="tag blue" key={i}>{b.brand} · {money(b.price)}</span>)}</div>}</div><button type="button" className="action-btn ghost" data-testid={`customer-edit-${x.id}`} onClick={() => onEdit(x)}><Pencil size={15} /></button></div> })}
    {filtered.length === 0 && <p className="muted">Nenhum cliente encontrado.</p>}
    </div></> }

const DAILY_ENTRY_FIELDS = ['customer', 'brand', 'quantity', 'price', 'mf_quantity', 'comp_value', 'comp_days', 'pix_value', 'cash_value'];

const EXPENSE_CATEGORIES = ['Alimentação', 'Combustível', 'Internet', 'Outros'];

function DailyExpensesTab({ user, date }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft, clearDraft] = useDraft(`hydro_expense_draft_${user.id}_${date}`, { category: EXPENSE_CATEGORIES[0], amount: '' });
  const { category, amount } = draft;
  const setCategory = c => setDraft({ ...draft, category: c });
  const setAmount = a => setDraft({ ...draft, amount: a });
  const [error, setError] = useState('');

  async function load() {
    const { data } = await api.get('/expenses', auth());
    setItems(data.filter(x => (x.driver || '') === user.name && (x.created_at || '').slice(0, 10) === date));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!amount || Number(amount) <= 0) return setError('Informe um valor válido.');
    try {
      const { data } = await api.post('/expenses', { type: category, driver: user.name, amount: Number(amount), status: 'approved' }, auth());
      setItems([data, ...items]); clearDraft();
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível lançar.'); }
  }
  async function remove(id) { await api.delete(`/expenses/${id}`, auth()).catch(() => { }); setItems(items.filter(x => x.id !== id)); }

  const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
  return <section className="panel table-panel">
    <form className="daily-entry-form" style={{ gridTemplateColumns: '1fr 1fr auto' }} onSubmit={submit}>
      <label>Categoria<select value={category} data-testid="expense-category-input" onChange={e => setCategory(e.target.value)}>{EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Valor<input type="number" step="0.01" value={amount} data-testid="expense-amount-input" onChange={e => setAmount(e.target.value)} /></label>
      <button className="primary" data-testid="expense-add-button"><Plus size={15} /> Lançar despesa</button>
    </form>
    {error && <div className="error" data-testid="expense-form-error">{error}</div>}
    <div className="table-wrap"><table><thead><tr><th>CATEGORIA</th><th>VALOR</th><th /></tr></thead><tbody>
      {items.map(x => <tr key={x.id} data-testid={`expense-row-${x.id}`}>
        <td><b>{x.type}</b></td><td>{money(x.amount)}</td>
        <td><button className="action-btn reject" data-testid={`expense-delete-${x.id}`} onClick={() => remove(x.id)}><Trash2 size={13} /></button></td>
      </tr>)}
      {items.length === 0 && <tr><td colSpan={3} className="muted" style={{ padding: 16 }}>Nenhuma despesa lançada nesta data.</td></tr>}
    </tbody>
    {items.length > 0 && <tfoot><tr><td><b>Total</b></td><td><b>{money(total)}</b></td><td /></tr></tfoot>}
    </table></div>
  </section>
}

function DailyControl({ user, customers }) {
  const [date, setDate] = useState(todayISO(0));
  const [tab, setTab] = useState('entries');
  const [entries, setEntries] = useState([]);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [form, setForm] = useDraft(`hydro_daily_draft_${user.id}_${date}`, { trip_number: '1' });
  const [error, setError] = useState('');

  async function load() { const { data } = await api.get('/daily-entries', { ...auth(), params: user.role === 'driver' ? { date, driver: user.name } : { date } }); setEntries(data); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);
  useEffect(() => { api.get('/expenses', auth()).then(({ data }) => setExpensesTotal(data.filter(x => (x.driver || '') === user.name && (x.created_at || '').slice(0, 10) === date).reduce((s, x) => s + Number(x.amount || 0), 0))); }, [date, tab, user.name]);

  function customerBrands(c) { return c?.brands?.length ? c.brands : (c?.brand ? [{ brand: c.brand, price: c.price }] : []); }

  function pickCustomer(name) {
    const c = customers.find(x => x.name === name);
    const opts = customerBrands(c);
    const first = opts[0];
    setForm({ ...form, customer: name, brand: first?.brand || '', price: first?.price ?? '' });
  }
  function pickBrand(brandName) {
    const c = customers.find(x => x.name === form.customer);
    const opt = customerBrands(c).find(b => b.brand === brandName);
    setForm({ ...form, brand: brandName, price: opt?.price ?? form.price });
  }
  const selectedCustomer = customers.find(x => x.name === form.customer);
  const customerFound = !!selectedCustomer;
  const brandOptions = customerBrands(selectedCustomer);
  const expectedTotal = Math.max(0, (Number(form.quantity || 0) - Number(form.mf_quantity || 0)) * Number(form.price || 0));
  const remainingForCash = Math.max(0, expectedTotal - Number(form.comp_value || 0));
  function setPix(v) { const pix = Number(v) || 0; setForm({ ...form, pix_value: v, cash_value: v === '' ? form.cash_value : String(Math.max(0, remainingForCash - pix)) }); }
  function setCash(v) { const cash = Number(v) || 0; setForm({ ...form, cash_value: v, pix_value: v === '' ? form.pix_value : String(Math.max(0, remainingForCash - cash)) }); }

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.customer || !form.quantity) return setError('Informe ao menos cliente e quantidade.');
    const payload = { ...form, date };
    DAILY_ENTRY_FIELDS.filter(k => k !== 'customer' && k !== 'brand').forEach(k => { if (payload[k] !== undefined && payload[k] !== '') payload[k] = Number(payload[k]) });
    try {
      const { data } = await api.post('/daily-entries', payload, auth());
      setEntries([data, ...entries]);
      setForm({ trip_number: form.trip_number });
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível lançar.'); }
  }

  async function remove(id) { await api.delete(`/daily-entries/${id}`, auth()); setEntries(entries.filter(x => x.id !== id)); }

  const totals = entries.reduce((s, e) => ({ qty: s.qty + Number(e.quantity || 0), pix: s.pix + Number(e.pix_value || 0), cash: s.cash + Number(e.cash_value || 0), total: s.total + Number(e.total || 0) }), { qty: 0, pix: 0, cash: 0, total: 0 });

  const received = totals.total;
  const balance = received - expensesTotal;
  return <><Head eyebrow="OPERAÇÃO DIÁRIA" title="Controle Diário" subtitle="Lance cada cliente atendido na viagem e as despesas do dia, igual ao controle de papel." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>Data<input type="date" value={date} data-testid="daily-date-input" onChange={e => setDate(e.target.value)} /></label>
        <label>Nº Viagem<input value={form.trip_number || ''} data-testid="daily-trip-input" onChange={e => setForm({ ...form, trip_number: e.target.value })} /></label>
      </div>
    </div>
    <div className="stats">
      <Stat label="Recebido hoje" value={money(received)} detail="Pix + Dinheiro + a prazo" Icon={CircleDollarSign} tone="green" />
      <Stat label="Despesas do dia" value={money(expensesTotal)} detail="Alimentação, combustível, internet..." Icon={WalletCards} tone="orange" />
      <Stat label="Saldo a repassar" value={money(balance)} detail="Recebido − despesas" Icon={ArrowUpRight} />
    </div>
    <div className="filter-row">
      <button className={tab === 'entries' ? 'active' : ''} data-testid="daily-tab-entries" onClick={() => setTab('entries')}>Lançamentos</button>
      <button className={tab === 'expenses' ? 'active' : ''} data-testid="daily-tab-expenses" onClick={() => setTab('expenses')}>Despesas do Dia</button>
    </div>
    {tab === 'expenses' ? <DailyExpensesTab user={user} date={date} /> : <section className="panel table-panel">
      <form className="daily-entry-form" onSubmit={submit}>
        <label>Cliente<input list="daily-customers" value={form.customer || ''} data-testid="daily-customer-input" onChange={e => pickCustomer(e.target.value)} /><datalist id="daily-customers">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist></label>
        <label>Marca{brandOptions.length > 1
          ? <select value={form.brand || ''} data-testid="daily-brand-select" onChange={e => pickBrand(e.target.value)}>{brandOptions.map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}</select>
          : <input value={form.brand || ''} readOnly={customerFound} placeholder={customerFound ? '' : 'Cliente sem cadastro'} data-testid="daily-brand-input" onChange={e => setForm({ ...form, brand: e.target.value })} />}
        </label>
        <label>Qtd programada<input type="number" value={form.quantity || ''} data-testid="daily-quantity-input" onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
        <label>Valor água<input type="number" step="0.01" value={form.price || ''} readOnly={customerFound} placeholder={customerFound ? '' : 'Cliente sem cadastro'} data-testid="daily-price-input" onChange={e => setForm({ ...form, price: e.target.value })} /></label>
        <label>MF (não entregue)<input type="number" value={form.mf_quantity || ''} data-testid="daily-mf-input" onChange={e => setForm({ ...form, mf_quantity: e.target.value })} /></label>
        <label>Valor a prazo<input type="number" step="0.01" value={form.comp_value || ''} data-testid="daily-comp-value-input" onChange={e => setForm({ ...form, comp_value: e.target.value })} /></label>
        <label>Prazo<select data-testid="daily-comp-days-input" value={form.comp_days || '15'} onChange={e => setForm({ ...form, comp_days: e.target.value })}><option value="15">15 dias</option><option value="30">30 dias</option></select></label>
        <label>Pix<input type="number" step="0.01" value={form.pix_value || ''} data-testid="daily-pix-input" onChange={e => setPix(e.target.value)} /></label>
        <label>Dinheiro<input type="number" step="0.01" value={form.cash_value || ''} data-testid="daily-cash-input" onChange={e => setCash(e.target.value)} /></label>
        <button className="primary" data-testid="daily-add-button"><Plus size={15} /> Lançar</button>
      </form>
      {expectedTotal > 0 && <p className="muted" style={{ padding: '0 22px 14px' }} data-testid="daily-expected-total">Total a receber deste lançamento: <b>{money(expectedTotal)}</b>{form.comp_value ? ` (${money(remainingForCash)} em Pix/Dinheiro + ${money(Number(form.comp_value))} a prazo)` : ''}</p>}
      {error && <div className="error" data-testid="daily-form-error">{error}</div>}
      <div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>MARCA</th><th>QTD PROG.</th><th>MF</th><th>QTD ENTREGUE</th><th>VALOR ÁGUA</th><th>A PRAZO</th><th>PIX</th><th>DINHEIRO</th><th>TOTAL</th><th /></tr></thead><tbody>
        {entries.map(e => <tr key={e.id} data-testid={`daily-row-${e.id}`}>
          <td><b>{e.customer}</b></td><td>{e.brand}</td><td>{e.quantity}</td>
          <td>{e.mf_quantity ? <span className="tag orange">{e.mf_quantity} un.</span> : '—'}</td>
          <td>{e.billed_quantity ?? e.quantity}</td><td>{money(e.price)}</td>
          <td>{e.comp_value ? `${money(e.comp_value)} · ${e.comp_days}d${e.received ? ' · recebido' : ''}` : '—'}</td>
          <td>{e.pix_value ? money(e.pix_value) : '—'}</td><td>{e.cash_value ? money(e.cash_value) : '—'}</td>
          <td><b>{money(e.total)}</b></td>
          <td><button className="action-btn reject" data-testid={`daily-delete-${e.id}`} onClick={() => remove(e.id)}><Trash2 size={13} /></button></td>
        </tr>)}
        {entries.length === 0 && <tr><td colSpan={11} className="muted" style={{ padding: 16 }}>Nenhum lançamento nesta data.</td></tr>}
      </tbody>
      {entries.length > 0 && <tfoot><tr><td colSpan={4}><b>Totais</b></td><td><b>{totals.qty}</b></td><td /><td /><td>{money(totals.pix)}</td><td>{money(totals.cash)}</td><td><b>{money(totals.total)}</b></td><td /></tr></tfoot>}
      </table></div>
    </section>}</>
}

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
  const [form, setForm] = useState(modal.user ? { name: modal.user.name, email: modal.user.email, role: modal.user.role, phone: modal.user.phone || '' } : { role: 'driver', phone: '' });
  const [error, setError] = useState('');
  async function submit(e) {
    e.preventDefault(); setError('');
    try {
      if (modal.mode === 'create') { await api.post('/users', form, auth()); }
      else if (modal.mode === 'edit') { await api.patch(`/users/${modal.user.id}`, { name: form.name, email: form.email, role: form.role, phone: form.phone }, auth()); }
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
      <label>Perfil<select value={form.role} data-testid="user-form-role" onChange={e => setForm({ ...form, role: e.target.value })}><option value="driver">Entregador</option><option value="admin">Administrador</option></select></label>
      <label>WhatsApp / Telefone<input value={form.phone || ''} placeholder="ex: 5592999999999" data-testid="user-form-phone" onChange={e => setForm({ ...form, phone: e.target.value })} /></label></>}
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(8, 120, 209);
    doc.text('Distribuidora Diane · Fechamento do Dia', 14, 20);
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
    doc.save(`distribuidora-diane-fechamento-${date}.pdf`);
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
      <Stat label="Lançamentos" value={totals.deliveries_total || 0} detail="Registrados no Controle Diário" Icon={Truck} />
    </div>
    <section className="panel table-panel" data-testid="closing-panel">
      <div className="panel-head"><div><h3>Fechamento por entregador</h3><p className="muted">{rows.length ? `${rows.length} entregador(es) com movimentação no dia` : 'Nenhuma movimentação encontrada para essa data'}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>ENTREGADOR</th><th>LANÇAMENTOS</th><th>RECEITA</th><th>DESP. APROVADAS</th><th>DESP. PENDENTES</th><th>SALDO</th></tr></thead><tbody>
        {rows.map(d => <tr key={d.driver} data-testid={`closing-row-${d.driver}`}>
          <td><b>{d.driver}</b></td>
          <td><span className="tag blue">{d.deliveries_total}</span></td>
          <td>{money(d.revenue)}</td>
          <td className="green-text">{money(d.expenses_approved)}</td>
          <td className="orange-text">{money(d.expenses_pending)}</td>
          <td><b>{money(d.balance)}</b></td>
        </tr>)}
      </tbody></table></div>
    </section></>
}

function todayISO(offset = 0) {
  // America/Manaus is fixed UTC-4 (no DST): shift the current instant by -4h,
  // then read UTC date parts off that — gives the Manaus calendar date
  // regardless of the browser/device's own timezone setting.
  const manaus = new Date(Date.now() - 4 * 3600 * 1000);
  manaus.setUTCDate(manaus.getUTCDate() + offset);
  return manaus.toISOString().slice(0, 10);
}

function Receivables() {
  const [filter, setFilter] = useState('pending');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [data, setData] = useState({ rows: [], totals: {} });
  async function load() {
    const params = {}; if (filter !== 'all') params.status = filter; if (start) params.start = start; if (end) params.end = end;
    const { data: r } = await api.get('/reports/receivables', { ...auth(), params }); setData(r);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [filter, start, end]);
  async function markReceived(row) { await api.patch(`/daily-entries/${row.id}`, { received: !row.received }, auth()); load(); }
  const today = todayISO(0);
  return <><Head eyebrow="CONTAS A RECEBER" title="Provisão de Pagamento" subtitle="Vendas a prazo (COMP), organizadas pela data prevista de recebimento — entrega + 15/30 dias." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>Vencimento de<input type="date" value={start} max={end || undefined} data-testid="receivables-start-date" onChange={e => setStart(e.target.value)} /></label>
        <label>até<input type="date" value={end} min={start || undefined} data-testid="receivables-end-date" onChange={e => setEnd(e.target.value)} /></label>
        {(start || end) && <button className="ghost-btn" data-testid="receivables-clear-dates" onClick={() => { setStart(''); setEnd(''); }}>Limpar período</button>}
      </div>
    </div>
    <div className="filter-row">
      <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')} data-testid="receivables-filter-pending">Pendentes</button>
      <button className={filter === 'received' ? 'active' : ''} onClick={() => setFilter('received')} data-testid="receivables-filter-received">Recebidos</button>
      <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} data-testid="receivables-filter-all">Todos</button>
    </div>
    <div className="stats">
      <Stat label="A receber" value={money(data.totals.pending)} detail="Ainda não recebido" Icon={Clock3} tone="orange" />
      <Stat label="Já recebido" value={money(data.totals.received)} detail="Confirmado pelo admin" Icon={CircleDollarSign} tone="green" />
    </div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>ENTREGADOR</th><th>DATA DA ENTREGA</th><th>PRAZO</th><th>VENCIMENTO</th><th>VALOR</th><th>SITUAÇÃO</th><th /></tr></thead><tbody>
      {data.rows.map(r => {
        const overdue = !r.received && r.due_date && r.due_date < today;
        return <tr key={r.id} data-testid={`receivable-row-${r.id}`}>
          <td><b>{r.customer}</b></td><td>{r.driver}</td><td>{r.date}</td><td>{r.comp_days} dias</td>
          <td>{r.due_date}{overdue && <small className="orange-text">Vencido</small>}</td>
          <td>{money(r.comp_value)}</td>
          <td><span className={`tag ${r.received ? 'green' : overdue ? 'red' : 'orange'}`}>{r.received ? 'Recebido' : overdue ? 'Vencido' : 'Aguardando'}</span></td>
          <td><button className="action-btn ghost" data-testid={`toggle-receivable-${r.id}`} onClick={() => markReceived(r)}>{r.received ? 'Reabrir' : 'Marcar recebido'}</button></td>
        </tr>
      })}
      {data.rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 16 }}>Nenhuma venda a prazo encontrada.</td></tr>}
    </tbody></table></div></section></>
}

function BrandsCatalog() {
  const [brands, setBrands] = useState([]);
  const [form, setForm] = useState({ code: '', name: '', cost_price: '' });
  const [error, setError] = useState('');
  const [editingCost, setEditingCost] = useState(null);
  const [costDraft, setCostDraft] = useState('');

  async function load() { const { data } = await api.get('/brands', auth()); setBrands(data); }
  useEffect(() => { load(); }, []);

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.name.trim()) return setError('Informe o nome da marca.');
    try {
      const payload = { ...form, active: true };
      if (payload.cost_price !== '') payload.cost_price = Number(payload.cost_price); else delete payload.cost_price;
      const { data } = await api.post('/brands', payload, auth());
      setBrands([data, ...brands]); setForm({ code: '', name: '', cost_price: '' });
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }

  async function toggleActive(b) { const { data } = await api.patch(`/brands/${b.id}`, { active: !(b.active !== false) }, auth()); setBrands(brands.map(x => x.id === b.id ? data : x)); }
  async function remove(b) { if (!window.confirm(`Excluir a marca "${b.name}"?`)) return; await api.delete(`/brands/${b.id}`, auth()); setBrands(brands.filter(x => x.id !== b.id)); }
  async function saveCost(b) {
    const { data } = await api.patch(`/brands/${b.id}`, { cost_price: Number(costDraft) || 0 }, auth());
    setBrands(brands.map(x => x.id === b.id ? data : x)); setEditingCost(null);
  }

  return <><Head eyebrow="CADASTRO" title="Marcas de Água" subtitle="Catálogo de marcas com código e custo de compra, usado no cadastro de clientes, nos lançamentos e no cálculo de lucro por marca." />
    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <form className="daily-entry-form" style={{ gridTemplateColumns: '.6fr 1.2fr .8fr auto' }} onSubmit={submit}>
        <label>Código<input placeholder="ex: 0001" value={form.code} data-testid="brand-code-input" onChange={e => setForm({ ...form, code: e.target.value })} /></label>
        <label>Marca<input required placeholder="ex: Minalar" value={form.name} data-testid="brand-name-input" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>Custo de compra (R$/un)<input type="number" step="0.01" placeholder="0,00" value={form.cost_price} data-testid="brand-cost-input" onChange={e => setForm({ ...form, cost_price: e.target.value })} /></label>
        <button className="primary" data-testid="brand-submit-button"><Plus size={15} /> Adicionar</button>
      </form>
      {error && <div className="error" style={{ margin: '0 23px 16px' }} data-testid="brand-form-error">{error}</div>}
    </section>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>CÓDIGO</th><th>MARCA</th><th>CUSTO DE COMPRA</th><th>SITUAÇÃO</th><th /></tr></thead><tbody>
      {brands.map(b => { const active = b.active !== false; return <tr key={b.id} data-testid={`brand-row-${b.id}`}>
        <td>{b.code || '—'}</td><td><b>{b.name}</b></td>
        <td>{editingCost === b.id
          ? <div className="row-actions"><input type="number" step="0.01" autoFocus style={{ width: 90 }} value={costDraft} data-testid={`brand-cost-edit-${b.id}`} onChange={e => setCostDraft(e.target.value)} /><button type="button" className="action-btn approve" data-testid={`brand-cost-save-${b.id}`} onClick={() => saveCost(b)}><Check size={13} /></button></div>
          : <button type="button" className="action-btn ghost" data-testid={`brand-cost-${b.id}`} onClick={() => { setEditingCost(b.id); setCostDraft(b.cost_price ?? ''); }}>{b.cost_price ? money(b.cost_price) : <span className="muted">definir</span>} <Pencil size={12} /></button>}
        </td>
        <td><span className={`tag ${active ? 'green' : 'gray'}`}>{active ? 'Ativa' : 'Inativa'}</span></td>
        <td><div className="row-actions">
          <button className="action-btn ghost" data-testid={`brand-toggle-${b.id}`} onClick={() => toggleActive(b)}>{active ? 'Desativar' : 'Ativar'}</button>
          <button className="action-btn reject" data-testid={`brand-delete-${b.id}`} onClick={() => remove(b)}><Trash2 size={13} /></button>
        </div></td>
      </tr> })}
      {brands.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Nenhuma marca cadastrada.</td></tr>}
    </tbody></table></div></section></>
}

function OutOfCatalogBrands() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  async function load() { const { data } = await api.get('/customers/out-of-catalog-brands', auth()); setRows(data); }
  useEffect(() => { load(); }, []);
  async function promote(row) {
    if (!row.customer_id) return setError(`"${row.customer}" não é um cliente cadastrado — cadastre-o primeiro em Clientes.`);
    setBusy(`${row.customer}-${row.brand}`); setError('');
    try { await api.post(`/customers/${row.customer_id}/promote-brand`, { brand: row.brand, price: row.price }, auth()); await load(); }
    catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
    finally { setBusy(null); }
  }
  return <><Head eyebrow="CADASTRO" title="Marcas Extras" subtitle="Marcas que os entregadores lançaram fora do cadastro do cliente — revise e salve as que devem virar padrão." />
    {error && <div className="error" style={{ marginBottom: 16 }} data-testid="out-of-catalog-error">{error}</div>}
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>MARCA</th><th>PREÇO USADO</th><th>Nº DE VEZES</th><th>ÚLTIMO LANÇAMENTO</th><th /></tr></thead><tbody>
      {rows.map(r => <tr key={`${r.customer}-${r.brand}`} data-testid={`out-of-catalog-row-${r.customer}-${r.brand}`}>
        <td><b>{r.customer}</b>{!r.customer_id && <small className="orange-text">Cliente sem cadastro</small>}</td>
        <td>{r.brand}</td><td>{money(r.price)}</td><td>{r.count}</td><td>{r.last_date}</td>
        <td><button className="action-btn approve" disabled={busy === `${r.customer}-${r.brand}`} data-testid={`promote-brand-${r.customer}-${r.brand}`} onClick={() => promote(r)}><Check size={13} /> Salvar no cadastro</button></td>
      </tr>)}
      {rows.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Nenhuma marca fora do cadastro pendente de revisão.</td></tr>}
    </tbody></table></div></section></>
}

function whatsappLinkFor(order, driverUser) {
  const phone = (driverUser?.phone || '').replace(/\D/g, '');
  if (!phone) return null;
  const lines = [
    'Nova ordem de serviço de entrega:',
    `Cliente: ${order.customer}`,
    order.address ? `Endereço: ${order.address}` : null,
    `Produto: ${order.brand || '—'}`,
    order.quantity ? `Quantidade: ${order.quantity}` : null,
    order.notes ? `Obs: ${order.notes}` : null,
  ].filter(Boolean);
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join('\n'))}`;
}

function ServiceOrders({ customers }) {
  const [orders, setOrders] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [form, setForm] = useState({ customer: '', address: '', brand: '', quantity: '', driver: '', notes: '' });
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('pending');

  async function load() { const { data } = await api.get('/service-orders', auth()); setOrders(data); }
  useEffect(() => {
    load();
    api.get('/users', auth()).then(({ data }) => setDrivers(data.filter(u => u.role === 'driver' && u.active !== false)));
  }, []);

  function pickCustomer(name) {
    const c = customers.find(x => x.name === name);
    const brandOpts = brandListOf(c);
    setForm({ ...form, customer: name, address: c?.address || form.address, brand: brandOpts[0]?.brand || '' });
  }
  const selectedCustomer = customers.find(x => x.name === form.customer);
  const brandOptions = brandListOf(selectedCustomer);

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.customer.trim() || !form.driver) return setError('Selecione o cliente e o entregador.');
    try {
      const payload = { ...form, quantity: form.quantity ? Number(form.quantity) : undefined };
      const { data } = await api.post('/service-orders', payload, auth());
      setOrders([data, ...orders]);
      setForm({ customer: '', address: '', brand: '', quantity: '', driver: form.driver, notes: '' });
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível criar a ordem.'); }
  }

  async function setStatus(o, status) { const { data } = await api.patch(`/service-orders/${o.id}`, { status }, auth()); setOrders(orders.map(x => x.id === o.id ? data : x)); }
  async function remove(o) { if (!window.confirm(`Excluir a ordem de serviço de ${o.customer}?`)) return; await api.delete(`/service-orders/${o.id}`, auth()); setOrders(orders.filter(x => x.id !== o.id)); }

  const filtered = orders.filter(o => filter === 'all' || (o.status || 'pending') === filter);
  const statusLabel = { pending: 'Pendente', done: 'Concluída', cancelled: 'Cancelada' };
  const statusTag = { pending: 'orange', done: 'green', cancelled: 'gray' };

  return <><Head eyebrow="LOGÍSTICA" title="Ordens de Serviço" subtitle="Solicitações de entrega recebidas pelo admin, direcionadas para o entregador." />
    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <form className="os-form" onSubmit={submit}>
        <label>Cliente<input list="os-customers" required value={form.customer} data-testid="os-customer-input" onChange={e => pickCustomer(e.target.value)} /><datalist id="os-customers">{customers.map(c => <option key={c.id} value={c.name} />)}</datalist></label>
        <label>Endereço<input value={form.address} data-testid="os-address-input" onChange={e => setForm({ ...form, address: e.target.value })} /></label>
        <label>Produto{brandOptions.length > 0
          ? <select value={form.brand} data-testid="os-product-select" onChange={e => setForm({ ...form, brand: e.target.value })}>{brandOptions.map(b => <option key={b.brand} value={b.brand}>{b.brand} · {money(b.price)}</option>)}</select>
          : <input placeholder="ex: Minalar 20L" value={form.brand} data-testid="os-product-input" onChange={e => setForm({ ...form, brand: e.target.value })} />}
        </label>
        <label className="os-field-narrow">Qtd<input type="number" value={form.quantity} data-testid="os-quantity-input" onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>
        <label>Entregador<select required value={form.driver} data-testid="os-driver-select" onChange={e => setForm({ ...form, driver: e.target.value })}><option value="">Selecione</option>{drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></label>
        <label>Observações<input value={form.notes} data-testid="os-notes-input" onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
        {error && <div className="error" data-testid="os-form-error">{error}</div>}
        <button className="primary os-submit" data-testid="os-submit-button"><Plus size={15} /> Criar ordem de serviço</button>
      </form>
    </section>

    <div className="filter-row">
      <button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')} data-testid="os-filter-pending">Pendentes</button>
      <button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')} data-testid="os-filter-done">Concluídas</button>
      <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')} data-testid="os-filter-all">Todas</button>
    </div>

    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>PRODUTO</th><th>QTD</th><th>ENTREGADOR</th><th>SITUAÇÃO</th><th /></tr></thead><tbody>
      {filtered.map(o => {
        const driverUser = drivers.find(d => d.name === o.driver);
        const link = whatsappLinkFor(o, driverUser);
        const status = o.status || 'pending';
        return <tr key={o.id} data-testid={`os-row-${o.id}`}>
          <td><b>{o.customer}</b>{o.address && <small>{o.address}</small>}{o.notes && <small className="muted">{o.notes}</small>}</td>
          <td>{o.brand || '—'}</td>
          <td>{o.quantity || '—'}</td>
          <td>{o.driver}</td>
          <td><span className={`tag ${statusTag[status]}`}>{statusLabel[status]}</span></td>
          <td><div className="row-actions">
            {link ? <a className="action-btn approve" href={link} target="_blank" rel="noreferrer" data-testid={`os-whatsapp-${o.id}`}>WhatsApp</a> : <span className="muted" style={{ fontSize: 11 }} title="Cadastre o telefone do entregador em Usuários">Sem telefone</span>}
            {status === 'pending' && <button className="action-btn ghost" data-testid={`os-done-${o.id}`} onClick={() => setStatus(o, 'done')}><Check size={13} /> Concluir</button>}
            {status !== 'cancelled' && status !== 'done' && <button className="action-btn reject" data-testid={`os-cancel-${o.id}`} onClick={() => setStatus(o, 'cancelled')}><XCircle size={13} /> Cancelar</button>}
            <button className="action-btn reject" data-testid={`os-delete-${o.id}`} onClick={() => remove(o)}><Trash2 size={13} /></button>
          </div></td>
        </tr>
      })}
      {filtered.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Nenhuma ordem de serviço encontrada.</td></tr>}
    </tbody></table></div></section></>
}

function SignatureViewModal({ entry, customer, onClose }) {
  const items = entryItemsList(entry);
  const phone = customer?.phone;
  const waLink = phone ? whatsappTextLink(phone, receiptWhatsappMessage(entry)) : null;
  return <div className="modal-backdrop" onClick={onClose}>
    <div className="quick-modal" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close" onClick={onClose} data-testid="signature-view-close"><X /></button>
      <p className="eyebrow">COMPROVANTE DE ENTREGA{entry.entry_number ? ` · Nº ${entry.entry_number}` : ''}</p>
      <h3>{entry.customer}</h3>
      <p className="muted">{entry.date} · {entry.driver} · {items.map(it => `${it.quantity} ${it.brand}`).join(' + ')} · {money(entry.total)}</p>
      {entry.signature ? <>
        <img src={entry.signature} alt="Assinatura do cliente" style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }} data-testid="signature-view-image" />
        {entry.signature_name && <p className="muted" style={{ marginTop: 4 }} data-testid="signature-view-name">Assinado por: <b>{entry.signature_name}</b></p>}
      </> : <p className="muted" data-testid="signature-view-missing">Este lançamento não tem assinatura registrada.</p>}
      <div className="row-actions" style={{ marginTop: 4 }}>
        <button type="button" className="action-btn ghost" data-testid="receipt-download-pdf" onClick={() => downloadReceiptPdf(entry)}><FileText size={13} /> Baixar comprovante (PDF)</button>
        {waLink ? <a className="action-btn approve" href={waLink} target="_blank" rel="noreferrer" data-testid="receipt-whatsapp">WhatsApp (baixe o PDF e anexe)</a> : <span className="muted" style={{ fontSize: 11 }} title="Cadastre o telefone do cliente">Sem telefone cadastrado</span>}
      </div>
    </div>
  </div>
}

function Receipts({ customers }) {
  const [entries, setEntries] = useState([]);
  const [start, setStart] = useState(todayISO(-7));
  const [end, setEnd] = useState(todayISO(0));
  const [customer, setCustomer] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = { start, end }; if (customer.trim()) params.customer = customer.trim();
      const { data } = await api.get('/daily-entries', { ...auth(), params });
      setEntries(data);
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [start, end]);

  return <><Head eyebrow="AUDITORIA" title="Comprovantes de Entrega" subtitle="Busque um lançamento por cliente e período para conferir a assinatura, caso o cliente reclame que não recebeu." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>De<input type="date" value={start} max={end} data-testid="receipts-start-date" onChange={e => setStart(e.target.value)} /></label>
        <label>Até<input type="date" value={end} min={start} data-testid="receipts-end-date" onChange={e => setEnd(e.target.value)} /></label>
        <label>Cliente<input value={customer} placeholder="Buscar por nome" data-testid="receipts-customer-input" onChange={e => setCustomer(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} /></label>
        <button type="button" className="ghost-btn" data-testid="receipts-search-button" onClick={load}><Search size={14} /> Buscar</button>
      </div>
      {loading && <Loader2 size={16} className="spin blue-text" />}
    </div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Nº</th><th>DATA</th><th>CLIENTE</th><th>ENTREGADOR</th><th>PRODUTO</th><th>TOTAL</th><th>ASSINATURA</th><th /></tr></thead><tbody>
      {entries.map(e => {
        const items = e.items?.length ? e.items : (e.brand ? [{ brand: e.brand, quantity: e.billed_quantity ?? e.quantity }] : []);
        return <tr key={e.id} data-testid={`receipt-row-${e.id}`}>
          <td>{e.entry_number ? `#${e.entry_number}` : '—'}</td>
          <td>{e.date}</td>
          <td><b>{e.customer}</b></td>
          <td>{e.driver}</td>
          <td>{items.map(it => `${it.quantity} ${it.brand}`).join(' + ')}</td>
          <td>{money(e.total)}</td>
          <td>{e.signature ? <span className="tag green">Assinado</span> : <span className="tag gray">Sem assinatura</span>}</td>
          <td><button className="action-btn ghost" data-testid={`receipt-view-${e.id}`} onClick={() => setViewing(e)}><FileText size={13} /> Ver</button></td>
        </tr>
      })}
      {entries.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 16 }}>Nenhum lançamento encontrado no período/busca.</td></tr>}
    </tbody></table></div></section>
    {viewing && <SignatureViewModal entry={viewing} customer={customers.find(c => c.name === viewing.customer)} onClose={() => setViewing(null)} />}
  </>
}

function Reports() {
  const [r, setR] = useState(null);
  const [profit, setProfit] = useState(null);
  const [profitByBrand, setProfitByBrand] = useState(null);
  const [start, setStart] = useState(todayISO(-30));
  const [end, setEnd] = useState(todayISO(0));
  const [preset, setPreset] = useState('30');
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [{ data }, { data: p }, { data: pb }] = await Promise.all([
        api.get('/reports', { ...auth(), params: { start, end } }),
        api.get('/reports/profit-by-customer', { ...auth(), params: { start, end } }),
        api.get('/reports/profit-by-brand', { ...auth(), params: { start, end } }),
      ]);
      setR(data); setProfit(p); setProfitByBrand(pb);
    } catch {
      setR({ revenue: 0, expenses: 0, deliveries: 0, low_stock: 0, drivers: [] }); setProfit({ rows: [], totals: {} }); setProfitByBrand({ rows: [], totals: {} });
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [start, end]);

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
    link.download = `distribuidora-diane-relatorio-${start}-a-${end}.csv`;
    link.click();
  }

  function exportPDF() {
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(8, 120, 209);
    doc.text('Distribuidora Diane · Relatório Operacional', 14, 20);
    doc.setFontSize(10); doc.setTextColor(110, 130, 152);
    doc.text(`Período: ${start} a ${end}`, 14, 28);
    doc.setFontSize(11); doc.setTextColor(16, 37, 63);
    doc.text(`Receita: ${money(r?.revenue)}`, 14, 40);
    doc.text(`Despesas: ${money(r?.expenses)}`, 14, 47);
    doc.text(`Lançamentos: ${r?.deliveries || 0}`, 14, 54);
    doc.text(`Lucro total: ${money(profit?.totals?.profit)}`, 14, 61);
    doc.text(`Alertas de estoque: ${r?.low_stock || 0}`, 14, 68);
    autoTable(doc, {
      startY: 76,
      head: [['Entregador', 'Lançamentos', 'Receita']],
      body: (r?.drivers || []).map(d => [d.driver, d.deliveries, money(d.revenue)]),
      headStyles: { fillColor: [8, 120, 209] },
    });
    autoTable(doc, {
      head: [['Marca / Produto', 'Qtd', 'Receita', 'Custo', 'Lucro']],
      body: (profitByBrand?.rows || []).map(p => [p.brand, p.quantity, money(p.revenue), money(p.cost), money(p.profit)]),
      headStyles: { fillColor: [8, 120, 209] },
    });
    doc.save(`distribuidora-diane-relatorio-${start}-a-${end}.pdf`);
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
    <div className="stats"><Stat label="Receita realizada" value={money(r?.revenue)} detail="Entregas concluídas" Icon={CircleDollarSign} /><Stat label="Despesas" value={money(r?.expenses)} detail="Lançamentos" Icon={WalletCards} tone="orange" /><Stat label="Lucro total" value={money(profit?.totals?.profit)} detail="Receita − custo de compra" Icon={ArrowUpRight} tone="green" /><Stat label="Alertas estoque" value={r?.low_stock || 0} detail="Atenção necessária" Icon={AlertTriangle} tone="red" /></div>
    <section className="panel table-panel"><div className="panel-head"><div><h3>Desempenho por entregador</h3><p className="muted">Volume e receita no período</p></div></div><div className="table-wrap"><table><thead><tr><th>ENTREGADOR</th><th>LANÇAMENTOS</th><th>RECEITA</th></tr></thead><tbody>{(r?.drivers || []).map(d => <tr key={d.driver}><td><b>{d.driver}</b></td><td>{d.deliveries}</td><td>{money(d.revenue)}</td></tr>)}</tbody></table></div></section>
    <section className="panel table-panel" data-testid="profit-by-customer-panel"><div className="panel-head"><div><h3>Lucro por cliente</h3><p className="muted">Valor de venda − custo de compra da água, por cliente, no período.</p></div></div><div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>QTD</th><th>RECEITA</th><th>CUSTO</th><th>LUCRO</th></tr></thead><tbody>
      {(profit?.rows || []).map(p => <tr key={p.customer} data-testid={`profit-row-${p.customer}`}><td><b>{p.customer}</b></td><td>{p.quantity}</td><td>{money(p.revenue)}</td><td>{money(p.cost)}</td><td><b className={p.profit >= 0 ? 'green-text' : 'orange-text'}>{money(p.profit)}</b></td></tr>)}
      {(!profit?.rows || profit.rows.length === 0) && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Sem lançamentos de controle diário no período.</td></tr>}
    </tbody>{profit?.rows?.length > 0 && <tfoot><tr><td><b>Totais</b></td><td><b>{profit.totals.quantity}</b></td><td><b>{money(profit.totals.revenue)}</b></td><td><b>{money(profit.totals.cost)}</b></td><td><b>{money(profit.totals.profit)}</b></td></tr></tfoot>}</table></div></section>
    <section className="panel table-panel" data-testid="profit-by-brand-panel"><div className="panel-head"><div><h3>Lucro por marca</h3><p className="muted">Valor de venda − custo de compra, por marca/produto, no período.</p></div></div><div className="table-wrap"><table><thead><tr><th>MARCA / PRODUTO</th><th>QTD</th><th>RECEITA</th><th>CUSTO</th><th>LUCRO</th></tr></thead><tbody>
      {(profitByBrand?.rows || []).map(p => <tr key={p.brand} data-testid={`profit-brand-row-${p.brand}`}><td><b>{p.brand}</b></td><td>{p.quantity}</td><td>{money(p.revenue)}</td><td>{money(p.cost)}</td><td><b className={p.profit >= 0 ? 'green-text' : 'orange-text'}>{money(p.profit)}</b></td></tr>)}
      {(!profitByBrand?.rows || profitByBrand.rows.length === 0) && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Sem lançamentos de controle diário no período.</td></tr>}
    </tbody>{profitByBrand?.rows?.length > 0 && <tfoot><tr><td><b>Totais</b></td><td><b>{profitByBrand.totals.quantity}</b></td><td><b>{money(profitByBrand.totals.revenue)}</b></td><td><b>{money(profitByBrand.totals.cost)}</b></td><td><b>{money(profitByBrand.totals.profit)}</b></td></tr></tfoot>}</table></div></section></>
}

/* ===================== App mobile do entregador ===================== */

function brandListOf(c) { return c?.brands?.length ? c.brands : (c?.brand ? [{ brand: c.brand, price: c.price }] : []); }

function MobileHeader({ user, title, subtitle, theme, onToggleTheme }) {
  return <header className="mob-header">
    <span className="mob-avatar">{user.name.split(' ').map(x => x[0]).join('').slice(0, 2)}</span>
    <div className="mob-header-text"><b>{title}</b><span>{subtitle}</span></div>
    <button type="button" className="mob-theme-btn" data-testid="mob-theme-toggle" aria-label="Alternar tema" onClick={onToggleTheme}>{theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}</button>
  </header>
}

function MobileBottomNav({ tab, setTab }) {
  const items = [['clientes', 'Clientes', Users], ['diario', 'Diário', CalendarCheck], ['caixa', 'Caixa', CircleDollarSign], ['despesas', 'Despesas', WalletCards], ['ajustes', 'Mais', MoreHorizontal]];
  return <nav className="mob-bottom-nav">{items.map(([key, label, Icon]) => <button type="button" key={key} className={tab === key ? 'active' : ''} data-testid={`mob-tab-${key}`} onClick={() => setTab(key)}><Icon size={20} /><span>{label}</span></button>)}</nav>
}

function MobileToast({ text, tone = 'green' }) { if (!text) return null; return <div className={`mob-toast ${tone}`} data-testid="mob-toast">{text}</div> }

function MobileStopRow({ c, done, onClick }) {
  const brands = brandListOf(c);
  const priceLine = brands.map(b => `${b.brand} ${money(b.price)}`).join(' · ');
  return <button type="button" className={`mob-customer-row${done ? ' done' : ''}`} data-testid={`mob-customer-row-${c.id}`} onClick={onClick}>
    <span className="mob-customer-avatar done-aware">{done ? '✓' : (c.name?.[0] || '?')}</span>
    <span className="mob-customer-info">
      <b>{c.name}</b>
      <small>{c.address}</small>
      {priceLine && <small>{priceLine}</small>}
    </span>
    <span className={`mob-tag${done ? ' done' : ' neutral'}`}>{done ? 'Lançado' : 'Lançar'}</span>
  </button>
}

function MobilePickerRow({ c, onClick }) {
  const brands = brandListOf(c);
  const line = brands.length ? `${brands.length} ${brands.length === 1 ? 'marca' : 'marcas'} · ${brands.map(b => b.brand).join(', ')}` : 'sem marca cadastrada';
  return <button type="button" className="mob-customer-row" data-testid={`mob-picker-row-${c.id || 'new'}`} onClick={onClick}>
    <span className="mob-customer-avatar">{c.name?.[0] || '?'}</span>
    <span className="mob-customer-info"><b>{c.name}{c.code && <span className="mob-tag neutral" style={{ marginLeft: 6 }}>#{c.code}</span>}</b><small>{line}</small></span>
    <ChevronRight size={20} color="var(--mob-blue)" />
  </button>
}

function MobileClientesTab({ customers, entries, orders, onStartOrder, date, onOpenPicker, onOpenCustomer, search, setSearch }) {
  const todaysEntries = entries.filter(e => e.date === date);
  const doneNames = new Set(todaysEntries.map(e => e.customer));
  const receivedToday = todaysEntries.reduce((s, e) => s + Number(e.pix_value || 0) + Number(e.cash_value || 0), 0);
  const filtered = customers.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || (c.code || '').toLowerCase().includes(search.toLowerCase()));
  const goal = customers.length || 1;
  const progress = Math.min(100, (doneNames.size / goal) * 100);
  return <div className="mob-screen">
    {orders?.length > 0 && <div className="mob-orders-card" data-testid="mob-pending-orders">
      <p className="mob-eyebrow">ORDENS DE SERVIÇO · {orders.length} PENDENTE{orders.length > 1 ? 'S' : ''}</p>
      {orders.map(o => <div className="mob-order-row" key={o.id} data-testid={`mob-order-${o.id}`}>
        <div><b>{o.customer}</b><small>{o.brand || 'Produto a combinar'}{o.quantity ? ` · ${o.quantity} un` : ''}</small>{o.address && <small>{o.address}</small>}{o.notes && <small>{o.notes}</small>}</div>
        <button type="button" className="mob-outline-btn" data-testid={`mob-order-launch-${o.id}`} onClick={() => onStartOrder(o)}>Lançar entrega</button>
      </div>)}
    </div>}
    <div className="mob-summary-card">
      <div className="mob-summary-row"><span>{doneNames.size} cliente{doneNames.size !== 1 ? 's' : ''} lançado{doneNames.size !== 1 ? 's' : ''} hoje</span><b data-testid="mob-received-today">{money(receivedToday)}</b></div>
      <div className="mob-progress"><div style={{ width: `${progress}%` }} /></div>
    </div>
    <button type="button" className="mob-cta" data-testid="mob-new-delivery-button" onClick={onOpenPicker}><Plus size={20} /> Nova entrega</button>
    <div className="mob-search"><Search size={16} /><input placeholder="Buscar por nome ou código" value={search} data-testid="mob-search-input" onChange={e => setSearch(e.target.value)} /></div>
    <div className="mob-customer-list">
      {filtered.map(c => <MobileStopRow key={c.id} c={c} done={doneNames.has(c.name)} onClick={() => onOpenCustomer(c)} />)}
      {filtered.length === 0 && <p className="muted" style={{ padding: 16 }}>Nenhum cliente encontrado.</p>}
    </div>
  </div>
}

function MobilePickerSheet({ customers, onClose, onPick, onNewCustomer }) {
  const [q, setQ] = useState('');
  const filtered = customers.filter(c => c.name.toLowerCase().includes(q.toLowerCase()) || (c.code || '').toLowerCase().includes(q.toLowerCase()));
  return <div className="mob-backdrop" onClick={onClose}>
    <div className="mob-sheet" onClick={e => e.stopPropagation()}>
      <div className="mob-sheet-handle" />
      <div className="mob-sheet-head">
        <div><h3>Nova entrega</h3><p>Escolha o cliente — marca e preço vêm do cadastro</p></div>
        <button type="button" className="mob-close" data-testid="mob-picker-close" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="mob-search"><Search size={16} /><input autoFocus placeholder="Digite o nome ou o código do cliente" value={q} data-testid="mob-picker-search" onChange={e => setQ(e.target.value)} /></div>
      <div className="mob-sheet-list">
        {filtered.map(c => <MobilePickerRow key={c.id} c={c} onClick={() => onPick(c)} />)}
        {filtered.length === 0 && <p className="muted" style={{ padding: 16 }}>Nenhum cliente encontrado.</p>}
      </div>
      <button type="button" className="mob-outline-btn wide" data-testid="mob-new-customer-button" onClick={onNewCustomer}><Plus size={16} /> Cliente novo (sem cadastro)</button>
    </div>
  </div>
}

function MobileLaunchPanel({ customer, user, date, onClose, onComplete, prefillOrder }) {
  const draftKey = `hydro_draft_${customer.id || 'novo_' + (customer.name || 'cliente')}`;
  const draft = useMemo(() => { try { return JSON.parse(localStorage.getItem(draftKey)); } catch { return null; } }, [draftKey]);

  const [customerName, setCustomerName] = useState(draft?.customerName ?? (customer.name || ''));
  const [lines, setLines] = useState(() => {
    if (draft?.lines) return draft.lines;
    const base = brandListOf(customer).map(b => ({ brand: b.brand, priceExchange: Number(b.price) || 0, priceFull: b.price_full != null ? Number(b.price_full) || 0 : null, qtyExchange: 0, qtyFull: 0, mf: 0 }));
    if (prefillOrder?.brand) {
      const idx = base.findIndex(l => l.brand.toLowerCase() === prefillOrder.brand.toLowerCase());
      if (idx >= 0) base[idx] = { ...base[idx], qtyExchange: Number(prefillOrder.quantity) || base[idx].qtyExchange };
      else base.push({ brand: prefillOrder.brand, priceExchange: 0, priceFull: null, saleType: 'exchange', qty: Number(prefillOrder.quantity) || 0, mf: 0, extra: true });
    }
    return base;
  });
  const [adding, setAdding] = useState(false);
  const [newBrand, setNewBrand] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newFull, setNewFull] = useState(false);
  const [pix, setPix] = useState(draft?.pix ?? 0);
  const [cash, setCash] = useState(draft?.cash ?? 0);
  const [compOn, setCompOn] = useState(draft?.compOn ?? (customer.payment_type === 'prazo'));
  const [comp, setComp] = useState(draft?.comp ?? '');
  const [compDays, setCompDays] = useState(draft?.compDays ?? 15);
  const [mfPlan, setMfPlan] = useState(draft?.mfPlan ?? null);
  const [mfDate, setMfDate] = useState(draft?.mfDate ?? 'Amanhã');
  const [signerName, setSignerName] = useState(draft?.signerName ?? '');
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify({ customerName, lines, pix, cash, compOn, comp, compDays, mfPlan, mfDate, signerName })); } catch { /* ignore quota errors */ }
  }, [draftKey, customerName, lines, pix, cash, compOn, comp, compDays, mfPlan, mfDate, signerName]);
  function clearDraft() { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }

  const fullPriceOf = l => l.priceFull != null ? l.priceFull : (Number(l.priceFullManual) || 0);
  const linePrice = l => l.saleType === 'full' ? (l.priceFull != null ? l.priceFull : (Number(l.priceFullManual) || l.priceExchange)) : l.priceExchange;
  const lineTotal = l => l.extra ? l.qty * linePrice(l) : (l.qtyExchange * l.priceExchange) + (l.qtyFull * fullPriceOf(l));
  const total = lines.reduce((s, l) => s + lineTotal(l), 0);
  const compValue = compOn ? (Number(comp) || 0) : 0;
  const remaining = Math.max(0, Math.round((total - compValue) * 100) / 100);
  const totalMf = lines.reduce((s, l) => s + l.mf, 0);

  useEffect(() => {
    setPix(prev => { const p = Math.min(prev, remaining); setCash(Math.round((remaining - p) * 100) / 100); return p; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  function incQty(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty: l.qty + 1 } : l)); }
  function decQty(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty: Math.max(0, l.qty - 1) } : l)); }
  function setQty(i, raw) { const v = Math.max(0, parseInt(raw, 10) || 0); setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qty: v } : l)); }
  function incQtyExchange(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyExchange: l.qtyExchange + 1 } : l)); }
  function decQtyExchange(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyExchange: Math.max(0, l.qtyExchange - 1) } : l)); }
  function setQtyExchange(i, raw) { const v = Math.max(0, parseInt(raw, 10) || 0); setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyExchange: v } : l)); }
  function incQtyFull(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyFull: l.qtyFull + 1 } : l)); }
  function decQtyFull(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyFull: Math.max(0, l.qtyFull - 1) } : l)); }
  function setQtyFull(i, raw) { const v = Math.max(0, parseInt(raw, 10) || 0); setLines(prev => prev.map((l, idx) => idx === i ? { ...l, qtyFull: v } : l)); }
  function incMf(i) { setLines(prev => prev.map((l, idx) => { if (idx !== i) return l; if (l.extra) return l.qty > 0 ? { ...l, qty: l.qty - 1, mf: l.mf + 1 } : l; return l.qtyExchange > 0 ? { ...l, qtyExchange: l.qtyExchange - 1, mf: l.mf + 1 } : l; })); }
  function decMf(i) { setLines(prev => prev.map((l, idx) => { if (idx !== i) return l; if (l.mf === 0) return l; return l.extra ? { ...l, qty: l.qty + 1, mf: l.mf - 1 } : { ...l, qtyExchange: l.qtyExchange + 1, mf: l.mf - 1 }; })); }
  function setFullPriceManual(i, value) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, priceFullManual: value } : l)); }

  function addBrandLine() {
    if (!newBrand.trim()) return;
    const price = Number(newPrice) || 0;
    setLines(prev => [...prev, { brand: newBrand.trim(), priceExchange: newFull ? 0 : price, priceFull: newFull ? price : null, saleType: newFull ? 'full' : 'exchange', qty: Math.max(0, parseInt(newQty, 10) || 0), mf: 0, extra: true }]);
    setNewBrand(''); setNewPrice(''); setNewQty(''); setNewFull(false); setAdding(false);
  }

  function setPixVal(raw) { const v = Math.min(Math.max(0, Number(raw) || 0), remaining); setPix(v); setCash(Math.round((remaining - v) * 100) / 100); }
  function setCashVal(raw) { const v = Math.min(Math.max(0, Number(raw) || 0), remaining); setCash(v); setPix(Math.round((remaining - v) * 100) / 100); }
  function allPix() { setPix(remaining); setCash(0); }
  function allCash() { setCash(remaining); setPix(0); }

  async function complete(signature, signatureName) {
    setSaving(true); setError('');
    const items = [];
    for (const l of lines) {
      if (l.extra) {
        if (l.qty > 0 || l.mf > 0) items.push({ brand: l.brand, price: linePrice(l), sale_type: l.saleType, quantity: l.qty, mf_quantity: l.mf, out_of_catalog: true });
        continue;
      }
      if (l.qtyExchange > 0 || l.mf > 0) items.push({ brand: l.brand, price: l.priceExchange, sale_type: 'exchange', quantity: l.qtyExchange, mf_quantity: l.mf });
      if (l.qtyFull > 0) items.push({ brand: l.brand, price: fullPriceOf(l), sale_type: 'full', quantity: l.qtyFull });
    }
    const payload = {
      customer: customerName, driver: user.name, date, items,
      pix_value: Math.round(pix * 100) / 100, cash_value: Math.round(cash * 100) / 100,
      comp_value: compValue, comp_days: compOn ? compDays : undefined,
      mf_plan: totalMf > 0 ? mfPlan : undefined, mf_date: totalMf > 0 && mfPlan === 'reschedule' ? mfDate : undefined,
      signature, signature_name: signatureName || undefined,
    };
    try {
      const { data } = await api.post('/daily-entries', payload, auth());
      clearDraft();
      onComplete(data);
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível concluir.'); setSaving(false); setSigning(false); }
  }

  if (signing) return <SignaturePad variant="mobile" customer={customerName} total={total} signerName={signerName} onSignerNameChange={setSignerName} onSave={complete} onCancel={() => setSigning(false)} />;

  const canSubmit = lines.some(l => l.extra ? (l.qty > 0 || l.mf > 0) : (l.qtyExchange > 0 || l.qtyFull > 0 || l.mf > 0)) && (totalMf === 0 || !!mfPlan) && Math.abs((pix + cash + compValue) - total) < 0.01;

  return <div className="mob-backdrop" onClick={onClose}>
    <div className="mob-sheet mob-sheet-tall" onClick={e => e.stopPropagation()}>
      <div className="mob-sheet-handle" />
      <div className="mob-sheet-head">
        <div>
          {customer.id ? <h3>{customer.name}</h3> : <input className="mob-inline-name" placeholder="Nome do cliente" value={customerName} data-testid="mob-new-customer-name" onChange={e => setCustomerName(e.target.value)} />}
          <p>{customer.address || 'Marcas e preços vêm do cadastro do cliente'}</p>
        </div>
        <button type="button" className="mob-close" data-testid="mob-panel-close" onClick={onClose}><X size={18} /></button>
      </div>

      {prefillOrder && <div className="mob-order-banner" data-testid="mob-order-banner">Vindo da ordem de serviço{prefillOrder.notes ? ` · ${prefillOrder.notes}` : ''}{lines.some(l => l.extra && l.brand.toLowerCase() === (prefillOrder.brand || '').toLowerCase()) ? ' · confira o preço, esse produto não está no cadastro do cliente' : ''}</div>}
      <p className="mob-eyebrow">PRODUTOS DO CADASTRO · TOQUE + OU DIGITE A QUANTIDADE</p>
      <div className="mob-lines">
        {lines.map((l, i) => l.extra ? <div className={`mob-line${l.qty > 0 ? ' active' : ''}`} key={i} data-testid={`mob-line-${i}`}>
          <div className="mob-line-top">
            <div className="mob-line-info"><b>{l.brand}<span className="mob-tag orange" style={{ marginLeft: 6 }}>nova</span>{l.saleType === 'full' && <span className="mob-tag" style={{ marginLeft: 6 }}>venda completa</span>}</b><small>R$ {linePrice(l).toFixed(2)} por galão</small><span className="mob-line-subtotal">{money(l.qty * linePrice(l))}</span></div>
            <div className="mob-counter">
              <button type="button" data-testid={`mob-qty-minus-${i}`} onClick={() => decQty(i)}><Minus size={18} /></button>
              <input type="number" inputMode="numeric" min="0" value={l.qty} data-testid={`mob-qty-input-${i}`} onChange={e => setQty(i, e.target.value)} onFocus={e => e.target.select()} />
              <button type="button" className="fill" data-testid={`mob-qty-plus-${i}`} onClick={() => incQty(i)}><Plus size={20} /></button>
            </div>
          </div>
          <div className="mob-line-mf">
            <span>MF · microfuro</span>
            <div className="mob-counter small">
              <button type="button" data-testid={`mob-mf-minus-${i}`} onClick={() => decMf(i)}><Minus size={14} /></button>
              <span>{l.mf}</span>
              <button type="button" className="mf" data-testid={`mob-mf-plus-${i}`} onClick={() => incMf(i)}><Plus size={16} /></button>
            </div>
          </div>
        </div> : <div className={`mob-line${(l.qtyExchange > 0 || l.qtyFull > 0) ? ' active' : ''}`} key={i} data-testid={`mob-line-${i}`}>
          <div className="mob-line-top">
            <div className="mob-line-info"><b>{l.brand}</b><small>Somente água R$ {l.priceExchange.toFixed(2)} · Completo R$ {fullPriceOf(l).toFixed(2)}</small><span className="mob-line-subtotal">{money(lineTotal(l))}</span></div>
          </div>
          <div className="mob-line-split">
            <div className="mob-line-split-col">
              <span className="mob-line-split-label">Somente água</span>
              <div className="mob-counter">
                <button type="button" data-testid={`mob-qty-exchange-minus-${i}`} onClick={() => decQtyExchange(i)}><Minus size={18} /></button>
                <input type="number" inputMode="numeric" min="0" value={l.qtyExchange} data-testid={`mob-qty-exchange-input-${i}`} onChange={e => setQtyExchange(i, e.target.value)} onFocus={e => e.target.select()} />
                <button type="button" className="fill" data-testid={`mob-qty-exchange-plus-${i}`} onClick={() => incQtyExchange(i)}><Plus size={20} /></button>
              </div>
            </div>
            <div className="mob-line-split-col">
              <span className="mob-line-split-label">Completo (vasilhame + água)</span>
              <div className="mob-counter">
                <button type="button" data-testid={`mob-qty-full-minus-${i}`} onClick={() => decQtyFull(i)}><Minus size={18} /></button>
                <input type="number" inputMode="numeric" min="0" value={l.qtyFull} data-testid={`mob-qty-full-input-${i}`} onChange={e => setQtyFull(i, e.target.value)} onFocus={e => e.target.select()} />
                <button type="button" className="fill" data-testid={`mob-qty-full-plus-${i}`} onClick={() => incQtyFull(i)}><Plus size={20} /></button>
              </div>
            </div>
          </div>
          {l.qtyFull > 0 && l.priceFull == null && <label className="mob-line-full-price">Preço da venda completa (não cadastrado)<input type="number" inputMode="decimal" step="0.01" autoFocus placeholder={l.priceExchange.toFixed(2)} value={l.priceFullManual || ''} data-testid={`mob-sale-full-price-${i}`} onChange={e => setFullPriceManual(i, e.target.value)} onFocus={e => e.target.select()} /></label>}
          <div className="mob-line-mf">
            <span>MF · microfuro</span>
            <div className="mob-counter small">
              <button type="button" data-testid={`mob-mf-minus-${i}`} onClick={() => decMf(i)}><Minus size={14} /></button>
              <span>{l.mf}</span>
              <button type="button" className="mf" data-testid={`mob-mf-plus-${i}`} onClick={() => incMf(i)}><Plus size={16} /></button>
            </div>
          </div>
        </div>)}
        {lines.length === 0 && <p className="muted">Nenhuma marca cadastrada para este cliente ainda — adicione uma abaixo.</p>}
      </div>

      {!adding ? <button type="button" className="mob-dashed-btn" data-testid="mob-add-brand-button" onClick={() => setAdding(true)}><Plus size={16} /> Outra marca (fora do cadastro)</button> : <div className="mob-add-brand">
        <input placeholder="Nome da marca" value={newBrand} data-testid="mob-new-brand-input" onChange={e => setNewBrand(e.target.value)} />
        <label>Quantidade<input type="number" inputMode="numeric" min="0" value={newQty} data-testid="mob-new-brand-qty" onChange={e => setNewQty(e.target.value)} /></label>
        <label>{newFull ? 'Preço combinado (venda completa)' : 'Preço combinado (R$ por galão)'}<input type="number" inputMode="decimal" step="0.01" value={newPrice} data-testid="mob-new-brand-price" onChange={e => setNewPrice(e.target.value)} onFocus={e => e.target.select()} /></label>
        <div className="mob-sale-type">
          <button type="button" className={!newFull ? 'active' : ''} data-testid="mob-new-brand-exchange" onClick={() => setNewFull(false)}>Somente água</button>
          <button type="button" className={newFull ? 'active' : ''} data-testid="mob-new-brand-full" onClick={() => setNewFull(true)}>Venda completa (vasilhame + água)</button>
        </div>
        <div className="mob-row-actions">
          <button type="button" className="mob-ghost-btn" onClick={() => { setAdding(false); setNewBrand(''); setNewPrice(''); setNewQty(''); setNewFull(false); }}>Cancelar</button>
          <button type="button" className="primary" data-testid="mob-confirm-add-brand" onClick={addBrandLine}>Adicionar marca</button>
        </div>
      </div>}

      <div className="mob-total-row"><span>TOTAL A RECEBER</span><b>{money(total)}</b></div>

      <div className="mob-split-shortcuts">
        <button type="button" data-testid="mob-all-pix" onClick={allPix}>Tudo Pix</button>
        <button type="button" data-testid="mob-all-cash" onClick={allCash}>Tudo dinheiro</button>
      </div>

      <div className="mob-pix-cash">
        <label className="mob-pix"><span>Pix</span><input type="number" step="0.01" value={pix || ''} data-testid="mob-pix-input" onChange={e => setPixVal(e.target.value)} /></label>
        <label className="mob-cash"><span>Dinheiro</span><input type="number" step="0.01" value={cash || ''} data-testid="mob-cash-input" onChange={e => setCashVal(e.target.value)} /></label>
      </div>
      <p className="mob-help">Digite o que ele tem no Pix ou em dinheiro — o outro campo completa o resto sozinho{compOn ? ` · a prazo: ${money(compValue)}` : ''}</p>

      <div className="mob-comp-row">
        <div><b>A prazo (COMP)</b><small>Cliente paga em 15 ou 30 dias</small></div>
        <button type="button" className={`mob-switch${compOn ? ' on' : ''}`} data-testid="mob-comp-switch" onClick={() => setCompOn(!compOn)}><span /></button>
      </div>
      {compOn && <div className="mob-comp-fields">
        <label>Valor a prazo<input type="number" step="0.01" value={comp} data-testid="mob-comp-value" onChange={e => setComp(e.target.value)} /></label>
        <div className="mob-days-toggle">
          <button type="button" className={compDays === 15 ? 'active' : ''} data-testid="mob-comp-15" onClick={() => setCompDays(15)}>15 dias</button>
          <button type="button" className={compDays === 30 ? 'active' : ''} data-testid="mob-comp-30" onClick={() => setCompDays(30)}>30 dias</button>
        </div>
      </div>}

      {totalMf > 0 && <div className="mob-mf-decision" data-testid="mob-mf-decision">
        <b>{totalMf} galão{totalMf > 1 ? 'ões' : ''} com microfuro</b>
        <p>O que o cliente decidiu sobre esses galões?</p>
        <div className="mob-mf-options">
          <button type="button" className={mfPlan === 'reschedule' ? 'active' : ''} data-testid="mob-mf-reschedule" onClick={() => setMfPlan('reschedule')}><Truck size={22} /> Entregar outro dia</button>
          <button type="button" className={mfPlan === 'swap' ? 'active' : ''} data-testid="mob-mf-swap" onClick={() => setMfPlan('swap')}><Check size={22} /> Trocar agora no caminhão</button>
          <button type="button" className={mfPlan === 'refused' ? 'active' : ''} data-testid="mob-mf-refused" onClick={() => setMfPlan('refused')}><XCircle size={22} /> Cliente não quis</button>
        </div>
        {mfPlan === 'reschedule' && <div className="mob-days-toggle">
          {['Amanhã', 'Em 2 dias', 'Próxima rota'].map(d => <button type="button" key={d} className={mfDate === d ? 'active' : ''} data-testid={`mob-mf-date-${d}`} onClick={() => setMfDate(d)}>{d}</button>)}
        </div>}
      </div>}

      {error && <div className="error" data-testid="mob-panel-error">{error}</div>}
      <button type="button" className="mob-cta" disabled={!canSubmit || saving} data-testid="mob-sign-button" onClick={() => setSigning(true)}>Assinar e concluir</button>
      <button type="button" className="mob-danger-btn" data-testid="mob-fail-button" onClick={onClose}>Não consegui entregar</button>
    </div>
  </div>
}

function MobileDiarioTab({ entries, date }) {
  const todays = entries.filter(e => e.date === date);
  const totals = todays.reduce((s, e) => ({ qty: s.qty + Number(e.billed_quantity || 0), pix: s.pix + Number(e.pix_value || 0), cash: s.cash + Number(e.cash_value || 0) }), { qty: 0, pix: 0, cash: 0 });
  const mfDetail = e => e.mf_plan === 'swap' ? 'trocado' : e.mf_plan === 'refused' ? 'cliente não quis' : (e.mf_date || '');
  return <div className="mob-screen">
    <div className="mob-total-cards">
      <div className="mob-total-card"><span>GALÕES</span><b>{totals.qty}</b></div>
      <div className="mob-total-card"><span>PIX</span><b className="blue">{money(totals.pix)}</b></div>
      <div className="mob-total-card"><span>DINHEIRO</span><b className="green">{money(totals.cash)}</b></div>
    </div>
    <p className="mob-eyebrow" style={{ margin: '4px 0 0' }}>LANÇAMENTOS DE HOJE</p>
    <div className="mob-entry-list">
      {todays.length === 0 && <div className="mob-empty-dashed">Nada lançado ainda. Conclua uma parada na aba Clientes.</div>}
      {todays.map(e => {
        const lineItems = e.items?.length ? e.items : (e.brand ? [{ brand: e.brand, quantity: e.billed_quantity ?? e.quantity }] : []);
        const itemsLabel = lineItems.map(it => `${it.quantity} ${it.brand}`).join(' + ') || `${e.billed_quantity ?? e.quantity} galões`;
        return <div className="mob-entry-card" key={e.id} data-testid={`mob-entry-${e.id}`}>
          <div className="mob-entry-top"><b>{e.customer}{e.entry_number ? <small style={{ fontWeight: 400, marginLeft: 6 }}>Nº {e.entry_number}</small> : null}</b><b>{money(e.total)}</b></div>
          <div className="mob-chips">
            <span className="mob-chip neutral">{itemsLabel}</span>
            <span className="mob-chip blue">Pix {money(e.pix_value)}</span>
            <span className="mob-chip green">Dinheiro {money(e.cash_value)}</span>
            {e.mf_quantity > 0 && <span className="mob-chip orange">{e.mf_quantity} MF · {mfDetail(e)}</span>}
            {e.comp_value > 0 && <span className="mob-chip orange">{money(e.comp_value)} · {e.comp_days}d</span>}
          </div>
        </div>
      })}
    </div>
  </div>
}

function MobileCaixaTab({ entries, expensesTotal, date, onAddExpense, onCloseDay }) {
  const todays = entries.filter(e => e.date === date);
  const pix = todays.reduce((s, e) => s + Number(e.pix_value || 0), 0);
  const cash = todays.reduce((s, e) => s + Number(e.cash_value || 0), 0);
  const comp = todays.reduce((s, e) => s + Number(e.comp_value || 0), 0);
  const netTotal = pix + cash - Number(expensesTotal || 0);
  return <div className="mob-screen">
    <div className="mob-cash-hero">
      <span>SALDO LÍQUIDO DO DIA</span>
      <b data-testid="mob-cash-to-deliver">{money(netTotal)}</b>
      <small>Pix + dinheiro recebidos, já descontadas as despesas do dia</small>
    </div>
    <div className="mob-cash-rows">
      <div className="mob-cash-row"><span className="mob-cash-icon blue"><CircleDollarSign size={16} /></span><div><b>Recebido em Pix</b><small>já na conta da empresa</small></div><b className="blue">{money(pix)}</b></div>
      <div className="mob-cash-row"><span className="mob-cash-icon green"><Wallet size={16} /></span><div><b>Recebido em dinheiro</b><small>entregar na base</small></div><b className="green">{money(cash)}</b></div>
      <div className="mob-cash-row"><span className="mob-cash-icon orange"><Clock3 size={16} /></span><div><b>Vendas a prazo</b><small>COMP lançado hoje</small></div><b className="orange">{money(comp)}</b></div>
      <div className="mob-cash-row"><span className="mob-cash-icon orange"><WalletCards size={16} /></span><div><b>Despesas do dia</b><small>descontado do saldo líquido</small></div><b className="orange">-{money(expensesTotal)}</b></div>
    </div>
    <button type="button" className="mob-outline-btn" data-testid="mob-add-expense-shortcut" onClick={onAddExpense}><Plus size={16} /> Lançar despesa</button>
    <button type="button" className="mob-cta" data-testid="mob-close-day-button" onClick={onCloseDay}>Fechar o dia</button>
  </div>
}

const MOBILE_EXPENSE_CATEGORIES = [['Combustível', Fuel], ['Alimentação', Utensils], ['Pedágio', Receipt], ['Manutenção', Wrench], ['Outros', MoreHorizontal]];

function MobileDespesasTab({ user, date }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('Combustível');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  async function load() { const { data } = await api.get('/expenses', auth()); setItems(data.filter(x => (x.driver || '') === user.name && (x.created_at || '').slice(0, 10) === date)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);

  async function submit() {
    setError('');
    if (!amount || Number(amount) <= 0) return setError('Informe um valor válido.');
    try {
      const { data } = await api.post('/expenses', { type: category, driver: user.name, amount: Number(amount), notes: note, status: 'approved' }, auth());
      setItems([data, ...items]); setAmount(''); setNote('');
      setToast('Despesa lançada'); setTimeout(() => setToast(''), 2200);
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível lançar.'); }
  }

  const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
  return <div className="mob-screen">
    <div className="mob-expense-grid">
      {MOBILE_EXPENSE_CATEGORIES.map(([label, Icon]) => <button type="button" key={label} className={category === label ? 'active' : ''} data-testid={`mob-expense-cat-${label}`} onClick={() => setCategory(label)}><Icon size={22} /><span>{label}</span></button>)}
    </div>
    <label className="mob-field-lg">VALOR (R$)<input type="number" step="0.01" placeholder="0,00" value={amount} data-testid="mob-expense-amount" onChange={e => setAmount(e.target.value)} /></label>
    <label className="mob-field-md">OBSERVAÇÃO (OPCIONAL)<input placeholder="ex: posto na saída da cidade" value={note} data-testid="mob-expense-note" onChange={e => setNote(e.target.value)} /></label>
    <button type="button" className="mob-photo-btn" data-testid="mob-expense-photo"><Camera size={20} /> Foto do comprovante</button>
    {error && <div className="error" data-testid="mob-expense-error">{error}</div>}
    <button type="button" className="mob-cta" data-testid="mob-expense-submit" onClick={submit}>Lançar despesa</button>
    <p className="mob-eyebrow" style={{ marginTop: 22 }}>MINHAS DESPESAS DE HOJE · {money(total)}</p>
    <div className="mob-expense-list">
      {items.length === 0 && <div className="mob-empty-dashed">Nenhuma despesa lançada.</div>}
      {items.map(x => { const CatIcon = (MOBILE_EXPENSE_CATEGORIES.find(c => c[0] === x.type) || [])[1] || MoreHorizontal; return <div className="mob-expense-row" key={x.id} data-testid={`mob-expense-row-${x.id}`}>
        <span className="mob-expense-icon"><CatIcon size={17} /></span>
        <div><b>{x.type}</b><small>{new Date(x.created_at || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</small></div>
        <b>{money(x.amount)}</b>
      </div> })}
    </div>
    <MobileToast text={toast} />
  </div>
}

function MobileAjustesTab({ user, theme, setTheme, textScale, setTextScale, onLogout }) {
  return <div className="mob-screen">
    <div className="mob-settings-card">
      <p className="mob-eyebrow">APARÊNCIA</p>
      <div className="mob-appearance-row">
        <button type="button" className={theme === 'light' ? 'active' : ''} data-testid="mob-theme-light" onClick={() => setTheme('light')}><Sun size={18} /> Claro</button>
        <button type="button" className={theme === 'dark' ? 'active' : ''} data-testid="mob-theme-dark" onClick={() => setTheme('dark')}><Moon size={18} /> Escuro</button>
      </div>
      <p className="mob-eyebrow" style={{ marginTop: 6 }}>TAMANHO DO TEXTO</p>
      <div className="mob-appearance-row">
        {[[1, 15], [1.1, 17], [1.2, 19]].map(([v, fs]) => <button type="button" key={v} className={textScale === v ? 'active' : ''} style={{ fontSize: fs, fontWeight: 700 }} data-testid={`mob-scale-${v}`} onClick={() => setTextScale(v)}>A</button>)}
      </div>
    </div>
    <div className="mob-settings-card">
      <p className="mob-eyebrow">CONTA</p>
      <div className="mob-account-row"><span className="mob-avatar">{user.name.split(' ').map(x => x[0]).join('').slice(0, 2)}</span><div><b>{user.name}</b><small>Entregador</small></div></div>
      <button type="button" className="mob-danger-btn full" data-testid="mob-logout-button" onClick={onLogout}>Sair da conta</button>
    </div>
  </div>
}

function MobileReceiptPrompt({ entry, customer, onSavePhone, onClose }) {
  const [stage, setStage] = useState('ask');
  const [phone, setPhone] = useState(customer?.phone || '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function resolvePhone() {
    if (customer?.phone) return customer.phone;
    if (phone.trim()) { setBusy(true); try { await onSavePhone(phone.trim()); } finally { setBusy(false); } return phone.trim(); }
    return null;
  }

  async function handleShare() {
    setBusy(true);
    try {
      const shared = await shareReceiptViaSystem(entry);
      if (!shared) {
        const finalPhone = await resolvePhone();
        downloadReceiptPdf(entry);
        const link = whatsappTextLink(finalPhone, receiptWhatsappMessage(entry));
        if (link) window.open(link, '_blank');
      }
      setSent(true);
    } finally { setBusy(false); }
  }

  return <div className="mob-backdrop" onClick={onClose}>
    <div className="mob-sheet" onClick={e => e.stopPropagation()}>
      <div className="mob-sheet-handle" />
      {stage === 'ask' ? <>
        <div className="mob-sheet-head">
          <div><h3>Entrega registrada!</h3><p>{entry.customer} · {money(entry.total)}</p></div>
          <button type="button" className="mob-close" data-testid="mob-receipt-close" onClick={onClose}><X size={18} /></button>
        </div>
        <p className="muted" style={{ padding: '0 2px 16px' }}>O cliente quer o comprovante de entrega?</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" className="mob-outline-btn" data-testid="mob-receipt-skip" onClick={onClose}>Não precisa</button>
          <button type="button" className="mob-cta" style={{ flex: 1 }} data-testid="mob-receipt-yes" onClick={() => setStage('actions')}>Sim, emitir</button>
        </div>
      </> : <>
        <div className="mob-sheet-head">
          <div><h3>Comprovante</h3><p>{entry.entry_number ? `Nº ${entry.entry_number} · ` : ''}{money(entry.total)}</p></div>
          <button type="button" className="mob-close" data-testid="mob-receipt-close-2" onClick={onClose}><X size={18} /></button>
        </div>
        {!customer?.phone && !sent && <label className="mob-field-md">Telefone do cliente (WhatsApp)<input value={phone} placeholder="ex: 5592999999999" data-testid="mob-receipt-phone" onChange={e => setPhone(e.target.value)} /></label>}
        <button type="button" className="mob-outline-btn wide" data-testid="mob-receipt-download" onClick={() => downloadReceiptPdf(entry)}>Baixar comprovante (PDF)</button>
        <button type="button" className="mob-cta" disabled={busy} data-testid="mob-receipt-send" onClick={handleShare}>{sent ? 'Enviado' : 'Enviar no WhatsApp'}</button>
      </>}
    </div>
  </div>
}

function DriverMobileApp({ user, customers, onLogout }) {
  const [theme, setTheme] = useDraft('hydro_theme', 'light');
  const [textScale, setTextScale] = useDraft('hydro_text_scale', 1);
  const [tab, setTab] = useState('clientes');
  const [picker, setPicker] = useState(false);
  const [sheetCustomer, setSheetCustomer] = useState(null);
  const [sheetOrder, setSheetOrder] = useState(null);
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState([]);
  const [expensesTotal, setExpensesTotal] = useState(0);
  const [orders, setOrders] = useState([]);
  const [postDelivery, setPostDelivery] = useState(null);
  const [toast, setToast] = useState('');
  const date = todayISO(0);
  async function savePhoneForCustomerName(name, phone) {
    const c = customers.find(x => x.name === name);
    if (c) await api.patch(`/customers/${c.id}`, { phone }, auth());
  }

  async function loadEntries() { const { data } = await api.get('/daily-entries', { ...auth(), params: { driver: user.name } }); setEntries(data); }
  async function loadOrders() { const { data } = await api.get('/service-orders', auth()); setOrders(data.filter(o => (o.status || 'pending') === 'pending')); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEntries(); loadOrders(); }, []);
  async function completeOrder(o) { await api.patch(`/service-orders/${o.id}`, { status: 'done' }, auth()); setOrders(orders.filter(x => x.id !== o.id)); }

  function startOrder(o) {
    const existing = customers.find(c => c.name.toLowerCase() === (o.customer || '').toLowerCase());
    setSheetCustomer(existing || { id: null, name: o.customer, address: o.address || '', brands: [] });
    setSheetOrder(o);
  }
  useEffect(() => { api.get('/expenses', auth()).then(({ data }) => setExpensesTotal(data.filter(x => (x.driver || '') === user.name && (x.created_at || '').slice(0, 10) === date && x.status !== 'rejected').reduce((s, x) => s + Number(x.amount || 0), 0))); }, [date, tab, user.name]);

  function pickCustomer(c) { setPicker(false); setSheetOrder(null); setSheetCustomer(c); }
  function newCustomer() { setPicker(false); setSheetOrder(null); setSheetCustomer({ id: null, name: '', address: '', brands: [] }); }

  function onEntryComplete(entry) {
    setEntries([entry, ...entries]);
    if (sheetOrder) { completeOrder(sheetOrder); setSheetOrder(null); }
    setSheetCustomer(null);
    setPostDelivery(entry);
    setToast('Entrega registrada!');
    setTimeout(() => setToast(''), 2200);
  }

  const titles = { clientes: ['Clientes de hoje', 'Selecione o cliente e lance a quantidade'], diario: ['Controle Diário', 'Hoje · viagem 1'], caixa: ['Caixa do dia', 'Fechamento do entregador'], despesas: ['Despesas', 'Registre os gastos do dia'], ajustes: ['Ajustes', 'Tema, texto e conta'] };
  const [title, subtitle] = titles[tab];

  return <div className={`mobile-app${theme === 'dark' ? ' dark' : ''}`} style={{ '--scale': textScale }} data-testid="mobile-driver-app">
    <MobileHeader user={user} title={title} subtitle={subtitle} theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
    <main className="mob-main">
      {tab === 'clientes' && <MobileClientesTab customers={customers} entries={entries} orders={orders} onStartOrder={startOrder} date={date} onOpenPicker={() => setPicker(true)} onOpenCustomer={c => { setSheetOrder(null); setSheetCustomer(c); }} search={search} setSearch={setSearch} />}
      {tab === 'diario' && <MobileDiarioTab entries={entries} date={date} />}
      {tab === 'caixa' && <MobileCaixaTab entries={entries} expensesTotal={expensesTotal} date={date} onAddExpense={() => setTab('despesas')} onCloseDay={() => { setToast('Dia fechado!'); setTimeout(() => setToast(''), 2200); }} />}
      {tab === 'despesas' && <MobileDespesasTab user={user} date={date} />}
      {tab === 'ajustes' && <MobileAjustesTab user={user} theme={theme} setTheme={setTheme} textScale={textScale} setTextScale={setTextScale} onLogout={onLogout} />}
    </main>
    <MobileBottomNav tab={tab} setTab={setTab} />
    {picker && <MobilePickerSheet customers={customers} onClose={() => setPicker(false)} onPick={pickCustomer} onNewCustomer={newCustomer} />}
    {sheetCustomer && <MobileLaunchPanel customer={sheetCustomer} prefillOrder={sheetOrder} user={user} date={date} onClose={() => { setSheetCustomer(null); setSheetOrder(null); }} onComplete={onEntryComplete} />}
    {postDelivery && <MobileReceiptPrompt entry={postDelivery} customer={customers.find(c => c.name === postDelivery.customer)} onSavePhone={p => savePhoneForCustomerName(postDelivery.customer, p)} onClose={() => setPostDelivery(null)} />}
    <MobileToast text={toast} />
  </div>
}

/* =================== fim app mobile do entregador ==================== */

function App() {
  const [user, setUser] = useState(null), [data, setData] = useState(null), [customers, setCustomers] = useState([]), [checking, setChecking] = useState(true), [modal, setModal] = useState(null), [editCustomer, setEditCustomer] = useState(null), [notifications, setNotifications] = useState({ pending_users: 0, pending_expenses: 0, total: 0 }), [refreshing, setRefreshing] = useState(false);
  useEffect(() => { const t = localStorage.getItem('hydro_token'); if (t) api.get('/auth/me', auth()).then(x => setUser(x.data)).catch(() => localStorage.removeItem('hydro_token')).finally(() => setChecking(false)); else setChecking(false) }, []);
  async function loadDashboard() {
    setRefreshing(true);
    try { const [a, c] = await Promise.all([api.get('/dashboard', auth()), api.get('/customers', auth())]); setData(a.data); setCustomers(c.data); }
    finally { setRefreshing(false); }
  }
  useEffect(() => { if (user) loadDashboard(); }, [user]);
  useEffect(() => {
    if (!user) return;
    const fetchNotif = () => api.get('/notifications', auth()).then(x => setNotifications(x.data)).catch(() => { });
    fetchNotif();
    const id = setInterval(fetchNotif, 30000);
    window.hydroRefreshNotifications = fetchNotif;
    return () => clearInterval(id);
  }, [user, data]);
  const isMobile = useMediaQuery('(max-width:700px)');
  if (checking) return <div className="loading">Carregando operação...</div>;
  if (!user) return <Login onLogin={setUser} />;
  const logout = () => { localStorage.removeItem('hydro_token'); setUser(null) };
  if (user.role === 'driver' && isMobile) return <DriverMobileApp user={user} customers={customers} onLogout={logout} />;
  async function save(kind, form) { const endpoints = { product: '/products', expense: '/expenses', customer: '/customers' }; const payload = { ...form };['quantity', 'minimum', 'value', 'amount'].forEach(k => { if (payload[k] !== undefined) payload[k] = Number(payload[k]) }); if (kind === 'expense') { payload.status = 'approved'; if (!payload.driver) payload.driver = user.name; } const { data: x } = await api.post(endpoints[kind], payload, auth()); if (kind === 'customer') setCustomers([...customers, x]); else { const key = kind === 'product' ? 'products' : 'expenses_list'; setData({ ...data, [key]: [...(data?.[key] || []), x] }) } setModal(null) }
  async function updateCustomer(id, form) { const { data: x } = await api.patch(`/customers/${id}`, form, auth()); setCustomers(customers.map(c => c.id === id ? x : c)); setEditCustomer(null); }
  const modalFields = fields[modal];
  const adminOnly = el => user.role === 'admin' ? el : <Navigate to="/" replace />;
  return <Shell user={user} onLogout={logout} notifications={notifications}>
    <Routes>
      <Route path="/" element={<Dashboard data={data} onRefresh={loadDashboard} refreshing={refreshing} />} />
      <Route path="/controle-diario" element={user.role === 'driver' ? <DailyControl user={user} customers={customers} /> : <Navigate to="/" replace />} />
      <Route path="/estoque" element={<Stock data={data} setData={setData} create={setModal} />} />
      <Route path="/financeiro" element={<Finance data={data} setData={setData} create={setModal} user={user} />} />
      <Route path="/provisao" element={adminOnly(<Receivables />)} />
      <Route path="/ordens-servico" element={adminOnly(<ServiceOrders customers={customers} />)} />
      <Route path="/comprovantes" element={adminOnly(<Receipts customers={customers} />)} />
      <Route path="/marcas" element={adminOnly(<BrandsCatalog />)} />
      <Route path="/marcas-extras" element={adminOnly(<OutOfCatalogBrands />)} />
      <Route path="/clientes" element={<Customers items={customers} create={setModal} onEdit={setEditCustomer} />} />
      <Route path="/usuarios" element={adminOnly(<UsersPage me={user} />)} />
      <Route path="/fechamento" element={adminOnly(<DailyClosing />)} />
      <Route path="/atividade" element={adminOnly(<ActivityPage />)} />
      <Route path="/relatorios" element={adminOnly(<Reports />)} />
    </Routes>
    {modal === 'customer' && <CustomerModal onClose={() => setModal(null)} onSave={x => save('customer', x)} />}
    {editCustomer && <CustomerModal customer={editCustomer} onClose={() => setEditCustomer(null)} onSave={x => updateCustomer(editCustomer.id, x)} />}
    {modal === 'product' && <ProductModal onClose={() => setModal(null)} onSave={x => save('product', x)} />}
    {modal && modal !== 'customer' && modal !== 'product' && <Modal title={{ expense: 'Lançar despesa' }[modal]} fields={modalFields} onClose={() => setModal(null)} onSave={x => save(modal, x)} />}
  </Shell>
}
export default () => <BrowserRouter><App /></BrowserRouter>;

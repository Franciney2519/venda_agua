import { useEffect, useState, useMemo, useRef } from "react";
import axios from "axios";
import { BrowserRouter, Routes, Route, NavLink, Navigate, Link } from "react-router-dom";
import { LayoutDashboard, Truck, Package, WalletCards, Users, LogOut, Plus, Menu, X, Droplets, ArrowUpRight, AlertTriangle, Clock3, CircleDollarSign, BarChart3, Save, Loader2, FileDown, FileText, ShieldCheck, UserPlus, KeyRound, Trash2, Pencil, Activity, Check, XCircle, CalendarCheck, Wallet, Eye, EyeOff, Minus, Sun, Moon, Camera, Search, Fuel, Utensils, Wrench, Receipt, ChevronRight, RefreshCw, Eraser, Percent, Route as RouteIcon, Ellipsis, ArrowRight, ArrowLeft, ChevronUp, ChevronDown, CircleCheck, CircleX, TriangleAlert, Flag, Lock, QrCode, Banknote, Split, CalendarClock, MessageCircle, MessageSquareText, Hand, Play } from "lucide-react";
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

function useAutoRefresh(refresh, intervalMs = 15000) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      Promise.resolve(refreshRef.current?.()).catch(() => { /* keep the last valid data */ });
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') run(); };
    const id = setInterval(run, intervalMs);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);
}
const nav = [
  ['/', 'Visão geral', LayoutDashboard],
  ['/marcas', 'Cadastro de Produto', Droplets],
  ['/marcas-extras', 'Produtos Fora do Cadastro', AlertTriangle],
  ['/usuarios', 'Cadastro de Usuário', ShieldCheck],
  ['/clientes', 'Clientes', Users],
  ['/estoque', 'Estoque', Package],
  ['/viagens', 'Viagens', Truck],
  ['/comprovantes', 'Comprovantes', FileText],
  ['/financeiro', 'Financeiro', WalletCards],
  ['/margem', 'Margem', Percent],
  ['/provisao', 'Provisão de Pagamento', Wallet],
  ['/fechamento', 'Fechamento', CalendarCheck],
  ['/atividade', 'Atividade', Activity],
  ['/relatorios', 'Relatórios', BarChart3],
];
const driverNav = [['/', 'Visão geral', LayoutDashboard], ['/viagens', 'Viagens', Truck], ['/financeiro', 'Financeiro', WalletCards]];

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
      <option value="normal">Normal — paga à vista na entrega</option>
      <option value="prazo">Especial — paga a prazo (15 ou 30 dias)</option>
    </select></label>
    <label>Produtos que este cliente compra (água, gás, etc.) — preço com troca de vasilhame e, se for diferente, preço do vasilhame completo (novo)</label>
    {brands.map((b, i) => <div className="brand-price-row" key={i}>
      <input placeholder="Produto (ex: Minalar 20L, Gás P13)" value={b.brand} data-testid={`modal-brand-input-${i}`} onChange={e => updateBrand(i, 'brand', e.target.value)} />
      <input type="number" step="0.01" placeholder="Preço c/ troca" value={b.price} data-testid={`modal-brand-price-${i}`} onChange={e => updateBrand(i, 'price', e.target.value)} />
      <input type="number" step="0.01" placeholder="Preço completo (opcional)" value={b.price_full} data-testid={`modal-brand-price-full-${i}`} onChange={e => updateBrand(i, 'price_full', e.target.value)} />
      {brands.length > 1 && <button type="button" className="action-btn reject" aria-label="Remover marca" onClick={() => removeBrand(i)}><Trash2 size={13} /></button>}
    </div>)}
    <button type="button" className="ghost-btn" data-testid="modal-add-brand" onClick={addBrand}><Plus size={14} /> Adicionar outro produto</button>
    {error && <div className="error" data-testid="form-validation-error">{error}</div>}
    <button className="primary full" data-testid="modal-submit-button"><Save size={16} /> {isEdit ? 'Salvar alterações' : 'Salvar lançamento'}</button>
  </form></div>
}

function PerformanceChart({ refreshKey }) {
  const [monthly, setMonthly] = useState([]);
  const [hover, setHover] = useState(null);
  useEffect(() => { api.get('/dashboard/monthly', auth()).then(x => setMonthly(x.data)).catch(() => setMonthly([])); }, [refreshKey]);
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

function Dashboard({ data, onRefresh, refreshing, lastUpdated, isDriver }) {
  const today = (data?.deliveries || []);
  return <><section className="section-head"><div><p className="eyebrow">PAINEL DE CONTROLE</p><h2>Visão geral</h2><p className="muted">Acompanhe a saúde da sua operação em um só lugar.</p></div>
      <div className="dashboard-refresh"><small>{lastUpdated ? `Atualizado às ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : 'Aguardando atualização'}</small><button type="button" className="ghost-btn" data-testid="dashboard-refresh-button" disabled={refreshing} onClick={onRefresh}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Atualizando...' : 'Atualizar dados'}</button></div>
    </section>
    <div className="stats">
      {!isDriver && <>
      <Stat label="Receita no mês" value={money(data?.revenue)} detail="Lançamentos do Controle Diário" Icon={CircleDollarSign} />
      <Stat label="Despesas no mês" value={money(data?.expenses)} detail="Lançadas pelos entregadores" Icon={WalletCards} tone="orange" />
      <Stat label="Receita líquida" value={money((data?.revenue || 0) - (data?.expenses || 0))} detail="Receita − despesas do mês" Icon={Wallet} tone={(data?.revenue || 0) - (data?.expenses || 0) >= 0 ? 'green' : 'red'} />
      </>}
      <Stat label="Lançamentos hoje" value={today.length} detail="Registrados pelos entregadores" Icon={Truck} tone="green" />
      <Stat label="Alertas de estoque" value={data?.products?.filter(x => x.quantity < x.minimum).length || 0} detail="Itens abaixo do mínimo" Icon={AlertTriangle} tone="red" />
    </div>
    <div className="dashboard-grid">
      {!isDriver && <section className="panel performance"><div className="panel-head"><div><h3>Desempenho financeiro</h3><p className="muted">Últimos 6 meses · passe o mouse para ver os detalhes</p></div><BarChart3 className="blue-text" /></div><PerformanceChart refreshKey={lastUpdated} /></section>}
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
  const submittedRef = useRef(false);
  const [submitted, setSubmitted] = useState(false);
  function save() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setSubmitted(true);
    onSave(canvasRef.current.toDataURL('image/png'), signerName.trim());
  }

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
    <button type="button" className="mob-cta green" data-testid="signature-save" disabled={empty || submitted} onClick={save}>{submitted ? 'Enviando...' : 'Concluir parada'}</button>
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
      <button type="button" className="primary" data-testid="signature-save" onClick={save} disabled={empty || submitted}><Check size={16} /> {submitted ? 'Enviando...' : 'Concluir parada'}</button>
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

function ProductModal({ onClose, onSave, product }) {
  const isEdit = !!product;
  const [brands, setBrands] = useState([]);
  const [form, setForm] = useState(isEdit
    ? { brand: product.brand || '', name: product.name || '', category: product.category || 'Retornável', unit: product.unit || 'un', quantity: product.quantity ?? '', minimum: product.minimum ?? '', cost_price: product.cost_price ?? '', units_per_package: product.units_per_package ?? '', batch: product.batch || '', purchase_date: product.purchase_date || '' }
    : { brand: '', name: '', category: 'Retornável', unit: 'un', quantity: '', minimum: '', cost_price: '', units_per_package: '', batch: '', purchase_date: '' });
  const [error, setError] = useState('');

  useEffect(() => { api.get('/brands', auth()).then(({ data }) => setBrands(data.filter(b => b.active !== false))); }, []);

  function pickBrand(brandName) {
    const b = brands.find(x => x.name === brandName);
    setForm({ ...form, brand: brandName, name: brandName || form.name, cost_price: form.cost_price || (b?.cost_price ?? '') });
  }

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.name.trim()) return setError('Informe o nome do produto.');
    if (form.quantity === '' || form.minimum === '') return setError('Informe quantidade e estoque mínimo.');
    try {
      const payload = { ...form, minimum: Number(form.minimum) };
      if (isEdit) delete payload.quantity; else payload.quantity = Number(form.quantity);
      if (payload.cost_price !== '') payload.cost_price = Number(payload.cost_price); else delete payload.cost_price;
      if (payload.unit === 'fardo' && payload.units_per_package !== '') payload.units_per_package = Number(payload.units_per_package); else delete payload.units_per_package;
      if (!payload.batch) delete payload.batch;
      if (!payload.purchase_date) delete payload.purchase_date;
      await onSave(payload);
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }

  return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose} data-testid="modal-close-button"><X /></button>
    <p className="eyebrow">{isEdit ? 'EDITAR PRODUTO' : 'NOVO LANÇAMENTO'}</p>
    <h3>{isEdit ? `Editar ${product.name}` : 'Cadastrar produto'}</h3>
    <label>Marca (cadastrada em Cadastro de Produto)<select value={form.brand} data-testid="modal-brand-input" onChange={e => pickBrand(e.target.value)}>
      <option value="">Sem marca / outro produto</option>
      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
    </select></label>
    {brands.length === 0 && <p className="muted" style={{ marginTop: -8 }}>Nenhuma marca cadastrada ainda — cadastre em <b>Cadastro de Produto</b> primeiro para vinculá-la ao estoque.</p>}
    <label>Nome do produto{form.brand && <small className="muted"> · puxado da marca selecionada</small>}<input required disabled={!!form.brand} value={form.name} data-testid="modal-name-input" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
    <label>Categoria<select value={form.category} data-testid="modal-category-input" onChange={e => setForm({ ...form, category: e.target.value })}>
      <option>Retornável</option><option>Descartável</option>
    </select></label>
    <label>Unidade de medida<select value={form.unit} data-testid="modal-unit-input" onChange={e => setForm({ ...form, unit: e.target.value })}>
      <option value="un">Unidade avulsa</option>
      <option value="fardo">Fardo</option>
    </select></label>
    <p className="muted" style={{ marginTop: -8, fontSize: 12 }}>{form.unit === 'fardo' ? 'Cadastre mínimo e custo sempre em fardos — e lance as vendas desse produto também em fardos.' : 'Cadastre mínimo e custo por unidade avulsa.'}</p>
    {isEdit ? <label>Quantidade em estoque ({form.unit === 'fardo' ? 'fardos' : 'unidades'})<input disabled value={form.quantity} data-testid="modal-quantity-input" /><small className="muted">Para mudar a quantidade, use "Ajustar" na lista de estoque.</small></label>
      : <label>Quantidade ({form.unit === 'fardo' ? 'fardos' : 'unidades'})<input required type="number" value={form.quantity} data-testid="modal-quantity-input" onChange={e => setForm({ ...form, quantity: e.target.value })} /></label>}
    <label>Estoque mínimo ({form.unit === 'fardo' ? 'fardos' : 'unidades'})<input required type="number" value={form.minimum} data-testid="modal-minimum-input" onChange={e => setForm({ ...form, minimum: e.target.value })} /></label>
    <label>{form.unit === 'fardo' ? 'Custo de compra (R$ por fardo)' : 'Custo de compra (R$ por unidade)'}{form.brand && <small className="muted"> · puxado da marca, edite se mudou</small>}<input type="number" step="0.01" value={form.cost_price} data-testid="modal-cost_price-input" onChange={e => setForm({ ...form, cost_price: e.target.value })} /></label>
    {form.unit === 'fardo' && <>
      <label>Unidades por fardo<input type="number" placeholder="ex: 12" value={form.units_per_package} data-testid="modal-units_per_package-input" onChange={e => setForm({ ...form, units_per_package: e.target.value })} /></label>
      {form.cost_price !== '' && form.units_per_package !== '' && Number(form.units_per_package) > 0 && <p className="muted" style={{ marginTop: -8, fontSize: 12 }}>Custo por unidade avulsa (calculado): <b>{money(Number(form.cost_price) / Number(form.units_per_package))}</b> — usado para calcular o lucro quando a venda for por unidade.</p>}
    </>}
    <label>Lote<input value={form.batch} data-testid="modal-batch-input" onChange={e => setForm({ ...form, batch: e.target.value })} /></label>
    <label>Data de compra<input type="date" value={form.purchase_date} data-testid="modal-purchase_date-input" onChange={e => setForm({ ...form, purchase_date: e.target.value })} /></label>
    {error && <div className="error" data-testid="form-validation-error">{error}</div>}
    <button className="primary full" data-testid="modal-submit-button"><Save size={16} /> {isEdit ? 'Salvar alterações' : 'Salvar lançamento'}</button>
  </form></div>
}

function LotModal({ products, product, onClose, onSaved }) {
  const [productId, setProductId] = useState(product?.id || products[0]?.id || '');
  const chosen = products.find(p => p.id === productId);
  const [purchaseDate, setPurchaseDate] = useState(todayISO(0));
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState(product?.cost_price ?? '');
  const [costFull, setCostFull] = useState('');
  const [notes, setNotes] = useState('');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  function pick(id) { setProductId(id); const p = products.find(x => x.id === id); setCost(p?.cost_price ?? ''); }
  const [y, m, d] = (purchaseDate || '').split('-');
  const preview = y && quantity !== '' && Number(quantity) > 0 ? `${d}${m}${y.slice(2)}${Math.round(Number(quantity))}` : null;
  async function submit(e) {
    e.preventDefault(); setError('');
    if (!chosen) return setError('Escolha o produto.');
    if (!(Number(quantity) > 0)) return setError('Informe a quantidade comprada.');
    if (cost === '' || Number(cost) < 0) return setError('Informe o custo por unidade.');
    setSaving(true);
    try {
      const payload = { quantity: Number(quantity), cost_price: Number(cost), purchase_date: purchaseDate, adjust_stock: !opening };
      if (costFull !== '') payload.cost_price_full = Number(costFull);
      if (notes.trim()) payload.notes = notes.trim();
      const { data: lot } = await api.post(`/products/${chosen.id}/lots`, payload, auth());
      setDone(lot); onSaved(lot);
    } catch (err) { setError(err.response?.data?.detail || 'Não foi possível registrar a compra.'); }
    finally { setSaving(false); }
  }
  if (done) return <div className="modal-backdrop"><div className="quick-modal">
    <button type="button" className="modal-close" onClick={onClose} data-testid="lot-close"><X /></button>
    <p className="eyebrow">LOTE REGISTRADO</p>
    <h3 data-testid="lot-created-code">{done.code}</h3>
    <p className="muted">{done.product_name} · {done.quantity_initial} un a {money(done.cost_unit)}{opening ? ' (saldo anterior — estoque não alterado)' : ' — estoque atualizado'}.</p>
    <button type="button" className="primary full" onClick={onClose}>Concluir</button>
  </div></div>;
  return <div className="modal-backdrop"><form className="quick-modal" onSubmit={submit}>
    <button type="button" className="modal-close" onClick={onClose} data-testid="lot-close"><X /></button>
    <p className="eyebrow">COMPRA DE ESTOQUE</p>
    <h3>Registrar compra (novo lote)</h3>
    <label>Produto<select value={productId} data-testid="lot-product" onChange={e => pick(e.target.value)}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label>Data da compra<input type="date" required value={purchaseDate} data-testid="lot-date" onChange={e => setPurchaseDate(e.target.value)} /></label>
    <label>Quantidade comprada ({(chosen?.unit || '').startsWith('fardo') ? 'fardos' : 'unidades'})<input required type="number" min="1" value={quantity} data-testid="lot-quantity" onChange={e => setQuantity(e.target.value)} /></label>
    <label>Custo somente água (R$ por {(chosen?.unit || '').startsWith('fardo') ? 'fardo' : 'unidade'})<input required type="number" step="0.01" min="0" value={cost} data-testid="lot-cost" onChange={e => setCost(e.target.value)} /></label>
    <label>Custo venda completa (opcional)<input type="number" step="0.01" min="0" value={costFull} placeholder="vazio = igual ao custo somente água" data-testid="lot-cost-full" onChange={e => setCostFull(e.target.value)} /></label>
    <label>Observação (fornecedor, nota fiscal...)<input value={notes} data-testid="lot-notes" onChange={e => setNotes(e.target.value)} /></label>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={opening} data-testid="lot-opening" onChange={e => setOpening(e.target.checked)} /> Já está no estoque (saldo anterior) — só cria o lote, sem somar a quantidade</label>
    <p className="muted" style={{ fontSize: 12 }}>Código do lote: <b>{preview ? `${preview}NNN` : 'ddmmaa + quantidade + NNN'}</b> — NNN é o número da compra no dia, gerado ao salvar.</p>
    {error && <div className="error" data-testid="lot-error">{error}</div>}
    <button className="primary full" disabled={saving} data-testid="lot-submit"><Save size={16} /> {saving ? 'Salvando...' : 'Registrar compra'}</button>
  </form></div>
}

function LotsPanel({ lots, products, onNew, onDelete, onExport }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const rows = (lots || []).filter(l => showEmpty || Number(l.quantity_remaining) > 0);
  const fmt = d => (d || '').split('-').reverse().join('/');
  return <section className="panel table-panel" style={{ marginTop: 22 }} data-testid="lots-panel">
    <div className="panel-head" style={{ padding: '18px 23px' }}>
      <div><h3>Lotes de compra</h3><p className="muted">Cada compra vira um lote com seu custo. As vendas saem do lote mais antigo primeiro e a margem usa o custo real desse lote.</p></div>
      <div className="row-actions"><button type="button" className="ghost-btn" data-testid="stock-export-csv" onClick={onExport}><FileDown size={15} /> CSV do estoque</button><label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}><input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} /> mostrar esgotados</label><button type="button" className="primary" data-testid="lot-new-button" onClick={onNew} disabled={products.length === 0}><Plus size={15} /> Registrar compra</button></div>
    </div>
    <div className="table-wrap"><table><thead><tr><th>LOTE</th><th>DATA</th><th>PRODUTO</th><th>COMPRADO</th><th>RESTANTE</th><th>CUSTO (ÁGUA / COMPLETA)</th><th>VALOR RESTANTE</th><th /></tr></thead><tbody>
      {rows.map(l => <tr key={l.id} data-testid={`lot-row-${l.code}`}>
        <td><b>{l.code}</b>{l.notes && <small>{l.notes}</small>}</td><td>{fmt(l.purchase_date)}</td><td>{l.product_name}</td><td>{l.quantity_initial}</td>
        <td><span className={`tag ${Number(l.quantity_remaining) > 0 ? 'green' : 'gray'}`}>{l.quantity_remaining}</span></td>
        <td>{money(l.cost_unit)}{l.cost_unit_full != null ? ` / ${money(l.cost_unit_full)}` : ''}</td>
        <td>{money(Number(l.quantity_remaining) * Number(l.cost_unit))}</td>
        <td>{Number(l.quantity_remaining) === Number(l.quantity_initial) && <button type="button" className="action-btn reject" aria-label="Excluir lote" data-testid={`lot-delete-${l.code}`} onClick={() => onDelete(l)}><Trash2 size={13} /></button>}</td>
      </tr>)}
      {rows.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 16 }}>Nenhum lote {showEmpty ? 'registrado' : 'com saldo'}. Registre a próxima compra para controlar o custo por lote.</td></tr>}
    </tbody></table></div>
  </section>
}

function StockMovements() {
  const [movements, setMovements] = useState(null);
  function load() { api.get('/stock-movements', auth()).then(x => setMovements(x.data)).catch(() => setMovements([])); }
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);
  const reasonLabel = { venda: 'Venda', estorno: 'Estorno', ajuste: 'Ajuste', mf_defeito: 'Defeito (MF)', mf_reagendado: 'MF reagendado', sem_correspondencia: 'Sem produto correspondente', vasilhame_vazio: 'Vasilhame vazio', compra: 'Compra (lote)' };
  const pendingExchange = (movements || []).filter(m => m.reason === 'mf_defeito' && !m.resolved);
  const pendingReschedule = (movements || []).filter(m => m.reason === 'mf_reagendado' && !m.resolved);
  const unmatched = (movements || []).filter(m => m.reason === 'sem_correspondencia');
  const pendingEmpty = (movements || []).filter(m => m.reason === 'vasilhame_vazio' && !m.resolved);
  const pendingEmptyByBrand = Object.values(pendingEmpty.reduce((acc, m) => {
    const key = m.product_name || m.brand;
    acc[key] = acc[key] || { key, total: 0 };
    acc[key].total += Number(m.quantity) || 0;
    return acc;
  }, {}));
  async function markExchanged(m) { await api.patch(`/stock-movements/${m.id}`, {}, auth()); load(); }
  return <>
    {pendingReschedule.length > 0 && <div className="stock-alert" data-testid="mf-reschedule-alert" style={{ marginTop: 22 }}>
      <AlertTriangle size={19} />
      <div><b>{pendingReschedule.length} troca{pendingReschedule.length > 1 ? 's' : ''} de MF reagendada{pendingReschedule.length > 1 ? 's' : ''} para outra visita</b>
        <span>{pendingReschedule.map(m => `${m.product_name || m.brand} (${m.pending_quantity}) · ${m.customer}${m.mf_date ? ` · ${m.mf_date}` : ''}`).join(' · ')} — confirme "Troca realizada" quando o entregador levar o galão novo.</span>
      </div>
    </div>}
    {pendingExchange.length > 0 && <div className="stock-alert" data-testid="mf-exchange-alert" style={{ marginTop: 22 }}>
      <AlertTriangle size={19} />
      <div><b>{pendingExchange.length} galão{pendingExchange.length > 1 ? 'ões' : ''} com defeito (microfuro) aguardando troca com o fornecedor</b>
        <span>{pendingExchange.map(m => `${m.product_name || m.brand} (${Math.abs(m.quantity)})${m.viagem_codigo ? ` · ${m.rota_codigo || m.viagem_codigo}` : ''}`).join(' · ')}</span>
      </div>
    </div>}
    {pendingEmpty.length > 0 && <div className="stock-alert" data-testid="empty-return-alert" style={{ marginTop: 22 }}>
      <Package size={19} />
      <div><b>{pendingEmpty.length} lote{pendingEmpty.length > 1 ? 's' : ''} de vasilhame vazio aguardando envio ao fornecedor</b>
        <span>{pendingEmptyByBrand.map(b => `${b.key} (${b.total})`).join(' · ')}</span>
      </div>
    </div>}
    {unmatched.length > 0 && <div className="stock-alert" data-testid="stock-unmatched-alert" style={{ marginTop: 22 }}>
      <AlertTriangle size={19} />
      <div><b>{unmatched.length} venda{unmatched.length > 1 ? 's' : ''} não baixaram estoque — marca não cadastrada em Estoque</b>
        <span>{[...new Set(unmatched.map(m => m.brand))].join(' · ')} — cadastre um produto com esse nome/marca para o estoque acompanhar essas vendas.</span>
      </div>
    </div>}
    <section className="panel table-panel" style={{ marginTop: 22 }}>
      <div className="panel-head" style={{ padding: '18px 23px' }}><div><h3>Movimentação de estoque</h3><p className="muted">Saídas por venda, defeitos (MF) e entradas por estorno, com a venda de origem</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>DATA</th><th>PRODUTO</th><th>QTD</th><th>MOTIVO</th><th>VENDA DE ORIGEM</th><th /></tr></thead><tbody>
        {(movements || []).map(m => <tr key={m.id} data-testid={`stock-movement-${m.id}`}>
          <td><small>{formatDateTimeManaus(m.created_at)}</small></td>
          <td><b>{m.product_name || m.brand}</b></td>
          <td>{m.reason === 'mf_reagendado' ? <span className="tag orange">pendente ({m.pending_quantity})</span> : m.reason === 'sem_correspondencia' ? <span className="tag gray">—</span> : <span className={`tag ${m.quantity < 0 ? 'red' : 'green'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</span>}</td>
          <td>{(m.reason === 'mf_defeito' || m.reason === 'mf_reagendado' || m.reason === 'sem_correspondencia' || m.reason === 'vasilhame_vazio') ? <span className="tag orange">{reasonLabel[m.reason]}</span> : (reasonLabel[m.reason] || m.reason)}</td>
          <td>{m.lot_code ? <small>Lote {m.lot_code}</small> : m.entry_number ? <small>Nº {m.entry_number} · {m.customer}{m.driver ? ` · ${m.driver}` : ''}{m.rota_codigo ? ` · ${m.rota_codigo}` : (m.viagem_codigo ? ` · ${m.viagem_codigo}` : '')}</small> : <small className="muted">{m.viagem_codigo || '—'}</small>}</td>
          <td>{(m.reason === 'mf_defeito' || m.reason === 'mf_reagendado' || m.reason === 'vasilhame_vazio') && (m.resolved ? <span className="tag green" title={m.resolved_note}>{m.resolved_note?.includes('fornecedor') ? 'Enviado' : 'Trocado'}</span> : <button className="action-btn ghost" data-testid={`mf-mark-exchanged-${m.id}`} onClick={() => markExchanged(m)}>{m.reason === 'mf_reagendado' ? 'Troca realizada' : m.reason === 'vasilhame_vazio' ? 'Marcar enviado' : 'Marcar trocado'}</button>)}</td>
        </tr>)}
        {movements?.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Nenhuma movimentação registrada ainda.</td></tr>}
      </tbody></table></div>
    </section>
  </>
}

function Stock({ data, setData, create }) {
  const [adjusting, setAdjusting] = useState(null);
  const [editing, setEditing] = useState(null);
  const [lots, setLots] = useState(null);
  const [buying, setBuying] = useState(null);
  const [brandCodes, setBrandCodes] = useState({});
  useEffect(() => { api.get('/brands', auth()).then(x => setBrandCodes(Object.fromEntries(x.data.map(b => [(b.name || '').trim().toLowerCase(), b.code])))).catch(() => { }); }, []);
  const skuOf = p => brandCodes[(p.brand || p.name || '').trim().toLowerCase()];
  function loadLots() { api.get('/lots', auth()).then(x => setLots(x.data)).catch(() => setLots([])); }
  useEffect(() => { loadLots(); }, []);
  useAutoRefresh(loadLots);
  async function exportStock() {
    const res = await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/reports/export-stock.csv`, auth());
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await res.blob());
    link.download = `distribuidora-diane-estoque-${todayISO(0)}.csv`;
    link.click();
  }
  async function refreshProducts() { const { data: d } = await api.get('/dashboard', auth()); setData(d); }
  async function deleteLot(l) {
    if (!window.confirm(`Excluir o lote ${l.code}? A quantidade dele sai do estoque.`)) return;
    try { await api.delete(`/lots/${l.id}`, auth()); loadLots(); refreshProducts(); }
    catch (e) { window.alert(e.response?.data?.detail || 'Não foi possível excluir o lote.'); }
  }
  async function saveAdjustment(payload) {
    const { data: updated } = await api.patch(`/products/${adjusting.id}`, payload, auth());
    setData({ ...data, products: data.products.map(p => p.id === updated.id ? updated : p) });
    setAdjusting(null);
  }
  async function saveEdit(payload) {
    const { data: updated } = await api.patch(`/products/${editing.id}`, payload, auth());
    setData({ ...data, products: data.products.map(p => p.id === updated.id ? updated : p) });
    setEditing(null);
  }
  const products = data?.products || [];
  const openLotsByProduct = (lots || []).reduce((acc, l) => { if (Number(l.quantity_remaining) > 0) (acc[l.product_id] = acc[l.product_id] || []).push(l); return acc; }, {});
  const lotRemaining = p => (openLotsByProduct[p.id] || []).reduce((s, l) => s + Number(l.quantity_remaining), 0);
  const productValue = p => openLotsByProduct[p.id] ? openLotsByProduct[p.id].reduce((s, l) => s + Number(l.quantity_remaining) * Number(l.cost_unit), 0) : (Number(p.quantity) || 0) * (Number(p.cost_price) || 0);
  const stockValue = products.reduce((s, p) => s + productValue(p), 0);
  const missingCost = products.filter(p => p.cost_price == null && p.quantity > 0).length;
  const defectiveTotal = products.reduce((s, p) => s + (Number(p.defective_quantity) || 0), 0);
  const emptyTotal = products.reduce((s, p) => s + (Number(p.empty_quantity) || 0), 0);
  return <><Head eyebrow="INVENTÁRIO" title="Estoque" subtitle="Produtos, galões retornáveis e níveis mínimos." action="Novo produto" onAction={() => create('product')} />
    <div className="stats">
      <Stat label="Valor em estoque" value={money(stockValue)} detail={missingCost > 0 ? `${missingCost} produto${missingCost > 1 ? 's' : ''} sem custo cadastrado` : 'Soma dos lotes abertos (custo de cada compra); sem lote, custo × quantidade'} Icon={WalletCards} tone={missingCost > 0 ? 'orange' : ''} />
      <Stat label="Galões com defeito" value={defectiveTotal} detail="Parados no depósito, aguardando troca com o fornecedor" Icon={AlertTriangle} tone={defectiveTotal > 0 ? 'red' : 'green'} />
      <Stat label="Vasilhames vazios" value={emptyTotal} detail="Recebidos dos clientes, aguardando envio ao fornecedor" Icon={Package} tone={emptyTotal > 0 ? 'orange' : 'green'} />
    </div>
    <div className="stock-alert" data-testid="stock-alert"><AlertTriangle size={19} /><div><b>{products.filter(x => x.quantity < x.minimum).length} produtos precisam de reposição</b><span>Confira os itens antes da próxima rota.</span></div></div><section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>PRODUTO</th><th>MARCA</th><th>CATEGORIA</th><th>DISPONÍVEL</th><th>MÍNIMO</th><th>DEFEITO</th><th>VAZIO</th><th>VALOR EM ESTOQUE</th><th>SITUAÇÃO</th><th>LOTE / COMPRA</th><th /></tr></thead><tbody>{products.map(p => <tr key={p.id} data-testid={`stock-row-${p.id}`}><td><b>{p.name}</b><small data-testid={`stock-sku-${p.id}`}>{skuOf(p) ? `SKU ${skuOf(p)}` : 'sem código'}</small></td><td>{p.brand || '—'}</td><td>{p.category}</td><td>{p.quantity} {p.unit || 'un'}</td><td>{p.minimum}</td><td>{p.defective_quantity ? <span className="tag red" data-testid={`stock-defective-${p.id}`}>{p.defective_quantity}</span> : <small className="muted">—</small>}</td><td>{p.empty_quantity ? <span className="tag orange" data-testid={`stock-empty-${p.id}`}>{p.empty_quantity}</span> : <small className="muted">—</small>}</td><td>{openLotsByProduct[p.id] || p.cost_price != null ? money(productValue(p)) : <small className="muted">sem custo</small>}{lots && (Number(p.quantity) > lotRemaining(p) + 0.0001) && <small className="orange-text" data-testid={`stock-no-lot-${p.id}`}>{Number(p.quantity) - lotRemaining(p)} un sem lote</small>}</td><td><span className={`tag ${p.quantity < p.minimum ? 'red' : 'green'}`}>{p.quantity < p.minimum ? 'Repor' : 'Saudável'}</span></td><td><small className="muted">{p.batch ? `Lote ${p.batch}` : '—'}{p.purchase_date ? ` · ${p.purchase_date}` : ''}</small></td><td className="row-actions"><button className="action-btn ghost" data-testid={`stock-edit-${p.id}`} onClick={() => setEditing(p)}><Pencil size={13} /> Editar</button><button className="action-btn ghost" data-testid={`stock-buy-${p.id}`} onClick={() => setBuying({ product: p })}>Compra</button><button className="action-btn ghost" data-testid={`stock-adjust-${p.id}`} onClick={() => setAdjusting(p)}>Ajustar</button></td></tr>)}{products.length === 0 && <tr><td colSpan={11} className="muted" style={{ padding: 16 }}>Nenhum produto cadastrado.</td></tr>}</tbody></table></div></section>
    {adjusting && <StockAdjustModal product={adjusting} onClose={() => setAdjusting(null)} onSave={saveAdjustment} />}
    {editing && <ProductModal product={editing} onClose={() => setEditing(null)} onSave={saveEdit} />}
    {buying && <LotModal products={products} product={buying.product} onClose={() => setBuying(null)} onSaved={() => { loadLots(); refreshProducts(); }} />}
    <LotsPanel lots={lots} products={products} onNew={() => setBuying({ product: null })} onDelete={deleteLot} onExport={exportStock} />
    <StockMovements />
  </> }

function Finance({ data, setData, create, user }) {
  const [summary, setSummary] = useState(null);
  async function loadSummary() { const { data: s } = await api.get('/finance/summary', auth()); setSummary(s); }
  useEffect(() => { loadSummary(); }, [data]);
  useAutoRefresh(loadSummary);
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
      <Stat label="Saldo do dia" value={money(summary?.balance_today)} detail="Pix + Dinheiro (sem a prazo) − despesas lançadas hoje" Icon={ArrowUpRight} />
      <Stat label="A prazo pendente" value={money(summary?.comp_pending_total)} detail="Vendas ainda não recebidas" Icon={Clock3} tone="orange" />
    </div>
    {isAdmin && <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 23px' }}>
        <div><h3>Vendas a prazo (COMP)</h3><p className="muted">{money(summary?.comp_pending_total)} pendentes · {money(summary?.comp_received_total)} já recebidos</p></div>
        <Link to="/provisao" className="ghost-btn" data-testid="finance-provisao-link"><Wallet size={15} /> Ver Provisão de Pagamento</Link>
      </div>
    </section>}
    <section className="panel table-panel"><div className="panel-head"><div><h3>Despesas</h3><p className="muted">{isAdmin ? 'Aprove ou reprove os lançamentos feitos fora do Controle Diário' : 'Seus lançamentos'}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>TIPO</th><th>ENTREGADOR</th><th>VIAGEM</th><th>VALOR</th><th>STATUS</th>{isAdmin && <th>AÇÕES</th>}</tr></thead><tbody>
        {(data?.expenses_list || []).map(e => {
          const st = e.status || 'pending';
          const tag = st === 'approved' ? 'green' : st === 'rejected' ? 'red' : 'orange';
          const label = st === 'approved' ? 'Aprovada' : st === 'rejected' ? 'Reprovada' : 'Aguardando aprovação';
          return <tr key={e.id} data-testid={`expense-row-${e.id}`}>
            <td><b>{e.type}</b>{e.reviewed_by && <small>Revisado por {e.reviewed_by}</small>}</td>
            <td>{e.driver}</td>
            <td>{e.viagem_codigo ? <small>{e.viagem_codigo}</small> : <small className="muted">—</small>}</td>
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
        {(data?.expenses_list || []).length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} className="muted" style={{ padding: 16 }}>Nenhuma despesa lançada.</td></tr>}
      </tbody></table></div></section></>
}

const MARGIN_STATUS_LABEL = { saudavel: 'Saudável', atencao: 'Em atenção', baixa: 'Margem baixa', prejuizo: 'Em prejuízo', sem_custo: 'Sem custo' };
const MARGIN_STATUS_TAG = { saudavel: 'green', atencao: 'orange', baixa: 'orange', prejuizo: 'red', sem_custo: 'gray' };
const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;

function MarginReport() {
  const [report, setReport] = useState(null);
  const [simBrand, setSimBrand] = useState('');
  const [simPrice, setSimPrice] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  async function load() { const { data } = await api.get('/reports/margin', { ...auth(), params: { start: start || undefined, end: end || undefined } }); setReport(data); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [start, end]);
  useAutoRefresh(load);

  const rows = report?.rows || [];
  const semCusto = rows.filter(r => r.status === 'sem_custo');
  const abaixoMeta = rows.filter(r => r.status === 'baixa' || r.status === 'prejuizo');
  const simRow = rows.find(r => r.brand === simBrand);
  const simCost = simRow?.cost_price;
  const simPriceNum = Number(simPrice) || 0;
  const simMargin = simCost != null && simPriceNum > 0 ? (simPriceNum - simCost) / simPriceNum : null;
  const simSafe = simMargin != null && simMargin >= 0;

  return <><Head eyebrow="LUCRATIVIDADE" title="Margem" subtitle="Quanto cada marca, categoria e cliente realmente deixa de lucro, considerando o custo de compra cadastrado." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>De<input type="date" value={start} max={end || undefined} data-testid="margin-start-date" onChange={e => setStart(e.target.value)} /></label>
        <label>Até<input type="date" value={end} min={start || undefined} data-testid="margin-end-date" onChange={e => setEnd(e.target.value)} /></label>
        {(start || end) && <button className="ghost-btn" data-testid="margin-clear-dates" onClick={() => { setStart(''); setEnd(''); }}>Limpar período (mês atual)</button>}
      </div>
    </div>
    <div className="stats">
      <Stat label="Total de produtos" value={report?.total_produtos ?? '—'} detail="Marcas com venda no período" Icon={Package} />
      <Stat label="Saudáveis" value={report?.counts?.saudavel ?? '—'} detail="Margem dentro do alvo" Icon={CircleDollarSign} tone="green" />
      <Stat label="Em atenção / baixa" value={(report?.counts?.atencao ?? 0) + (report?.counts?.baixa ?? 0)} detail="Abaixo da meta, sem estar no prejuízo" Icon={AlertTriangle} tone="orange" />
      <Stat label="Em prejuízo" value={report?.counts?.prejuizo ?? '—'} detail="Vendendo no vermelho" Icon={AlertTriangle} tone={report?.counts?.prejuizo > 0 ? 'red' : 'green'} />
    </div>
    <div className="stats" style={{ marginTop: -6 }}>
      <Stat label="Margem média" value={pct(report?.margin_media)} detail={`Considerando produtos com custo cadastrado · alvo padrão ${pct(report?.default_target_margin)}`} Icon={Percent} />
      <Stat label="Receita no período" value={money(report?.revenue_total)} detail={report ? `${report.start} a ${report.end}` : ''} Icon={ArrowUpRight} />
      <Stat label="Despesas no período" value={money(report?.expenses_total)} detail="Combustível, pedágio etc. lançados pelos entregadores" Icon={WalletCards} tone="orange" />
      <Stat label="Lucro líquido" value={money(report?.lucro_liquido)} detail="Margem bruta − despesas do período" Icon={CircleDollarSign} tone={report?.lucro_liquido < 0 ? 'red' : 'green'} />
    </div>
    {semCusto.length > 0 && <div className="stock-alert" data-testid="margin-no-cost-alert">
      <AlertTriangle size={19} /><div><b>{semCusto.length} marca{semCusto.length > 1 ? 's' : ''} sem custo cadastrado</b>
        <span>{semCusto.map(r => r.brand).join(' · ')} — sem isso não dá para calcular a margem real. Cadastre o custo em <Link to="/marcas">Cadastro de Produto</Link>.</span>
      </div>
    </div>}
    {abaixoMeta.length > 0 && <div className="stock-alert" data-testid="margin-below-target-alert">
      <AlertTriangle size={19} /><div><b>{abaixoMeta.length} marca{abaixoMeta.length > 1 ? 's' : ''} abaixo da margem desejada</b>
        <span>{abaixoMeta.map(r => `${r.brand} (${pct(r.margin_pct)})`).join(' · ')}</span>
      </div>
    </div>}

    <section className="panel" style={{ marginBottom: 22, padding: 23 }}>
      <div className="panel-head"><div><h3>Evolução da margem média</h3><p className="muted">Últimas 8 semanas · margem sobre os produtos com custo cadastrado</p></div></div>
      <div className="chart" style={{ height: 190 }}><div className="bars">
        {(report?.evolution || []).map(w => {
          const target = report?.default_target_margin || 0.3;
          const color = w.margin_pct == null ? '#c9d4de' : w.margin_pct < 0 ? 'var(--red)' : w.margin_pct < target ? '#f8c45d' : 'var(--green)';
          const heightPct = w.margin_pct == null ? 2 : Math.max(4, Math.min(100, (w.margin_pct / Math.max(target * 1.5, 0.01)) * 100));
          return <div className="bar-group" key={w.end} data-testid={`margin-evo-bar-${w.end}`} title={w.margin_pct != null ? `${w.label}: ${pct(w.margin_pct)}` : `${w.label}: sem vendas`}>
            <div className="bar" style={{ width: 20, height: `${heightPct}%`, background: color }} />
            <span>{w.label}</span>
          </div>;
        })}
        {(!report?.evolution || report.evolution.length === 0) && <p className="muted" style={{ padding: '30px 0' }}>Sem dados suficientes ainda.</p>}
      </div></div>
    </section>

    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <div className="panel-head" style={{ padding: '18px 23px' }}><div><h3>Margem por categoria</h3><p className="muted">Como cada categoria de produto está performando</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>CATEGORIA</th><th>PRODUTOS</th><th>RECEITA</th><th>MARGEM MÉDIA</th><th>EM RISCO</th></tr></thead><tbody>
        {(report?.categories || []).map(c => <tr key={c.category} data-testid={`margin-category-${c.category}`}>
          <td><b>{c.category}</b></td><td>{c.produtos}</td><td>{money(c.revenue)}</td>
          <td><span className={`tag ${c.margin_pct == null ? 'gray' : c.margin_pct < 0 ? 'red' : c.margin_pct < (report?.default_target_margin || 0.3) ? 'orange' : 'green'}`}>{pct(c.margin_pct)}</span></td>
          <td>{c.em_risco > 0 ? <span className="tag orange">{c.em_risco}</span> : <small className="muted">0</small>}</td>
        </tr>)}
        {(report?.categories || []).length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Nenhuma venda no período.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <div className="panel-head" style={{ padding: '18px 23px' }}><div><h3>Margem por marca (fornecedor)</h3><p className="muted">Compare o que cada marca deixa de lucro real</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>MARCA</th><th>CATEGORIA</th><th>VENDIDO</th><th>RECEITA</th><th>CUSTO</th><th>MARGEM</th><th>SITUAÇÃO</th></tr></thead><tbody>
        {rows.map(r => <tr key={r.brand} data-testid={`margin-row-${r.brand}`}>
          <td><b>{r.brand}</b></td><td>{r.category}</td><td>{r.quantity}</td><td>{money(r.revenue)}</td>
          <td>{r.cost_total != null ? money(r.cost_total) : <small className="muted">sem custo</small>}</td>
          <td>{r.margin_value != null ? <><b>{money(r.margin_value)}</b> <small className="muted">({pct(r.margin_pct)})</small></> : <small className="muted">—</small>}</td>
          <td><span className={`tag ${MARGIN_STATUS_TAG[r.status]}`}>{MARGIN_STATUS_LABEL[r.status]}</span></td>
        </tr>)}
        {rows.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 16 }}>Nenhuma venda no período.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <div className="panel-head" style={{ padding: '18px 23px' }}><div><h3>Margem por cliente</h3><p className="muted">Quanto cada cliente realmente deixa de lucro</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>CLIENTE</th><th>ENTREGAS</th><th>VENDIDO</th><th>RECEITA</th><th>CUSTO</th><th>MARGEM</th></tr></thead><tbody>
        {(report?.customers || []).map(c => <tr key={c.customer} data-testid={`margin-customer-${c.customer}`}>
          <td><b>{c.customer}</b></td><td>{c.entregas}</td><td>{c.quantity}</td><td>{money(c.revenue)}</td>
          <td>{c.cost_total != null ? money(c.cost_total) : <small className="muted">sem custo</small>}</td>
          <td>{c.margin_value != null ? <><b className={c.margin_value < 0 ? 'orange-text' : ''}>{money(c.margin_value)}</b> <small className="muted">({pct(c.margin_pct)})</small></> : <small className="muted">—</small>}</td>
        </tr>)}
        {(report?.customers || []).length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>Nenhuma venda no período.</td></tr>}
      </tbody></table></div>
    </section>

    <section className="panel table-panel">
      <div className="panel-head" style={{ padding: '18px 23px' }}><div><h3>Simulador de desconto seguro</h3><p className="muted">Veja até onde dá para descontar sem vender no prejuízo</p></div></div>
      <div className="os-form" style={{ paddingTop: 0 }}>
        <label>Marca<select value={simBrand} data-testid="margin-sim-brand" onChange={e => setSimBrand(e.target.value)}>
          <option value="">Selecione</option>
          {rows.filter(r => r.cost_price != null).map(r => <option key={r.brand} value={r.brand}>{r.brand}</option>)}
        </select></label>
        <label className="os-field-narrow">Preço de venda simulado (R$)<input type="number" step="0.01" value={simPrice} data-testid="margin-sim-price" onChange={e => setSimPrice(e.target.value)} /></label>
      </div>
      {simRow && <div style={{ padding: '0 23px 20px' }}>
        <p className="muted">Custo de compra: <b>{money(simCost)}</b> {simPriceNum > 0 && <>· Preço mínimo pra não ter prejuízo: <b>{money(simCost)}</b></>}</p>
        {simPriceNum > 0 && <div className={`stock-alert`} style={{ background: simSafe ? undefined : '#fff0f0', borderColor: simSafe ? undefined : '#f4c8c8' }} data-testid="margin-sim-result">
          {simSafe ? <CircleDollarSign size={19} /> : <AlertTriangle size={19} />}
          <div><b>{simSafe ? `Margem de ${pct(simMargin)} — seguro` : 'Vendendo no prejuízo com esse preço'}</b>
            <span>Lucro por unidade: {money(simPriceNum - simCost)}{simSafe && ` · desconto máximo a partir do preço atual sem prejuízo: até ${money(simPriceNum - simCost)} por unidade`}</span>
          </div>
        </div>}
      </div>}
    </section>
  </>
}

function Customers({ items, create, onEdit }) {
  const [search, setSearch] = useState('');
  const filtered = items.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || (x.code || '').toLowerCase().includes(search.toLowerCase())).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  return <><Head eyebrow="RELACIONAMENTO" title="Clientes" subtitle="Sua carteira, marcas de água e preço combinado por cliente." action="Novo cliente" onAction={() => create('customer')} />
    <div className="mob-search" style={{ marginBottom: 18, maxWidth: 360 }}><Search size={16} /><input placeholder="Buscar por nome ou código" value={search} data-testid="customers-search-input" onChange={e => setSearch(e.target.value)} /></div>
    <div className="customer-grid">{filtered.map(x => { const brandList = x.brands?.length ? x.brands : (x.brand ? [{ brand: x.brand, price: x.price }] : []); return <div className="customer-card" key={x.id} data-testid={`customer-card-${x.id}`}><div className="customer-avatar">{x.name?.[0]}</div><div><b>{x.name}{x.code && <small style={{ display: 'inline', marginLeft: 6, fontWeight: 400 }}>#{x.code}</small>}</b><span>{x.address}</span><small>{x.phone || 'Sem telefone'}{x.payment_type === 'prazo' && <span className="tag orange" style={{ marginLeft: 6 }}>Especial</span>}</small>{brandList.length > 0 && <div className="customer-brands">{brandList.map((b, i) => <span className="tag blue" key={i}>{b.brand} · {money(b.price)}</span>)}</div>}</div><button type="button" className="action-btn ghost" data-testid={`customer-edit-${x.id}`} onClick={() => onEdit(x)}><Pencil size={15} /></button></div> })}
    {filtered.length === 0 && <p className="muted">Nenhum cliente encontrado.</p>}
    </div></> }


function UsersPage({ me }) {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState('all');
  async function load() { const { data } = await api.get('/users', auth()); setItems(data); window.hydroRefreshNotifications?.(); }
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);
  const filtered = items.filter(x => filter === 'all' || (filter === 'pending' && x.status === 'pending') || (filter === 'active' && x.active !== false && x.status === 'approved') || (filter === 'inactive' && (x.active === false || x.status === 'rejected')));
  async function approve(u) { await api.post(`/users/${u.id}/approve`, {}, auth()); load(); }
  async function reject(u) { await api.post(`/users/${u.id}/reject`, {}, auth()); load(); }
  async function toggleActive(u) { await api.patch(`/users/${u.id}`, { active: !u.active }, auth()); load(); }
  async function changeRole(u, role) { await api.patch(`/users/${u.id}`, { role }, auth()); load(); }
  async function del(u) { if (!window.confirm(`Excluir ${u.name}?`)) return; await api.delete(`/users/${u.id}`, auth()); load(); }
  return <><Head eyebrow="ACESSOS" title="Cadastro de Usuário" subtitle="Aprove cadastros, gerencie perfis e reset de senhas." action="Novo usuário" onAction={() => setModal({ mode: 'create' })} />
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
            <button className="action-btn ghost" aria-label="Editar usuário" data-testid={`edit-user-${u.id}`} onClick={() => setModal({ mode: 'edit', user: u })}><Pencil size={13} /></button>
            <button className="action-btn ghost" aria-label="Redefinir senha" data-testid={`reset-user-${u.id}`} onClick={() => setModal({ mode: 'reset', user: u })}><KeyRound size={13} /></button>
            {u.id !== me.id && <button className="action-btn reject" aria-label="Excluir usuário" data-testid={`delete-user-${u.id}`} onClick={() => del(u)}><Trash2 size={13} /></button>}
          </div></td>
        </tr>
      })}
      {filtered.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: 16 }}>Nenhum usuário encontrado.</td></tr>}
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
  async function load() { const { data } = await api.get('/activity', auth()); setItems(data); }
  useEffect(() => { load().catch(() => setItems([])); }, []);
  useAutoRefresh(load);
  const labels = { signup: 'Cadastro recebido', user_created: 'Usuário criado', user_approved: 'Usuário aprovado', user_rejected: 'Usuário reprovado', user_updated: 'Usuário editado', user_deleted: 'Usuário excluído', password_reset: 'Senha redefinida', expense_approved: 'Despesa aprovada', expense_rejected: 'Despesa reprovada', expense_pending: 'Despesa reaberta', daily_closing_closed: 'Dia fechado', daily_closing_reopened: 'Dia reaberto' };
  const tones = { user_approved: 'green', expense_approved: 'green', daily_closing_closed: 'green', user_rejected: 'red', expense_rejected: 'red', user_deleted: 'red', user_created: 'blue', signup: 'blue', password_reset: 'orange', daily_closing_reopened: 'orange', user_updated: 'gray', expense_pending: 'gray' };
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
  const [actionDriver, setActionDriver] = useState(null);
  const [error, setError] = useState('');
  async function load() {
    setLoading(true);
    try { const { data: r } = await api.get('/daily-closing', { ...auth(), params: { date } }); setData(r); } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);
  useAutoRefresh(load);

  async function reopen(driver) {
    if (!window.confirm(`Reabrir o dia ${date} para ${driver}? O entregador poderá voltar a lançar e corrigir dados.`)) return;
    setActionDriver(driver); setError('');
    try { await api.post('/daily-closing/reopen', { date, driver }, auth()); await load(); }
    catch (e) { setError(e.response?.data?.detail || 'Não foi possível reabrir o dia.'); }
    finally { setActionDriver(null); }
  }

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
    {error && <div className="error" style={{ marginBottom: 16 }} data-testid="closing-error">{error}</div>}
    <div className="stats">
      <Stat label="Receita bruta" value={money(totals.revenue)} detail="Total das entregas, incluindo a prazo" Icon={CircleDollarSign} tone="green" />
      <Stat label="Despesas aprovadas" value={money(totals.expenses_approved)} detail="Só as já aprovadas pelo admin" Icon={Wallet} tone="orange" />
      <Stat label="Saldo líquido" value={money(totals.balance)} detail="Receita bruta − despesas aprovadas" Icon={ArrowUpRight} tone="" />
      <Stat label="Lançamentos" value={totals.deliveries_total || 0} detail="Registrados no Controle Diário" Icon={Truck} />
    </div>
    <section className="panel table-panel" data-testid="closing-panel">
      <div className="panel-head"><div><h3>Fechamento por entregador</h3><p className="muted">{rows.length ? `${rows.length} entregador(es) com movimentação no dia` : 'Nenhuma movimentação encontrada para essa data'}</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>ENTREGADOR</th><th>LANÇAMENTOS</th><th>RECEITA</th><th>DESP. APROVADAS</th><th>DESP. PENDENTES</th><th>SALDO</th><th>STATUS</th><th /></tr></thead><tbody>
        {rows.map(d => <tr key={d.driver} data-testid={`closing-row-${d.driver}`}>
          <td><b>{d.driver}</b></td>
          <td><span className="tag blue">{d.deliveries_total}</span></td>
          <td>{money(d.revenue)}</td>
          <td className="green-text">{money(d.expenses_approved)}</td>
          <td className="orange-text">{money(d.expenses_pending)}</td>
          <td><b>{money(d.balance)}</b></td>
          <td><span className={`tag ${d.is_closed ? 'green' : 'orange'}`}>{d.is_closed ? 'Fechado' : 'Em aberto'}</span></td>
          <td>{d.is_closed && <button type="button" className="action-btn ghost" disabled={actionDriver === d.driver} data-testid={`closing-reopen-${d.driver}`} onClick={() => reopen(d.driver)}>{actionDriver === d.driver ? 'Reabrindo...' : 'Reabrir dia'}</button>}</td>
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

function manausDate(isoString) {
  // Same -4h shift as todayISO, applied to an arbitrary UTC timestamp (e.g. created_at)
  // instead of "now" — so comparing it to todayISO() actually lines up. A naive
  // isoString.slice(0,10) compares the UTC date instead, which is wrong for anything
  // logged after ~20:00 Manaus time (already past midnight UTC).
  if (!isoString) return '';
  return new Date(new Date(isoString).getTime() - 4 * 3600 * 1000).toISOString().slice(0, 10);
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
  useAutoRefresh(load);
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
  const [form, setForm] = useState({ name: '', cost_price: '', category: '' });
  const [error, setError] = useState('');
  const [editingCost, setEditingCost] = useState(null);
  const [costDraft, setCostDraft] = useState('');
  const [editingCostFull, setEditingCostFull] = useState(null);
  const [costFullDraft, setCostFullDraft] = useState('');
  const [editingMargin, setEditingMargin] = useState(null);
  const [marginDraft, setMarginDraft] = useState('');
  const [historyFor, setHistoryFor] = useState(null);
  const [history, setHistory] = useState([]);
  async function openHistory(b) { setHistoryFor(b); const { data } = await api.get('/brands/cost-history', { ...auth(), params: { brand_id: b.id } }); setHistory(data); }
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryDraft, setCategoryDraft] = useState('');
  const nextCode = String(Math.max(0, ...brands.map(b => parseInt(b.code, 10) || 0)) + 1).padStart(4, '0');

  async function load() { const { data } = await api.get('/brands', auth()); setBrands(data); }
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);

  async function submit(e) {
    e.preventDefault(); setError('');
    if (!form.name.trim()) return setError('Informe o nome da marca.');
    try {
      const payload = { ...form, code: nextCode, active: true };
      if (payload.cost_price !== '') payload.cost_price = Number(payload.cost_price); else delete payload.cost_price;
      const { data } = await api.post('/brands', payload, auth());
      setBrands([data, ...brands]); setForm({ name: '', cost_price: '', category: '' });
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
  }

  async function toggleActive(b) { const { data } = await api.patch(`/brands/${b.id}`, { active: !(b.active !== false) }, auth()); setBrands(brands.map(x => x.id === b.id ? data : x)); }
  async function remove(b) { if (!window.confirm(`Excluir a marca "${b.name}"?`)) return; await api.delete(`/brands/${b.id}`, auth()); setBrands(brands.filter(x => x.id !== b.id)); }
  async function saveCost(b) {
    const { data } = await api.patch(`/brands/${b.id}`, { cost_price: Number(costDraft) || 0 }, auth());
    setBrands(brands.map(x => x.id === b.id ? data : x)); setEditingCost(null);
  }
  async function saveCostFull(b) {
    const { data } = await api.patch(`/brands/${b.id}`, { cost_price_full: costFullDraft === '' ? null : Number(costFullDraft) }, auth());
    setBrands(brands.map(x => x.id === b.id ? data : x)); setEditingCostFull(null);
  }
  async function saveMargin(b) {
    const { data } = await api.patch(`/brands/${b.id}`, { target_margin: marginDraft === '' ? null : Number(marginDraft) / 100 }, auth());
    setBrands(brands.map(x => x.id === b.id ? data : x)); setEditingMargin(null);
  }
  async function saveCategory(b) {
    const { data } = await api.patch(`/brands/${b.id}`, { category: categoryDraft || null }, auth());
    setBrands(brands.map(x => x.id === b.id ? data : x)); setEditingCategory(null);
  }

  return <><Head eyebrow="CADASTRO" title="Cadastro de Produto" subtitle="Catálogo de marcas com código e custo de compra, usado no cadastro de clientes, nos lançamentos e no cálculo de lucro por marca." />
    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <form className="daily-entry-form" style={{ gridTemplateColumns: '.6fr 1fr .9fr .8fr auto' }} onSubmit={submit}>
        <label>Código<input readOnly value={nextCode} data-testid="brand-code-input" /></label>
        <label>Marca<input required placeholder="ex: Minalar" value={form.name} data-testid="brand-name-input" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
        <label>Categoria (opcional)<input placeholder="ex: Retornável" value={form.category} data-testid="brand-category-input" onChange={e => setForm({ ...form, category: e.target.value })} /></label>
        <label>Custo de compra (R$/un)<input type="number" step="0.01" placeholder="0,00" value={form.cost_price} data-testid="brand-cost-input" onChange={e => setForm({ ...form, cost_price: e.target.value })} /></label>
        <button className="primary" data-testid="brand-submit-button"><Plus size={15} /> Adicionar</button>
      </form>
      {error && <div className="error" style={{ margin: '0 23px 16px' }} data-testid="brand-form-error">{error}</div>}
    </section>
    <section className="panel table-panel"><div className="table-wrap"><table className="brand-table"><thead><tr><th>CÓDIGO</th><th>MARCA</th><th>CATEGORIA</th><th>CUSTO SOMENTE ÁGUA</th><th>CUSTO VENDA COMPLETA</th><th>MARGEM ALVO</th><th>SITUAÇÃO</th><th /></tr></thead><tbody>
      {brands.map(b => { const active = b.active !== false; return <tr key={b.id} data-testid={`brand-row-${b.id}`}>
        <td>{b.code || '—'}</td><td><b>{b.name}</b></td>
        <td>{editingCategory === b.id
          ? <div className="row-actions"><input autoFocus style={{ width: 110 }} value={categoryDraft} data-testid={`brand-category-edit-${b.id}`} onChange={e => setCategoryDraft(e.target.value)} /><button type="button" className="action-btn approve" data-testid={`brand-category-save-${b.id}`} onClick={() => saveCategory(b)}><Check size={13} /></button></div>
          : <button type="button" className="action-btn ghost" data-testid={`brand-category-${b.id}`} onClick={() => { setEditingCategory(b.id); setCategoryDraft(b.category || ''); }}>{b.category || <span className="muted">definir</span>} <Pencil size={12} /></button>}
        </td>
        <td>{editingCost === b.id
          ? <div className="row-actions"><input type="number" step="0.01" autoFocus style={{ width: 90 }} value={costDraft} data-testid={`brand-cost-edit-${b.id}`} onChange={e => setCostDraft(e.target.value)} /><button type="button" className="action-btn approve" data-testid={`brand-cost-save-${b.id}`} onClick={() => saveCost(b)}><Check size={13} /></button></div>
          : <button type="button" className="action-btn ghost" data-testid={`brand-cost-${b.id}`} onClick={() => { setEditingCost(b.id); setCostDraft(b.cost_price ?? ''); }}>{b.cost_price ? money(b.cost_price) : <span className="muted">definir</span>} <Pencil size={12} /></button>}
        </td>
        <td>{editingCostFull === b.id
          ? <div className="row-actions"><input type="number" step="0.01" autoFocus style={{ width: 90 }} value={costFullDraft} data-testid={`brand-cost-full-edit-${b.id}`} onChange={e => setCostFullDraft(e.target.value)} /><button type="button" className="action-btn approve" data-testid={`brand-cost-full-save-${b.id}`} onClick={() => saveCostFull(b)}><Check size={13} /></button></div>
          : <button type="button" className="action-btn ghost" data-testid={`brand-cost-full-${b.id}`} onClick={() => { setEditingCostFull(b.id); setCostFullDraft(b.cost_price_full ?? ''); }}>{b.cost_price_full ? money(b.cost_price_full) : <span className="muted">= custo somente água</span>} <Pencil size={12} /></button>}
        </td>
        <td>{editingMargin === b.id
          ? <div className="row-actions"><input type="number" step="1" autoFocus style={{ width: 70 }} value={marginDraft} data-testid={`brand-margin-edit-${b.id}`} onChange={e => setMarginDraft(e.target.value)} /><button type="button" className="action-btn approve" data-testid={`brand-margin-save-${b.id}`} onClick={() => saveMargin(b)}><Check size={13} /></button></div>
          : <button type="button" className="action-btn ghost" data-testid={`brand-margin-${b.id}`} onClick={() => { setEditingMargin(b.id); setMarginDraft(b.target_margin != null ? Math.round(b.target_margin * 100) : ''); }}>{b.target_margin != null ? `${Math.round(b.target_margin * 100)}%` : <span className="muted">padrão (30%)</span>} <Pencil size={12} /></button>}
        </td>
        <td><span className={`tag ${active ? 'green' : 'gray'}`}>{active ? 'Ativa' : 'Inativa'}</span></td>
        <td><div className="row-actions">
          <button className="action-btn ghost" data-testid={`brand-history-${b.id}`} onClick={() => openHistory(b)}><Clock3 size={13} /> Histórico</button>
          <button className="action-btn ghost" data-testid={`brand-toggle-${b.id}`} onClick={() => toggleActive(b)}>{active ? 'Desativar' : 'Ativar'}</button>
          <button className="action-btn reject" aria-label="Excluir marca" data-testid={`brand-delete-${b.id}`} onClick={() => remove(b)}><Trash2 size={13} /></button>
        </div></td>
      </tr> })}
      {brands.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 16 }}>Nenhuma marca cadastrada.</td></tr>}
    </tbody></table></div></section>
    {historyFor && <div className="modal-backdrop" onClick={() => setHistoryFor(null)}><div className="quick-modal" onClick={e => e.stopPropagation()}>
      <button type="button" className="modal-close" onClick={() => setHistoryFor(null)} data-testid="brand-history-close"><X /></button>
      <p className="eyebrow">HISTÓRICO DE CUSTO</p>
      <h3>{historyFor.name}</h3>
      {history.length === 0 && <p className="muted">Nenhuma alteração de custo registrada ainda para esta marca.</p>}
      {history.length > 0 && <div style={{ display: 'grid', gap: 10 }}>
        {history.map(h => <div key={h.id} className="stock-alert" style={{ marginBottom: 0 }} data-testid={`brand-history-row-${h.id}`}>
          <Clock3 size={16} />
          <div>
            <b>{h.field === 'cost_price_full' ? 'Custo venda completa' : 'Custo somente água'}: {money(h.old_value)} → {money(h.new_value)}</b>
            <span>{formatDateTimeManaus(h.changed_at)} · por {h.changed_by}</span>
          </div>
        </div>)}
      </div>}
    </div></div>}
    </>
}

function OutOfCatalogBrands() {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  async function load() { const { data } = await api.get('/customers/out-of-catalog-brands', auth()); setRows(data); }
  useEffect(() => { load(); }, []);
  useAutoRefresh(load);
  async function promote(row) {
    if (!row.customer_id) return setError(`"${row.customer}" não é um cliente cadastrado — cadastre-o primeiro em Clientes.`);
    setBusy(`${row.customer}-${row.brand}`); setError('');
    try { await api.post(`/customers/${row.customer_id}/promote-brand`, { brand: row.brand, price: row.price }, auth()); await load(); }
    catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar.'); }
    finally { setBusy(null); }
  }
  return <><Head eyebrow="CADASTRO" title="Produtos Fora do Cadastro" subtitle="Marcas que os entregadores lançaram fora do cadastro do cliente — revise e salve as que devem virar padrão." />
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

function CustomerCombobox({ customers, value, onPick, testId }) {
  const [query, setQuery] = useState(value || '');
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const blurTimer = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { setQuery(value || ''); }, [value]);
  useEffect(() => {
    if (!open) return;
    function updateRect() { if (inputRef.current) setRect(inputRef.current.getBoundingClientRect()); }
    updateRect();
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => { window.removeEventListener('scroll', updateRect, true); window.removeEventListener('resize', updateRect); };
  }, [open]);
  const sorted = [...customers].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  const q = query.trim().toLowerCase();
  const filtered = q ? sorted.filter(c => (c.name || '').toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q)) : sorted;
  function pick(c) { setQuery(c.name); setOpen(false); onPick(c.name); }
  const listStyle = rect ? { position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width } : null;
  return <div className="combobox">
    <input
      ref={inputRef}
      value={query}
      placeholder="Nome ou código do cliente"
      data-testid={testId}
      onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onPick(''); }}
      onFocus={() => setOpen(true)}
      onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
    />
    {open && listStyle && filtered.length > 0 && <div className="combobox-list" style={listStyle} onMouseDown={e => e.preventDefault()}>
      {filtered.slice(0, 50).map(c => <button type="button" key={c.id} className="combobox-option" data-testid={`${testId}-option-${c.id}`} onClick={() => pick(c)}>
        <b>{c.name}</b>{c.code && <span className="combobox-code">#{c.code}</span>}
      </button>)}
    </div>}
    {open && listStyle && query && filtered.length === 0 && <div className="combobox-list" style={listStyle}><p className="combobox-empty">Nenhum cliente encontrado.</p></div>}
  </div>
}

const VIAGEM_STATUS_LABEL = { planejada: 'Planejada', execucao: 'Em execução', finalizada: 'Finalizada' };
const VIAGEM_STATUS_TAG = { planejada: 'orange', execucao: 'blue', finalizada: 'green' };

function Viagens({ customers, user }) {
  const isAdmin = user?.role === 'admin';
  const [viagens, setViagens] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [date, setDate] = useState(todayISO(0));
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ driver: '', turno: 0, carga_total: '' });
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try { const { data } = await api.get('/viagens', { ...auth(), params: { date } }); setViagens(data.viagens); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);
  useAutoRefresh(load);
  useEffect(() => { if (isAdmin) api.get('/users', auth()).then(({ data }) => setDrivers(data.filter(u => u.role === 'driver' && u.active !== false))); }, [isAdmin]);

  async function submit(e) {
    e.preventDefault(); setError('');
    if (isAdmin && !form.driver) return setError('Selecione o entregador.');
    try {
      const payload = { turno: Number(form.turno), carga_total: form.carga_total ? Number(form.carga_total) : undefined, date };
      if (isAdmin) payload.driver = form.driver;
      await api.post('/viagens', payload, auth());
      setForm({ driver: form.driver, turno: 0, carga_total: '' });
      await load();
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível criar a viagem.'); }
  }

  async function iniciar(v) { try { await api.post(`/viagens/${v.id}/iniciar`, {}, auth()); await load(); } catch (e) { setError(e.response?.data?.detail || 'Não foi possível iniciar.'); } }
  async function finalizar(v) { try { await api.post(`/viagens/${v.id}/finalizar`, {}, auth()); await load(); } catch (e) { setError(e.response?.data?.detail || 'Não foi possível finalizar.'); } }
  async function remove(v) { if (!window.confirm(`Excluir a viagem ${v.codigo_viagem}?`)) return; try { await api.delete(`/viagens/${v.id}`, auth()); await load(); } catch (e) { setError(e.response?.data?.detail || 'Não foi possível excluir.'); } }

  const emExecucao = viagens.filter(v => v.status === 'execucao').length;
  const finalizadas = viagens.filter(v => v.status === 'finalizada');
  const totalBruto = finalizadas.reduce((s, v) => s + Number(v.total_bruto || 0), 0);
  const despesasTotal = finalizadas.reduce((s, v) => s + Number(v.despesas_total || 0), 0);
  const saldoLiquido = totalBruto - despesasTotal;

  return <><Head eyebrow="LOGÍSTICA" title="Viagens" subtitle={isAdmin ? "Planeje o carregamento do caminhão — turno e carga. As rotas e clientes de cada viagem são adicionadas pelo entregador no app." : "Crie a viagem do dia (turno e carga); adicione as rotas e clientes pelo app do celular."} />
    <section className="panel table-panel" style={{ marginBottom: 22 }}>
      <form className="os-form" onSubmit={submit}>
        {isAdmin && <label>Entregador<select required value={form.driver} data-testid="viagem-driver-select" onChange={e => setForm({ ...form, driver: e.target.value })}><option value="">Selecione</option>{drivers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select></label>}
        <label>Turno<select value={form.turno} data-testid="viagem-turno-select" onChange={e => setForm({ ...form, turno: e.target.value })}><option value={0}>Manhã</option><option value={1}>Tarde</option></select></label>
        <label className="os-field-narrow">Carga total<input type="number" value={form.carga_total} data-testid="viagem-carga-input" onChange={e => setForm({ ...form, carga_total: e.target.value })} /></label>
      </form>

      <div style={{ padding: '0 23px 20px' }}>
        {error && <div className="error" data-testid="viagem-form-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="primary" data-testid="viagem-submit-button" onClick={submit}><Plus size={15} /> Criar viagem</button>
      </div>
    </section>

    <div className="report-toolbar">
      <div className="report-filters">
        <label>Data<input type="date" value={date} data-testid="viagens-date-input" onChange={e => setDate(e.target.value)} /></label>
      </div>
      {loading && <Loader2 size={16} className="spin blue-text" />}
    </div>
    <div className="stats">
      <Stat label="Viagens no dia" value={viagens.length} detail={`Limite de ${VIAGENS_POR_DIA} por entregador`} Icon={Truck} />
      <Stat label="Em execução" value={emExecucao} detail="Rotas em andamento agora" Icon={CircleDollarSign} tone="green" />
      <Stat label="Finalizadas" value={finalizadas.length} detail="Rotas concluídas no dia" Icon={CalendarCheck} />
      <Stat label="Saldo líquido das rotas" value={money(saldoLiquido)} detail={`Receita ${money(totalBruto)} − despesas ${money(despesasTotal)}`} Icon={WalletCards} tone="orange" />
    </div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>CÓDIGO</th><th>ENTREGADOR</th><th>VIAGEM DO DIA</th><th>TURNO</th><th>ROTAS</th><th>CLIENTES</th><th>CARGA</th><th>ENTREGAS</th><th>RECEITA</th><th>DESPESAS</th><th>SALDO</th><th>SITUAÇÃO</th><th /></tr></thead><tbody>
      {viagens.map(v => {
        const totalClientes = (v.rotas || []).reduce((s, r) => s + (r.clientes?.length || 0), 0);
        return <tr key={v.id} data-testid={`viagem-row-${v.id}`}>
        <td><b>{v.codigo_viagem}</b></td>
        <td>{v.driver}</td>
        <td>{v.numero}/{VIAGENS_POR_DIA}</td>
        <td>{TURNO_LABELS[v.turno]}</td>
        <td>{v.rotas?.length ?? '—'}</td>
        <td>{totalClientes || '—'}</td>
        <td>{v.carga_total ?? '—'}{v.status === 'finalizada' && v.quantidade_entregue != null ? <small className="muted" style={{ display: 'block' }}>entregue {v.quantidade_entregue}{v.carga_devolvida_total != null ? ` · devolvida ${v.carga_devolvida_total}` : ''}</small> : ''}</td>
        <td>{v.entregas ?? '—'}{v.mf_quantity_total > 0 ? <small className="orange-text" style={{ display: 'block' }}>{v.mf_quantity_total} un MF{v.problemas ? ` (${v.problemas} entrega${v.problemas > 1 ? 's' : ''})` : ''}</small> : ''}</td>
        <td>{v.total_bruto != null ? money(v.total_bruto) : '—'}</td>
        <td>{v.despesas_total != null ? money(v.despesas_total) : '—'}</td>
        <td>{v.saldo_liquido != null ? <b className={v.saldo_liquido >= 0 ? 'green-text' : 'orange-text'}>{money(v.saldo_liquido)}</b> : '—'}</td>
        <td><span className={`tag ${VIAGEM_STATUS_TAG[v.status]}`}>{VIAGEM_STATUS_LABEL[v.status]}</span></td>
        <td><div className="row-actions">
          {v.status === 'planejada' && <><button className="action-btn ghost" data-testid={`viagem-iniciar-${v.id}`} onClick={() => iniciar(v)}><Check size={13} /> Iniciar</button><button className="action-btn reject" aria-label="Excluir viagem" data-testid={`viagem-excluir-${v.id}`} onClick={() => remove(v)}><Trash2 size={13} /></button></>}
          {v.status === 'execucao' && <button className="action-btn ghost" data-testid={`viagem-finalizar-${v.id}`} onClick={() => finalizar(v)}><Check size={13} /> Finalizar</button>}
        </div></td>
      </tr>;
      })}
      {viagens.length === 0 && <tr><td colSpan={13} className="muted" style={{ padding: 16 }}>Nenhuma viagem registrada nessa data.</td></tr>}
    </tbody></table></div></section>
  </>
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
  const [codigoViagem, setCodigoViagem] = useState('');
  const [entryNumber, setEntryNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const params = { start, end };
      if (customer.trim()) params.customer = customer.trim();
      if (codigoViagem.trim()) params.codigo_viagem = codigoViagem.trim();
      if (entryNumber.trim()) params.entry_number = Number(entryNumber.trim());
      const { data } = await api.get('/daily-entries', { ...auth(), params });
      setEntries(data);
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [start, end]);
  useAutoRefresh(load);

  return <><Head eyebrow="AUDITORIA" title="Comprovantes de Entrega" subtitle="Busque um lançamento por cliente, período, viagem ou nº de sequência para conferir a assinatura." />
    <div className="report-toolbar">
      <div className="report-filters">
        <label>De<input type="date" value={start} max={end} data-testid="receipts-start-date" onChange={e => setStart(e.target.value)} /></label>
        <label>Até<input type="date" value={end} min={start} data-testid="receipts-end-date" onChange={e => setEnd(e.target.value)} /></label>
        <label>Cliente<input value={customer} placeholder="Buscar por nome" data-testid="receipts-customer-input" onChange={e => setCustomer(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} /></label>
        <label>Código da viagem<input value={codigoViagem} placeholder="ex: 001092026001" data-testid="receipts-viagem-input" onChange={e => setCodigoViagem(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} /></label>
        <label className="os-field-narrow">Nº entrega<input value={entryNumber} placeholder="ex: 7" data-testid="receipts-entry-number-input" onChange={e => setEntryNumber(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()} /></label>
        <button type="button" className="ghost-btn" data-testid="receipts-search-button" onClick={load}><Search size={14} /> Buscar</button>
      </div>
      {loading && <Loader2 size={16} className="spin blue-text" />}
    </div>
    <section className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Nº</th><th>VIAGEM</th><th>DATA</th><th>CLIENTE</th><th>ENTREGADOR</th><th>PRODUTO</th><th>TOTAL</th><th>ASSINATURA</th><th /></tr></thead><tbody>
      {entries.map(e => {
        const items = e.items?.length ? e.items : (e.brand ? [{ brand: e.brand, quantity: e.billed_quantity ?? e.quantity }] : []);
        return <tr key={e.id} data-testid={`receipt-row-${e.id}`}>
          <td>{e.entry_number ? `#${e.entry_number}` : '—'}</td>
          <td>{e.viagem_codigo ? <small>{e.viagem_codigo}</small> : <small className="muted">—</small>}</td>
          <td>{e.date}</td>
          <td><b>{e.customer}</b></td>
          <td>{e.driver}</td>
          <td>{items.map(it => `${it.quantity} ${it.brand}`).join(' + ')}</td>
          <td>{money(e.total)}</td>
          <td>{e.signature ? <span className="tag green">Assinado</span> : <span className="tag gray">Sem assinatura</span>}</td>
          <td><button className="action-btn ghost" data-testid={`receipt-view-${e.id}`} onClick={() => setViewing(e)}><FileText size={13} /> Ver</button></td>
        </tr>
      })}
      {entries.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: 16 }}>Nenhum lançamento encontrado no período/busca.</td></tr>}
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
  useAutoRefresh(load);

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

const TURNO_LABELS = { 0: 'Manhã', 1: 'Tarde' };
const VIAGENS_POR_TURNO = 6;
const VIAGENS_POR_DIA = VIAGENS_POR_TURNO * 2;

function nextBusinessDay() {
  let off = 1;
  for (;;) {
    const iso = todayISO(off);
    const wd = new Date(iso + 'T12:00:00Z').getUTCDay();
    if (wd !== 0 && wd !== 6) return iso;
    off += 1;
  }
}
const shortDate = iso => (iso || '').split('-').reverse().slice(0, 2).join('/');
const pad2 = n => String(n).padStart(2, '0');
const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const onlyDigits = (raw, max = 4) => String(raw).replace(/\D/g, '').slice(0, max);
const parseMoney = raw => Math.max(0, Number(String(raw ?? '').replace(',', '.')) || 0);
const round2 = v => Math.round(v * 100) / 100;
const galoes = n => `${n} ${n === 1 ? 'galão' : 'galões'}`;
const apiError = (e, fallback) => { const d = e?.response?.data?.detail; return typeof d === 'string' && d ? d : fallback; };
// Trocas de MF somadas a um pedido que já existia ocupam carga além da quantidade do pedido.
const mergedSwapQty = c => (c.mf_swaps || []).filter(s => s.merged).reduce((a, s) => a + Number(s.quantity || 0), 0);
const clienteLoad = c => Number(c.quantity || 0) + mergedSwapQty(c);
const entryItemsLabel = e => entryItemsList(e).map(it => `${it.quantity} ${it.brand}`).join(' + ') || galoes(Number(e.billed_quantity ?? e.quantity ?? 0));
function entryPayLabel(e) {
  const parts = [];
  if (Number(e.pix_value) > 0) parts.push(`Pix ${money(e.pix_value)}`);
  if (Number(e.cash_value) > 0) parts.push(`Dinheiro ${money(e.cash_value)}`);
  if (Number(e.comp_value) > 0) parts.push(`A prazo ${e.comp_days || 15}d ${money(e.comp_value)}`);
  return parts.join(' + ') || money(0);
}
const MOBILE_TITLES = { rota: 'Rota de hoje', viagens: 'Viagens do dia', diario: 'Controle diário', caixa: 'Caixa do dia', despesas: 'Despesas', mais: 'Ajustes' };
const MOBILE_SCALES = [[1, 'Normal'], [1.15, 'Grande'], [1.3, 'Maior']];

function MobBtn({ kind = 'primary', h = 60, icon: Icon, lead: Lead, children, className = '', ...rest }) {
  return <button type="button" className={`mob-btn mob-btn-${kind} ${className}`} style={{ minHeight: h }} {...rest}>{Lead && <Lead size={20} />}<span>{children}</span>{Icon && <Icon size={20} />}</button>
}

function MobileConfirm({ title, text, cancelLabel = 'Voltar', confirmLabel, onCancel, onConfirm, busy, testid }) {
  return <section className="mob-confirm" data-testid={testid}>
    <b>{title}</b>
    {text && <span>{text}</span>}
    <div className="mob-grid2">
      <MobBtn kind="outline" h={52} data-testid={testid && `${testid}-cancel`} onClick={onCancel}>{cancelLabel}</MobBtn>
      <MobBtn kind="ink" h={52} disabled={busy} data-testid={testid && `${testid}-ok`} onClick={onConfirm}>{confirmLabel}</MobBtn>
    </div>
  </section>
}

function MobileHeader({ user, title, theme, onToggleTheme }) {
  const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Manaus', weekday: 'short', day: '2-digit', month: '2-digit' }).replace('.', '');
  return <header className="mob-header">
    <div className="mob-header-text"><span className="mob-eyebrow">Portal do entregador · {today}</span><b data-testid="mob-title">{title}</b></div>
    <button type="button" className="mob-theme-btn" data-testid="mob-theme-toggle" aria-label={theme === 'dark' ? 'Usar fundo claro' : 'Usar fundo escuro'} onClick={onToggleTheme}>{theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}</button>
    <span className="mob-avatar">{user.name.split(' ').map(x => x[0]).join('').slice(0, 2)}</span>
  </header>
}

function MobileBottomNav({ tab, setTab }) {
  const items = [['rota', 'Rota', RouteIcon], ['diario', 'Diário', CalendarCheck], ['caixa', 'Caixa', CircleDollarSign], ['despesas', 'Despesas', WalletCards], ['mais', 'Mais', Ellipsis]];
  return <nav className="mob-bottom-nav">{items.map(([key, label, Icon]) => <button type="button" key={key} className={tab === key || (key === 'rota' && tab === 'viagens') ? 'active' : ''} data-testid={`mob-tab-${key}`} onClick={() => setTab(key)}><Icon size={22} /><span>{label}</span></button>)}</nav>
}

function MobileToast({ text }) { if (!text) return null; return <div className="mob-toast" role="status" data-testid="mob-toast">{text}</div> }

function MobileStuckTrips({ viagens, onFinalizar }) {
  const [asking, setAsking] = useState(null);
  if (!viagens?.length) return null;
  return <section className="mob-alert col" data-testid="mob-stuck-trips">
    <div className="mob-alert-head"><TriangleAlert size={20} /><b>Viagem anterior ainda aberta</b></div>
    <span>Conclua para liberar as viagens de hoje.</span>
    {viagens.map(v => asking === v.id
      ? <MobileConfirm key={v.id} testid={`mob-stuck-confirm-${v.id}`} title={`Concluir a viagem de ${shortDate(v.date)}?`} text="O que sobrou da carga volta para o estoque." confirmLabel="Concluir" onCancel={() => setAsking(null)} onConfirm={() => { setAsking(null); onFinalizar(v); }} />
      : <MobBtn key={v.id} kind="warn" h={48} lead={Flag} data-testid={`mob-stuck-finalizar-${v.id}`} onClick={() => setAsking(v.id)}>{TURNO_LABELS[v.turno]} de {shortDate(v.date)} · {v.codigo_viagem}</MobBtn>)}
  </section>
}

function MobileStepper({ value, onDec, onInc, onInc5, onType, small, testid, label }) {
  return <div className={`mob-stepper${small ? ' sm' : ''}`}>
    <button type="button" aria-label={`Diminuir ${label}`} data-testid={`${testid}-minus`} onClick={onDec}><Minus size={small ? 16 : 20} /></button>
    {onType
      ? <input type="number" inputMode="numeric" min="0" aria-label={label} value={value} data-testid={`${testid}-input`} onChange={e => onType(e.target.value)} onFocus={e => e.target.select()} />
      : <span className="val" data-testid={`${testid}-value`}>{value}</span>}
    <button type="button" className="plus" aria-label={`Aumentar ${label}`} data-testid={`${testid}-plus`} onClick={onInc}><Plus size={small ? 16 : 22} /></button>
    {onInc5 && <button type="button" className="plus5" aria-label={`Aumentar ${label} em 5`} data-testid={`${testid}-plus5`} onClick={onInc5}>+5</button>}
  </div>
}

function MobileSignatureBox({ canvasRef, onSigned }) {
  const drawing = useRef(false), last = useRef([0, 0]);
  useEffect(() => {
    const c = canvasRef.current; if (!c) return undefined;
    const d = window.devicePixelRatio || 1;
    c.width = c.clientWidth * d; c.height = c.clientHeight * d; c.getContext('2d').scale(d, d);
    return () => onSigned(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pt = e => { const r = canvasRef.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e) { try { canvasRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ } drawing.current = true; last.current = pt(e); }
  function move(e) {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d'), p = pt(e);
    ctx.strokeStyle = '#10253f'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(last.current[0], last.current[1]); ctx.lineTo(p[0], p[1]); ctx.stroke(); last.current = p;
    onSigned(true);
  }
  function up() { drawing.current = false; }
  function clear() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onSigned(false); }
  return <div className="mob-field">
    <div className="mob-sign-head"><b className="mob-label">Assinatura do cliente</b><button type="button" className="mob-link" data-testid="signature-clear" onClick={clear}><Eraser size={16} />Limpar</button></div>
    <div className="mob-sign-box">
      <canvas ref={canvasRef} data-testid="signature-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <span className="mob-sign-guide" />
      <span className="mob-sign-hint">Assine com o dedo</span>
    </div>
  </div>
}

function buildLaunchLines(customer, stop) {
  const lines = brandListOf(customer).map(b => ({ brand: b.brand, priceExchange: Number(b.price) || 0, priceFull: b.price_full != null ? Number(b.price_full) || 0 : null, qtyExchange: 0, qtyFull: 0, mf: 0 }));
  const lineFor = brand => {
    let l = lines.find(x => sameName(x.brand, brand));
    if (!l) {
      // Produto fora do cadastro do cliente: o preço vem do que ficou gravado na rota (catálogo); sem ele, o entregador informa.
      const own = sameName(stop.brand, brand);
      l = { brand, priceExchange: own && stop.price != null ? Number(stop.price) || 0 : 0, priceFull: own && stop.price_full != null ? Number(stop.price_full) || 0 : null, qtyExchange: 0, qtyFull: 0, mf: 0, outOfCatalog: true, askPrice: !(own && stop.price != null), priceStr: '' };
      lines.push(l);
    }
    return l;
  };
  if (stop.brand) { const l = lineFor(stop.brand), q = Number(stop.quantity) || 0; if (stop.sale_type === 'full') l.qtyFull += q; else l.qtyExchange += q; }
  for (const s of (stop.mf_swaps || [])) if (s.merged && s.brand) lineFor(s.brand).qtyExchange += Number(s.quantity) || 0;
  return lines;
}

const LAUNCH_STEPS = ['Quantidade', 'Pagamento', 'Assinatura'];
const PAY_MODES = [['pix', 'Pix', QrCode], ['dinheiro', 'Dinheiro', Banknote], ['misto', 'Pix + dinheiro', Split], ['prazo', 'A prazo', Clock3]];
const MF_PLANS = [['reschedule', 'Entregar no próximo dia útil', CalendarClock], ['swap', 'Trocar agora no caminhão', RefreshCw], ['refused', 'Cliente não quis', CircleX]];

function MobileLaunchPanel({ stop, user, date, viagemId, cargaRestante, othersPending, onClose, onComplete, onFailed, onOpenViagens }) {
  const customer = stop.customer || { id: stop.id, name: stop.name, brands: [] };
  const draftKey = `hydro_draft_${stop.id || 'novo_' + (stop.name || 'cliente')}`;
  const draft = useMemo(() => { try { const d = JSON.parse(localStorage.getItem(draftKey)); return d?.v === 2 ? d : null; } catch { return null; } }, [draftKey]);

  const [step, setStep] = useState(1);
  const [lines, setLines] = useState(() => draft?.lines || buildLaunchLines(customer, stop));
  const [mfPlan, setMfPlan] = useState(draft?.mfPlan ?? null);
  const [payMode, setPayMode] = useState(draft?.payMode ?? (customer.payment_type === 'prazo' ? 'prazo' : null));
  const [pixStr, setPixStr] = useState(draft?.pixStr ?? '');
  const [compDays, setCompDays] = useState(draft?.compDays ?? 15);
  const [signerName, setSignerName] = useState(draft?.signerName ?? '');
  const [signed, setSigned] = useState(false);
  const [failAsk, setFailAsk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canvasRef = useRef(null);

  useEffect(() => {
    try { localStorage.setItem(draftKey, JSON.stringify({ v: 2, lines, mfPlan, payMode, pixStr, compDays, signerName })); } catch { /* ignore quota errors */ }
  }, [draftKey, lines, mfPlan, payMode, pixStr, compDays, signerName]);
  function clearDraft() { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }

  const fullPrice = l => l.priceFull != null ? l.priceFull : parseMoney(l.priceFullManual);
  // MF trocado na hora entrega um galão bom no lugar do defeituoso — o cliente paga por ele normalmente.
  const lineTotal = l => l.qtyExchange * l.priceExchange + l.qtyFull * fullPrice(l) + (mfPlan === 'swap' ? l.mf * l.priceExchange : 0);
  const total = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const qty = lines.reduce((s, l) => s + l.qtyExchange + l.qtyFull, 0);
  const totalMf = lines.reduce((s, l) => s + l.mf, 0);
  const pix = payMode === 'pix' ? total : payMode === 'misto' ? Math.min(total, round2(parseMoney(pixStr))) : 0;
  const cash = payMode === 'dinheiro' ? total : payMode === 'misto' ? round2(total - pix) : 0;
  const comp = payMode === 'prazo' ? total : 0;
  // A troca na hora gasta 2 unidades da carga por MF (a boa que fica e a com defeito que volta no caminhão) e a carga ainda precisa cobrir o resto da rota.
  const swapDisabled = cargaRestante != null && (qty + 2 * totalMf + (othersPending || 0)) > cargaRestante;
  useEffect(() => { if (swapDisabled) setMfPlan(prev => prev === 'swap' ? null : prev); }, [swapDisabled]);
  useEffect(() => { if (totalMf === 0) setMfPlan(null); }, [totalMf]);

  const mod = (i, fn) => setLines(prev => prev.map((l, j) => j === i ? fn(l) : l));
  const typed = raw => Math.max(0, parseInt(onlyDigits(raw), 10) || 0);
  const missingPrice = lines.some(l => ((l.qtyExchange > 0 || l.mf > 0) && l.askPrice && l.priceExchange <= 0) || (l.qtyFull > 0 && fullPrice(l) <= 0));

  const qtyLabel = `${galoes(qty)}${totalMf ? ` · ${totalMf} MF` : ''}`;
  const payShort = { pix: 'Pix', dinheiro: 'Dinheiro', misto: `Pix ${money(pix)} + Dinheiro ${money(cash)}`, prazo: `A prazo · ${compDays} dias` }[payMode] || '';
  const canNext = step === 1 ? ((qty > 0 || totalMf > 0) && (totalMf === 0 || !!mfPlan) && !missingPrice) : step === 2 ? !!payMode : (signed && !saving);
  const primaryLabel = step === 1
    ? (qty + totalMf === 0 ? 'Informe a quantidade' : totalMf > 0 && !mfPlan ? 'Decida sobre o MF' : missingPrice ? 'Informe o preço' : 'Continuar')
    : step === 2 ? (payMode ? 'Continuar' : 'Escolha o pagamento')
      : (saving ? 'Enviando...' : signed ? 'Concluir entrega' : 'Aguardando assinatura');

  async function complete() {
    setSaving(true); setError('');
    const items = [];
    for (const l of lines) {
      const extra = l.outOfCatalog ? { out_of_catalog: true } : {};
      if (l.qtyExchange > 0 || l.mf > 0) items.push({ brand: l.brand, price: l.priceExchange, sale_type: 'exchange', quantity: l.qtyExchange, mf_quantity: l.mf, ...extra });
      if (l.qtyFull > 0) items.push({ brand: l.brand, price: fullPrice(l), sale_type: 'full', quantity: l.qtyFull, ...extra });
    }
    const payload = {
      customer: stop.name, driver: user.name, date, items,
      pix_value: round2(pix), cash_value: round2(cash), comp_value: round2(comp), comp_days: comp > 0 ? compDays : undefined,
      mf_plan: totalMf > 0 ? mfPlan : undefined, mf_date: totalMf > 0 && mfPlan === 'reschedule' ? 'Próximo dia útil' : undefined,
      signature: canvasRef.current?.toDataURL('image/png'), signature_name: signerName.trim() || undefined,
      viagem_id: viagemId || undefined, rota_id: stop.rota_id || undefined,
    };
    try {
      const { data } = await api.post('/daily-entries', payload, auth());
      clearDraft();
      onComplete(data);
    } catch (e) { setError(apiError(e, 'Não foi possível concluir.')); setSaving(false); }
  }
  function primary() {
    if (!canNext) return;
    setError('');
    if (step < 3) return setStep(step + 1);
    complete();
  }
  async function confirmFail() {
    clearDraft();
    try { await api.patch(`/viagens/${viagemId}/rotas/${stop.rota_id}/clientes/${stop.id}`, { name: stop.name, status: 'nao_entregue' }, auth()); onFailed(); }
    catch (e) { setError(apiError(e, 'Não foi possível marcar como não entregue.')); setFailAsk(false); }
  }

  const swapQty = Number(stop.mf_swap_quantity) || 0;
  return <>
    <div className="mob-launch-head">
      <button type="button" className="mob-sq" aria-label={step === 1 ? 'Fechar' : 'Voltar'} data-testid="mob-panel-close" onClick={() => step === 1 ? onClose() : setStep(step - 1)}>{step === 1 ? <X size={20} /> : <ArrowLeft size={20} />}</button>
      <div><span className="mob-eyebrow">Rota {pad2(stop.rota_numero)} · Parada {pad2(stop.seq)}</span><b>{stop.name}</b></div>
    </div>
    <div className="mob-steps">{LAUNCH_STEPS.map((label, i) => <div key={label} className={i + 1 === step ? 'now' : i + 1 < step ? 'past' : ''} data-testid={`mob-step-${i + 1}`}>{i + 1} {label}</div>)}</div>

    <div className="mob-launch-scroll"><div className="mob-launch-col">
      {step === 1 && <>
        {swapQty > 0 && <div className="mob-swap-band" data-testid="mob-swap-band"><RefreshCw size={20} /><b>Troca de MF · levar {swapQty} galão(ões) bom(ns) e recolher o com defeito</b></div>}
        {stop.brand && <div className="mob-order-box" data-testid="mob-order-banner">
          <span className="mob-eyebrow">Pedido da rota</span>
          <b>{Number(stop.quantity) || 0} × {stop.brand} · {stop.sale_type === 'full' ? 'completo (vasilhame + água)' : 'somente água'}{stop.out_of_catalog ? ' · produto novo p/ cliente' : ''}</b>
          {stop.notes && <span>{stop.notes}</span>}
        </div>}
        {lines.length === 0 && <p className="mob-muted">Este cliente não tem produto no cadastro nem pedido na rota. Volte em Viagens do dia e escolha o produto da parada.</p>}
        {lines.map((l, i) => <section className="mob-brand-sec" key={l.brand} data-testid={`mob-line-${i}`}>
          <div className="mob-brand-top"><b>{l.brand}</b><b>{money(lineTotal(l))}</b></div>
          {l.askPrice && <label className="mob-field"><b className="mob-label">Preço combinado (R$ por galão)</b><input className="mob-input" inputMode="decimal" placeholder="0,00" value={l.priceStr || ''} data-testid={`mob-line-price-${i}`} onChange={e => mod(i, x => ({ ...x, priceStr: e.target.value, priceExchange: parseMoney(e.target.value) }))} onFocus={e => e.target.select()} /></label>}
          <div className="mob-qrow">
            <span><b>Somente água</b><small>{money(l.priceExchange)} / galão</small></span>
            <MobileStepper label="somente água" testid={`mob-qty-exchange-${i}`} value={l.qtyExchange} onType={v => mod(i, x => ({ ...x, qtyExchange: typed(v) }))} onDec={() => mod(i, x => ({ ...x, qtyExchange: Math.max(0, x.qtyExchange - 1) }))} onInc={() => mod(i, x => ({ ...x, qtyExchange: x.qtyExchange + 1 }))} onInc5={() => mod(i, x => ({ ...x, qtyExchange: x.qtyExchange + 5 }))} />
          </div>
          {(l.priceFull != null || l.qtyFull > 0) && <div className="mob-qrow">
            <span><b>Completo</b><small>{l.priceFull != null ? `${money(l.priceFull)} · vasilhame + água` : 'vasilhame + água · sem preço no cadastro'}</small></span>
            <MobileStepper label="completo" testid={`mob-qty-full-${i}`} value={l.qtyFull} onType={v => mod(i, x => ({ ...x, qtyFull: typed(v) }))} onDec={() => mod(i, x => ({ ...x, qtyFull: Math.max(0, x.qtyFull - 1) }))} onInc={() => mod(i, x => ({ ...x, qtyFull: x.qtyFull + 1 }))} onInc5={() => mod(i, x => ({ ...x, qtyFull: x.qtyFull + 5 }))} />
          </div>}
          {l.qtyFull > 0 && l.priceFull == null && <label className="mob-field"><b className="mob-label">Preço da venda completa</b><input className="mob-input" inputMode="decimal" placeholder="0,00" value={l.priceFullManual || ''} data-testid={`mob-sale-full-price-${i}`} onChange={e => mod(i, x => ({ ...x, priceFullManual: e.target.value }))} onFocus={e => e.target.select()} /></label>}
          <div className="mob-qrow mf">
            <span><b>Microfuro (MF)</b><small>Galão com defeito</small></span>
            <MobileStepper small label="MF" testid={`mob-mf-${i}`} value={l.mf} onDec={() => mod(i, x => x.mf > 0 ? { ...x, qtyExchange: x.qtyExchange + 1, mf: x.mf - 1 } : x)} onInc={() => mod(i, x => x.qtyExchange > 0 ? { ...x, qtyExchange: x.qtyExchange - 1, mf: x.mf + 1 } : x)} />
          </div>
        </section>)}
        {totalMf > 0 && <section className="mob-mf-ask" data-testid="mob-mf-decision">
          <b>{totalMf} galão{totalMf > 1 ? 'ões' : ''} com microfuro · o que foi decidido?</b>
          {MF_PLANS.map(([k, label, Icon]) => <button type="button" key={k} className={`mob-pick${mfPlan === k ? ' on' : ''}`} disabled={k === 'swap' && swapDisabled} data-testid={`mob-mf-${k}`} onClick={() => setMfPlan(k)}><Icon size={20} /><span>{label}</span></button>)}
          {swapDisabled && <span className="mob-muted" data-testid="mob-mf-no-spare">A carga desta viagem está certa para a rota e não tem sobra para trocar agora. A troca fica para o próximo dia útil ({shortDate(nextBusinessDay())}).</span>}
          {mfPlan === 'reschedule' && <span className="mob-muted" data-testid="mob-mf-reschedule-info">Fica como troca de MF pendente para incluir numa viagem a partir de {shortDate(nextBusinessDay())}.</span>}
        </section>}
        {failAsk
          ? <MobileConfirm testid="mob-fail-confirm" title="Marcar como não entregue?" text="Nada é descontado do estoque." confirmLabel="Não entreguei" onCancel={() => setFailAsk(false)} onConfirm={confirmFail} />
          : <button type="button" className="mob-link h48" data-testid="mob-fail-button" onClick={() => setFailAsk(true)}><CircleX size={18} />Não consegui entregar</button>}
      </>}

      {step === 2 && <>
        <section className="mob-total-hero">
          <span className="mob-eyebrow">Total a receber</span>
          <b data-testid="mob-launch-total">{money(total)}</b>
          <span className="mob-muted">{qtyLabel}</span>
        </section>
        <b className="mob-label">Como o cliente pagou?</b>
        <div className="mob-grid2">
          {PAY_MODES.map(([k, label, Icon]) => <button type="button" key={k} className={`mob-tile${payMode === k ? ' on' : ''}`} data-testid={`mob-pay-${k}`} onClick={() => setPayMode(k)}><Icon size={24} /><span>{label}</span></button>)}
        </div>
        {payMode === 'misto' && <>
          <div className="mob-grid2">
            <label className="mob-field"><b className="mob-label">Pix</b><input className="mob-input big" inputMode="decimal" placeholder="0,00" value={pixStr} data-testid="mob-pix-input" onChange={e => setPixStr(e.target.value)} onFocus={e => e.target.select()} /></label>
            <div className="mob-field"><b className="mob-label">Dinheiro (resto)</b><span className="mob-readonly" data-testid="mob-cash-rest">{money(cash)}</span></div>
          </div>
          <span className="mob-muted">Digite o Pix — o dinheiro completa sozinho.</span>
        </>}
        {payMode === 'prazo' && <div className="mob-field"><b className="mob-label">Prazo</b>
          <div className="mob-seg">{[15, 30].map(d => <button type="button" key={d} className={compDays === d ? 'on' : ''} data-testid={`mob-comp-${d}`} onClick={() => setCompDays(d)}>{d} dias</button>)}</div>
        </div>}
      </>}

      {step === 3 && <>
        <section className="mob-sum-row"><span className="mob-muted">{qtyLabel} · {payShort}</span><b>{money(total)}</b></section>
        <label className="mob-field"><b className="mob-label">Quem recebeu (opcional)</b><input className="mob-input" placeholder="Nome de quem assinou" value={signerName} data-testid="signature-name-input" onChange={e => setSignerName(e.target.value)} /></label>
        <MobileSignatureBox canvasRef={canvasRef} onSigned={setSigned} />
      </>}

      {error && <div className="mob-error" data-testid="mob-panel-error">{error}{error.includes('carga da viagem') && <button type="button" className="mob-link" data-testid="mob-panel-error-open-viagens" onClick={onOpenViagens}>Abrir Viagens do dia para ajustar</button>}</div>}
    </div></div>

    <div className="mob-launch-foot">
      <div className="mob-foot-total"><span className="mob-eyebrow">Total</span><b>{money(total)}</b></div>
      <MobBtn h={68} icon={ArrowRight} disabled={!canNext} data-testid={step === 3 ? 'signature-save' : 'mob-launch-next'} onClick={primary}>{primaryLabel}</MobBtn>
    </div>
  </>
}

function MobileRotaTab({ viagemAtiva, viagens, stops, entries, date, search, setSearch, mfPending, viagensPresas, onFinalizarPresa, dayClosed, onOpenStop, onOpenViagens, onStartTrip, onFinishTrip, offRoute, onPickOffRoute, onReceipt, onEditEntry, onDeleteEntry, onIncludeMf }) {
  const [finishAsk, setFinishAsk] = useState(false);
  const [openDone, setOpenDone] = useState(null);
  const [deleteAsk, setDeleteAsk] = useState(null);
  const q = search.trim().toLowerCase();
  const match = s => !q || s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q) || (s.customer?.code || '').toLowerCase().includes(q);
  const pending = stops.filter(s => s.status === 'pending');
  const finished = stops.filter(s => s.status !== 'pending');
  const done = stops.filter(s => s.status === 'done');
  const failed = stops.filter(s => s.status === 'failed');
  const received = entries.filter(e => e.date === date).reduce((a, e) => a + Number(e.pix_value || 0) + Number(e.cash_value || 0), 0);
  const tripTotal = done.reduce((a, s) => a + Number(s.entry?.total || 0), 0);
  const nextPlanned = viagens.find(v => v.status === 'planejada');
  const lastDone = [...viagens].reverse().find(v => v.status === 'finalizada');
  const mfTarget = viagemAtiva || nextPlanned;
  const carga = viagemAtiva?.carga_total, atual = viagemAtiva?.quantidade_atual || 0;
  const showNext = !!viagemAtiva && !q && pending.length > 0;
  const next = showNext ? pending[0] : null;
  const pendingRows = pending.filter(s => s !== next).filter(match);
  const doneRows = finished.filter(match);
  const orderSub = s => `${Number(s.quantity) || 0} × ${s.brand || 'produto a combinar'}${s.sale_type === 'full' ? ' completo' : ''}`;

  function askFinish() {
    if (carga && atual !== carga) return setFinishAsk(true);
    onFinishTrip(viagemAtiva);
  }
  const diff = (carga || 0) - atual;

  return <>
    <MobileStuckTrips viagens={viagensPresas} onFinalizar={onFinalizarPresa} />
    {dayClosed && <section className="mob-band" data-testid="mob-day-closed-summary"><Lock size={20} /><b>Dia fechado. Lançamentos bloqueados.</b></section>}

    {!viagemAtiva && !dayClosed && <section className="mob-poster" data-testid="mob-trip-banner">
      <span className="mob-eyebrow">{lastDone ? `Viagem ${lastDone.numero} concluída` : 'Nenhuma viagem em execução'}</span>
      <b>{nextPlanned ? `Viagem ${nextPlanned.numero} pronta para sair.` : lastDone ? 'Quer fazer outra viagem hoje?' : 'Crie a viagem para liberar os lançamentos.'}</b>
      {nextPlanned
        ? <MobBtn kind="white" lead={Truck} icon={ArrowRight} data-testid="mob-start-planned-button" onClick={() => onStartTrip(nextPlanned)}>Iniciar viagem {nextPlanned.numero} · {TURNO_LABELS[nextPlanned.turno]}</MobBtn>
        : <MobBtn kind="white" lead={Plus} icon={ArrowRight} data-testid="mob-new-delivery-button" onClick={() => onOpenViagens()}>Criar viagem</MobBtn>}
      {nextPlanned && <button type="button" className="mob-link on-accent" data-testid="mob-poster-open-viagens" onClick={() => onOpenViagens(nextPlanned.id)}>Ver rotas e clientes<ChevronRight size={16} /></button>}
    </section>}

    {viagemAtiva && <section className="mob-tripbar" data-testid="mob-trip-banner">
      <div className="mob-tripbar-top">
        <div><span className="mob-eyebrow red"><i />Viagem em execução</span><b>{TURNO_LABELS[viagemAtiva.turno]} · Viagem {viagemAtiva.numero} · {viagemAtiva.codigo_viagem}</b></div>
        <MobBtn kind="outline" h={44} icon={ChevronRight} data-testid="mob-open-viagens" onClick={() => onOpenViagens(viagemAtiva.id)}>Viagens</MobBtn>
      </div>
      <div className="mob-carga">
        {carga ? <div className="mob-bar"><div className={atual > carga ? 'over' : ''} style={{ width: `${Math.min(100, Math.round(atual / carga * 100))}%` }} /></div> : null}
        <span data-testid="mob-carga-label">Carga {carga ? `${atual}/${carga} un` : `${atual} un entregues`}</span>
      </div>
    </section>}

    {mfPending.length > 0 && <section className="mob-alert col" data-testid="mob-mf-reminder">
      <div className="mob-alert-head"><TriangleAlert size={20} /><b>Troca de MF pendente</b></div>
      {mfPending.map(m => <div className="mob-mfitem" key={m.id}>
        <span><b>{m.customer}</b><small>{m.quantity} un de {m.brand}{m.due_date ? ` · prevista ${shortDate(m.due_date)}` : ''}</small></span>
        {!dayClosed && <MobBtn kind="warn" h={48} lead={Plus} data-testid={`mob-mf-include-${m.id}`} onClick={() => onIncludeMf(m)}>{mfTarget ? `Incluir na viagem ${mfTarget.numero}` : 'Criar viagem para incluir'}</MobBtn>}
      </div>)}
    </section>}

    {viagemAtiva && stops.length > 0 && pending.length === 0 && <section className="mob-card" data-testid="mob-all-done">
      <div className="mob-card-body">
        <span className="mob-eyebrow red"><CircleCheck size={16} />Todas as rotas concluídas</span>
        <b className="mob-h24">{done.length} entrega{done.length === 1 ? '' : 's'} · {money(tripTotal)}</b>
        <span className="mob-muted">{failed.length > 0 ? `${failed.length} não entregue(s). ` : ''}Conclua para limpar a tela e devolver a sobra da carga.</span>
      </div>
      {finishAsk
        ? <MobileConfirm testid="mob-finish-confirm" title="Concluir mesmo assim?" text={diff > 0 ? `Faltam ${diff} unidade(s) para bater com a carga total (${atual}/${carga}).` : `Foram lançadas ${-diff} unidade(s) a mais que a carga total (${atual}/${carga}).`} confirmLabel="Concluir viagem" onCancel={() => setFinishAsk(false)} onConfirm={() => { setFinishAsk(false); onFinishTrip(viagemAtiva); }} />
        : <MobBtn h={64} lead={Flag} icon={ArrowRight} data-testid="mob-finish-trip" onClick={askFinish}>Concluir viagem</MobBtn>}
    </section>}

    {viagemAtiva && stops.length === 0 && <section className="mob-card plain" data-testid="mob-empty-trip">
      <div className="mob-card-body"><b className="mob-h20">Esta viagem ainda não tem clientes.</b><span className="mob-muted">Monte as rotas da viagem e adicione os clientes de cada uma.</span></div>
      <MobBtn lead={RouteIcon} icon={ArrowRight} data-testid="mob-build-routes" onClick={() => onOpenViagens(viagemAtiva.id)}>Montar rotas</MobBtn>
    </section>}

    {stops.length > 0 && <>
      <section className="mob-progress">
        <div><b>{finished.length} de {stops.length} paradas</b><b data-testid="mob-received-today">{money(received)}</b></div>
        <div className="mob-cells">{stops.map(s => <i key={s.key} className={s.status} />)}</div>
        <span className="mob-muted">Recebido hoje · Pix + dinheiro</span>
      </section>

      {next && <section className="mob-card" data-testid="mob-next-stop">
        <div className="mob-card-body">
          <span className="mob-eyebrow">Próxima parada · Rota {pad2(next.rota_numero)} · Nº {pad2(next.seq)}</span>
          {next.mf_swap_quantity > 0 && <span className="mob-tag swap big"><RefreshCw size={14} />Troca MF · {next.mf_swap_quantity} un</span>}
          <b className="mob-h26">{next.name}</b>
          {next.address && <span className="mob-muted">{next.address}</span>}
        </div>
        <div className="mob-next-grid">
          <div><span className="mob-eyebrow">Pedido</span><b>{Number(next.quantity) || 0} × {next.brand || 'a combinar'}</b></div>
          <div><span className="mob-eyebrow">Tipo</span><b>{next.sale_type === 'full' ? 'Completo' : 'Somente água'}</b></div>
        </div>
        {next.notes && <div className="mob-next-notes"><MessageSquareText size={18} /><span>{next.notes}</span></div>}
        <MobBtn h={64} icon={ArrowRight} data-testid={`mob-order-launch-${next.id}`} onClick={() => onOpenStop(next)}>Lançar entrega</MobBtn>
      </section>}
    </>}

    {viagemAtiva && <label className="mob-search"><Search size={20} /><input placeholder="Buscar cliente ou endereço" value={search} data-testid="mob-search-input" onChange={e => setSearch(e.target.value)} /></label>}

    {stops.length > 0 && <section className="mob-list" data-testid="mob-pending-orders">
      <div className="mob-sec-head"><b>Pendentes</b><b>{pending.length}</b></div>
      {pendingRows.map(s => <button type="button" className="mob-row" key={s.key} data-testid={`mob-customer-row-${s.id}`} onClick={() => onOpenStop(s)}>
        <span className="mob-num">{pad2(s.seq)}</span>
        <span className="mob-row-main"><b>{s.name}</b><small>Rota {pad2(s.rota_numero)} · {orderSub(s)}</small></span>
        {s.mf_swap_quantity > 0 && <span className="mob-tag swap"><RefreshCw size={12} />TROCA MF</span>}
        {s.prazo && <span className="mob-tag warn">a prazo</span>}
        <ChevronRight size={22} />
      </button>)}
      {pendingRows.length === 0 && <p className="mob-muted pad">{pending.length === 0 ? 'Nenhuma parada pendente.' : q ? 'Nenhuma parada pendente com esse nome.' : 'A próxima parada está no cartão acima.'}</p>}
    </section>}

    {q && offRoute.length > 0 && <section className="mob-list" data-testid="mob-off-route">
      <div className="mob-sec-head"><b>Fora da rota · cadastro</b><b>{offRoute.length}</b></div>
      {offRoute.slice(0, 8).map(c => <button type="button" className="mob-row sm" key={c.id} data-testid={`mob-picker-row-${c.id}`} onClick={() => onPickOffRoute(c)}>
        <span className="mob-row-main"><b>{c.name}</b><small>{brandListOf(c).map(b => b.brand).join(', ') || 'sem marca cadastrada'}{c.address ? ` · ${c.address}` : ''}</small></span>
        <Plus size={20} />
      </button>)}
    </section>}

    {doneRows.length > 0 && <section className="mob-list" data-testid="mob-finished">
      <div className="mob-sec-head"><b>Finalizadas</b><b>{finished.length}</b></div>
      {doneRows.map(s => {
        const isFailed = s.status === 'failed', open = openDone === s.key;
        return <div key={s.key} className="mob-done">
          <button type="button" className="mob-row sm" data-testid={`mob-done-row-${s.id}`} onClick={() => isFailed ? onOpenStop(s) : setOpenDone(open ? null : s.key)}>
            <span className={`mob-badge${isFailed ? ' off' : ''}`}>{isFailed ? <X size={18} /> : <Check size={18} />}</span>
            <span className="mob-row-main"><b>{s.name}</b><small>{isFailed ? 'Não entregue · toque para tentar de novo' : `${entryItemsLabel(s.entry)} · ${entryPayLabel(s.entry)}`}</small></span>
            <b>{isFailed ? '—' : money(s.entry.total)}</b>
          </button>
          {open && !isFailed && (deleteAsk === s.key
            ? <MobileConfirm testid="mob-entry-delete-confirm" title={`Excluir a entrega de ${s.name}?`} text={`${money(s.entry.total)} · o estoque e a carga são estornados.`} confirmLabel="Excluir" onCancel={() => setDeleteAsk(null)} onConfirm={() => { setDeleteAsk(null); setOpenDone(null); onDeleteEntry(s.entry); }} />
            : <div className="mob-done-actions">
              <MobBtn kind="outline" h={48} lead={MessageCircle} data-testid={`mob-entry-receipt-${s.entry.id}`} onClick={() => onReceipt(s.entry)}>Comprovante</MobBtn>
              {!dayClosed && <MobBtn kind="outline" h={48} lead={Pencil} data-testid={`mob-viagem-entrega-editar-${s.entry.id}`} onClick={() => onEditEntry(s.entry)}>Revisar</MobBtn>}
              {!dayClosed && <MobBtn kind="outline" h={48} lead={Trash2} data-testid={`mob-viagem-entrega-excluir-${s.entry.id}`} onClick={() => setDeleteAsk(s.key)}>Excluir</MobBtn>}
            </div>)}
        </div>
      })}
    </section>}
  </>
}

function MobileEditEntregaModal({ entry, onClose, onSaved }) {
  const baseItems = (entry.items?.length ? entry.items : [{ brand: entry.brand, price: entry.price, sale_type: 'exchange', quantity: entry.billed_quantity ?? entry.quantity, mf_quantity: entry.mf_quantity }]);
  const [lines, setLines] = useState(baseItems.map(it => ({ ...it, quantity: Number(it.quantity) || 0, mf_quantity: Number(it.mf_quantity) || 0 })));
  const [pix, setPix] = useState(Number(entry.pix_value) || 0);
  const [cash, setCash] = useState(Number(entry.cash_value) || 0);
  const [mfPlan, setMfPlan] = useState(entry.mf_plan || null);
  const [mfDate, setMfDate] = useState(entry.mf_date || 'Amanhã');
  const [signing, setSigning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const compValue = Number(entry.comp_value) || 0;
  const total = lines.reduce((s, l) => s + l.quantity * l.price + (mfPlan === 'swap' ? l.mf_quantity * l.price : 0), 0);
  const remaining = Math.max(0, Math.round((total - compValue) * 100) / 100);
  const totalMf = lines.reduce((s, l) => s + l.mf_quantity, 0);

  function incQty(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, quantity: l.quantity + 1 } : l)); }
  function decQty(i) { setLines(prev => prev.map((l, idx) => idx === i ? { ...l, quantity: Math.max(0, l.quantity - 1) } : l)); }
  function setQty(i, raw) { const v = Math.max(0, parseInt(raw, 10) || 0); setLines(prev => prev.map((l, idx) => idx === i ? { ...l, quantity: v } : l)); }
  function incMf(i) { setLines(prev => prev.map((l, idx) => idx === i && l.quantity > 0 ? { ...l, quantity: l.quantity - 1, mf_quantity: l.mf_quantity + 1 } : l)); }
  function decMf(i) { setLines(prev => prev.map((l, idx) => idx === i && l.mf_quantity > 0 ? { ...l, quantity: l.quantity + 1, mf_quantity: l.mf_quantity - 1 } : l)); }

  function setPixVal(raw) { const v = Math.min(Math.max(0, Number(raw) || 0), remaining); setPix(v); setCash(Math.round((remaining - v) * 100) / 100); }
  function setCashVal(raw) { const v = Math.min(Math.max(0, Number(raw) || 0), remaining); setCash(v); setPix(Math.round((remaining - v) * 100) / 100); }
  function allPix() { setPix(remaining); setCash(0); }
  function allCash() { setCash(remaining); setPix(0); }

  function goToSign() {
    setError('');
    if (Math.abs((pix + cash + compValue) - total) > 0.01) return setError('Pix + Dinheiro precisa completar o total.');
    if (totalMf > 0 && !mfPlan) return setError('Diga o que foi decidido sobre o(s) galão(ões) com microfuro.');
    setSigning(true);
  }

  async function submit(signature, signatureName) {
    setSaving(true);
    try {
      await api.patch(`/daily-entries/${entry.id}`, {
        items: lines.map(l => ({ brand: l.brand, price: l.price, sale_type: l.sale_type, quantity: l.quantity, mf_quantity: l.mf_quantity, out_of_catalog: l.out_of_catalog })),
        pix_value: Math.round(pix * 100) / 100, cash_value: Math.round(cash * 100) / 100,
        mf_plan: totalMf > 0 ? mfPlan : undefined, mf_date: totalMf > 0 && mfPlan === 'reschedule' ? mfDate : undefined,
        signature, signature_name: signatureName || undefined,
      }, auth());
      onSaved();
    } catch (e) { setError(e.response?.data?.detail || 'Não foi possível salvar a revisão.'); setSaving(false); setSigning(false); }
  }

  if (signing) return <SignaturePad variant="mobile" customer={entry.customer} total={total} onSave={submit} onCancel={() => setSigning(false)} />;

  return <div className="mob-backdrop" onClick={onClose}>
    <div className="mob-sheet mob-sheet-tall" onClick={e => e.stopPropagation()}>
      <div className="mob-sheet-handle" />
      <div className="mob-sheet-head">
        <div><h3>Revisar entrega</h3><p>{entry.customer}{entry.entry_number ? ` · Nº ${entry.entry_number}` : ''}</p></div>
        <button aria-label="Fechar" type="button" className="mob-close" data-testid="mob-edit-entrega-close" onClick={onClose}><X size={18} /></button>
      </div>

      {lines.map((l, i) => <div className="mob-line active" key={i} data-testid={`mob-edit-line-${i}`}>
        <div className="mob-line-top">
          <div className="mob-line-info"><b>{l.brand}{l.sale_type === 'full' && <span className="mob-tag" style={{ marginLeft: 6 }}>venda completa</span>}</b><small>R$ {Number(l.price).toFixed(2)} por galão</small><span className="mob-line-subtotal">{money(l.quantity * l.price + (mfPlan === 'swap' ? l.mf_quantity * l.price : 0))}</span></div>
          <div className="mob-counter">
            <button aria-label="Diminuir quantidade" type="button" data-testid={`mob-edit-qty-minus-${i}`} onClick={() => decQty(i)}><Minus size={18} /></button>
            <input type="number" inputMode="numeric" min="0" value={l.quantity} data-testid={`mob-edit-qty-input-${i}`} onChange={e => setQty(i, e.target.value)} onFocus={e => e.target.select()} />
            <button aria-label="Aumentar quantidade" type="button" className="fill" data-testid={`mob-edit-qty-plus-${i}`} onClick={() => incQty(i)}><Plus size={20} /></button>
          </div>
        </div>
        <div className="mob-line-mf">
          <span>MF · microfuro</span>
          <div className="mob-counter small">
            <button aria-label="Diminuir motivo/falta" type="button" data-testid={`mob-edit-mf-minus-${i}`} onClick={() => decMf(i)}><Minus size={14} /></button>
            <span>{l.mf_quantity}</span>
            <button aria-label="Aumentar motivo/falta" type="button" className="mf" data-testid={`mob-edit-mf-plus-${i}`} onClick={() => incMf(i)}><Plus size={16} /></button>
          </div>
        </div>
      </div>)}

      <div className="mob-total-row"><span>TOTAL A RECEBER</span><b>{money(total)}</b></div>
      {compValue > 0 && <p className="mob-help">Inclui {money(compValue)} já lançado a prazo — Pix + Dinheiro precisam completar {money(remaining)}.</p>}

      <div className="mob-split-shortcuts">
        <button type="button" data-testid="mob-edit-all-pix" onClick={allPix}>Tudo Pix</button>
        <button type="button" data-testid="mob-edit-all-cash" onClick={allCash}>Tudo dinheiro</button>
      </div>
      <div className="mob-pix-cash">
        <label className="mob-pix"><span>Pix</span><input type="number" step="0.01" value={pix || ''} data-testid="mob-edit-pix-input" onChange={e => setPixVal(e.target.value)} /></label>
        <label className="mob-cash"><span>Dinheiro</span><input type="number" step="0.01" value={cash || ''} data-testid="mob-edit-cash-input" onChange={e => setCashVal(e.target.value)} /></label>
      </div>

      {totalMf > 0 && <div className="mob-mf-decision" data-testid="mob-edit-mf-decision">
        <b>{totalMf} galão{totalMf > 1 ? 'ões' : ''} com microfuro</b>
        <p>O que foi decidido sobre esses galões?</p>
        <div className="mob-mf-options">
          <button type="button" className={mfPlan === 'reschedule' ? 'active' : ''} data-testid="mob-edit-mf-reschedule" onClick={() => setMfPlan('reschedule')}><Truck size={22} /> Entregar outro dia</button>
          <button type="button" className={mfPlan === 'swap' ? 'active' : ''} data-testid="mob-edit-mf-swap" onClick={() => setMfPlan('swap')}><Check size={22} /> Trocar agora no caminhão</button>
          <button type="button" className={mfPlan === 'refused' ? 'active' : ''} data-testid="mob-edit-mf-refused" onClick={() => setMfPlan('refused')}><XCircle size={22} /> Cliente não quis</button>
        </div>
        {mfPlan === 'reschedule' && <div className="mob-days-toggle">
          {['Amanhã', 'Em 2 dias', 'Próxima rota'].map(d => <button type="button" key={d} className={mfDate === d ? 'active' : ''} data-testid={`mob-edit-mf-date-${d}`} onClick={() => setMfDate(d)}>{d}</button>)}
        </div>}
      </div>}

      {error && <div className="error" data-testid="mob-edit-entrega-error">{error}</div>}
      <button type="button" className="mob-cta" disabled={saving} data-testid="mob-edit-entrega-save" onClick={goToSign}>Assinar e salvar revisão</button>
    </div>
  </div>
}

function MobileReceiptPrompt({ entry, customer, onSavePhone, onClose }) {
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
      <div className="mob-sheet-head">
        <div><h3>Comprovante da entrega</h3><p>{entry.customer}{entry.entry_number ? ` · Nº ${entry.entry_number}` : ''} · {money(entry.total)}</p></div>
        <button aria-label="Fechar" type="button" className="mob-close" data-testid="mob-receipt-close" onClick={onClose}><X size={18} /></button>
      </div>
      <p className="muted" style={{ padding: '0 2px 12px' }}>O cliente quer o comprovante de entrega?</p>
      {!customer?.phone && !sent && <label className="mob-field-md">Telefone do cliente (WhatsApp, opcional)<input value={phone} placeholder="ex: 5592999999999" data-testid="mob-receipt-phone" onChange={e => setPhone(e.target.value)} /></label>}
      <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
        <button type="button" className="mob-outline-btn" data-testid="mob-receipt-skip" onClick={onClose}>Não precisa</button>
        <button type="button" className="mob-outline-btn" data-testid="mob-receipt-download" onClick={() => downloadReceiptPdf(entry)}>Baixar PDF</button>
      </div>
      <button type="button" className="mob-cta" disabled={busy} data-testid="mob-receipt-send" onClick={handleShare}>{sent ? 'Enviado' : 'Enviar no WhatsApp'}</button>
    </div>
  </div>
}

function MobileClientQty({ value, onCommit, testid }) {
  const [draft, setDraft] = useState(String(value ?? ''));
  useEffect(() => { setDraft(String(value ?? '')); }, [value]);
  function commit() {
    if (draft === '') return setDraft(String(value ?? ''));
    if (Number(draft) !== Number(value || 0)) onCommit(Number(draft));
  }
  return <input className="mob-qty-input" type="number" inputMode="numeric" min="0" aria-label="Quantidade" value={draft} data-testid={testid} onChange={e => setDraft(onlyDigits(e.target.value, 3))} onFocus={e => e.target.select()} onBlur={commit} />
}

function MobileProductConfig({ customer, rotaNumero, brandsCatalog, busy, onCancel, onConfirm }) {
  const prefs = brandListOf(customer);
  const others = brandsCatalog.filter(b => !prefs.some(p => sameName(p.brand, b.name)));
  const [brand, setBrand] = useState(prefs[0]?.brand || '');
  const [showOther, setShowOther] = useState(prefs.length === 0);
  const [qty, setQty] = useState('');
  const [full, setFull] = useState(false);
  const pref = prefs.find(p => sameName(p.brand, brand));
  const cat = others.find(b => sameName(b.name, brand));
  const sel = pref || cat;
  const hasFull = !!sel && sel.price_full != null && Number(sel.price_full) > 0;
  const priceLabel = b => b.price != null ? `${money(b.price)} somente água${b.price_full ? ` · ${money(b.price_full)} completo` : ''}` : 'preço informado na entrega';
  const pick = name => { setBrand(name); const s = prefs.find(p => sameName(p.brand, name)) || others.find(b => sameName(b.name, name)); if (!(s && Number(s.price_full) > 0)) setFull(false); };
  const n = Number(qty) || 1;
  function confirm() {
    if (!brand) return;
    onConfirm({ id: customer.id, name: customer.name, brand, quantity: n, sale_type: full && hasFull ? 'full' : 'exchange', out_of_catalog: !pref, price: sel?.price ?? undefined, price_full: sel?.price_full ?? undefined });
  }
  return <div className="mob-config" data-testid="mob-viagem-client-config">
    <div className="mob-config-head">
      <span><span className="mob-eyebrow">Adicionar à Rota {pad2(rotaNumero)}</span><b>{customer.name}</b></span>
      <button type="button" className="mob-link dark" data-testid="mob-viagem-client-cancel" onClick={onCancel}>Cancelar</button>
    </div>
    <div className="mob-field">
      <b className="mob-label">Produto</b>
      {prefs.map(p => <button type="button" key={p.brand} className={`mob-prod${sameName(brand, p.brand) ? ' on' : ''}`} data-testid={`mob-viagem-client-brand-${p.brand}`} onClick={() => pick(p.brand)}><span><b>{p.brand}</b><small>{priceLabel(p)}</small></span><span className="mob-tag warn">Preferência</span></button>)}
      {prefs.length === 0 && <span className="mob-muted">Cliente sem produto no cadastro — escolha no catálogo.</span>}
      {others.length > 0 && <button type="button" className="mob-link h48" data-testid="mob-viagem-client-brand-toggle" onClick={() => setShowOther(!showOther)}><RefreshCw size={16} />{showOther ? 'Ocultar outros produtos' : 'Outro produto do cadastro'}</button>}
      {showOther && others.map(b => <button type="button" key={b.id || b.name} className={`mob-prod${sameName(brand, b.name) ? ' on' : ''}`} data-testid={`mob-viagem-client-catalog-${b.name}`} onClick={() => pick(b.name)}><span><b>{b.name}</b><small>{priceLabel(b)}</small></span><span className="mob-tag neutral">Novo p/ cliente</span></button>)}
    </div>
    <div className="mob-config-row">
      <label className="mob-field"><b className="mob-label">Qtd</b><input className="mob-qty-input lg" type="number" inputMode="numeric" min="1" placeholder="1" value={qty} data-testid="mob-viagem-client-qty" onChange={e => setQty(onlyDigits(e.target.value, 3))} onFocus={e => e.target.select()} /></label>
      <div className="mob-field"><b className="mob-label">Tipo</b>
        <div className="mob-seg">
          <button type="button" className={!full ? 'on' : ''} data-testid="mob-viagem-client-exchange" onClick={() => setFull(false)}>Somente água</button>
          {hasFull && <button type="button" className={full ? 'on' : ''} data-testid="mob-viagem-client-full" onClick={() => setFull(true)}>Completo</button>}
        </div>
      </div>
    </div>
    <MobBtn h={56} icon={Check} disabled={!brand || busy} data-testid="mob-viagem-client-confirm" onClick={confirm}>{brand ? `Adicionar ${n} × ${brand}` : 'Escolha o produto'}</MobBtn>
  </div>
}

function MobileViagensScreen({ viagens, customers, entries, mfPending, dayClosed, viagemAtiva, openTripId, setOpenTripId, onBack, onCreate, onIniciar, onFinalizar, onDelete, onAddRota, onAddRotaCliente, onUpdateRotaCliente, onRemoveRotaCliente, onRemoveRota, onScheduleMf, toast }) {
  const [turno, setTurno] = useState(new Date().getHours() < 12 ? 0 : 1);
  const [carga, setCarga] = useState(0);
  const [cargaItems, setCargaItems] = useState([]);
  const [showMore, setShowMore] = useState(false);
  const [newCargaBrand, setNewCargaBrand] = useState('');
  const [newCargaQty, setNewCargaQty] = useState('');
  const [brandsCatalog, setBrandsCatalog] = useState([]);
  const [picker, setPicker] = useState(null);
  const [pickQ, setPickQ] = useState('');
  const [config, setConfig] = useState(null);
  const [asking, setAsking] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/brands', auth()).then(({ data }) => setBrandsCatalog(data.filter(b => b.active !== false))).catch(() => { }); }, []);

  async function run(fn, fallback) {
    setBusy(true);
    try { return await fn(); }
    catch (e) { toast(apiError(e, fallback), 6000); return undefined; }
    finally { setBusy(false); }
  }

  const turnoFull = viagens.filter(v => v.turno === turno).length >= VIAGENS_POR_TURNO;
  const cargaItemsTotal = cargaItems.reduce((s, i) => s + i.quantity, 0);
  function addCargaItem() {
    if (!newCargaBrand || !(Number(newCargaQty) > 0)) return;
    setCargaItems(prev => [...prev.filter(i => i.brand !== newCargaBrand), { brand: newCargaBrand, quantity: Number(newCargaQty) }]);
    setNewCargaBrand(''); setNewCargaQty('');
  }
  function openPicker(viagemId, rotaId) { setPicker({ viagemId, rotaId }); setPickQ(''); setConfig(null); }

  async function create() {
    if (turnoFull) return toast('Limite de 6 viagens neste turno.');
    await run(async () => {
      let v = await onCreate({ turno, create_first_rota: true, carga_total: cargaItems.length ? undefined : (Number(carga) || undefined), carga_items: cargaItems.length ? cargaItems : undefined });
      if (!v.rotas?.length) v = await onAddRota(v.id, { clientes: [] });
      setCargaItems([]); setShowMore(false);
      setOpenTripId(v.id); openPicker(v.id, v.rotas[v.rotas.length - 1].id);
      toast('Viagem criada. Adicione os clientes da Rota 01 e toque em Iniciar.', 4000);
    }, 'Não foi possível criar a viagem.');
  }
  async function addRota(v) {
    await run(async () => { const updated = await onAddRota(v.id, { clientes: [] }); openPicker(v.id, updated.rotas[updated.rotas.length - 1].id); }, 'Não foi possível criar a rota.');
  }
  async function addCliente(v, rota, cliente) {
    await run(async () => { await onAddRotaCliente(v.id, rota.id, cliente); setConfig(null); setPickQ(''); toast(`${cliente.name} adicionado à Rota ${pad2(rota.numero)}.`); }, 'Não foi possível adicionar o cliente.');
  }
  async function scheduleMf(v, m, hit) {
    await run(async () => {
      let rota = hit?.rota || (v.rotas || [])[(v.rotas || []).length - 1];
      if (!rota) { const updated = await onAddRota(v.id, { clientes: [] }); rota = updated.rotas[updated.rotas.length - 1]; }
      await onScheduleMf(v.id, rota.id, m.id);
      toast(`Troca de MF de ${m.customer} adicionada à viagem.`);
    }, 'Não foi possível incluir a troca de MF.');
  }

  const statusOf = (v, c) => entries.some(e => e.viagem_id === v.id && sameName(e.customer, c.name)) ? 'done' : c.status === 'nao_entregue' ? 'failed' : 'pending';
  const pq = pickQ.trim().toLowerCase();

  return <>
    <button type="button" className="mob-link dark h44" data-testid="mob-viagens-close" onClick={onBack}><ArrowLeft size={18} />Voltar para a rota</button>

    {dayClosed
      ? <section className="mob-band" data-testid="mob-day-closed-banner"><Lock size={20} /><b>Dia fechado — viagens somente para consulta.</b></section>
      : <section className="mob-card" data-testid="mob-viagem-form">
        <div className="mob-card-head"><b>Criar viagem</b></div>
        <div className="mob-card-body gap14">
          <div className="mob-field"><b className="mob-label">Turno</b>
            <div className="mob-seg" data-testid="mob-viagem-turno">{[0, 1].map(t => <button type="button" key={t} className={turno === t ? 'on' : ''} data-testid={`mob-viagem-turno-${t}`} onClick={() => setTurno(t)}>{TURNO_LABELS[t]}</button>)}</div>
          </div>
          {cargaItems.length === 0 && <div className="mob-qrow wrap">
            <span><b>Carga por viagem</b><small>Galões no caminhão · digite ou use − +</small></span>
            <MobileStepper label="carga" testid="mob-viagem-carga" value={carga} onType={v => { const d = onlyDigits(v); setCarga(d === '' ? '' : Number(d)); }} onDec={() => setCarga(Math.max(0, (Number(carga) || 0) - 5))} onInc={() => setCarga((Number(carga) || 0) + 5)} />
          </div>}
          <button type="button" className="mob-link h44" data-testid="mob-viagem-more" onClick={() => setShowMore(!showMore)}>{showMore ? <ChevronUp size={18} /> : <ChevronDown size={18} />}Carga por produto (opcional){cargaItems.length > 0 ? ` · total ${cargaItemsTotal} un` : ''}</button>
          {showMore && <div className="mob-field">
            <span className="mob-muted">Se preencher, o sistema desconta do estoque ao iniciar e devolve a sobra ao concluir a viagem.</span>
            <div className="mob-carga-add">
              <select className="mob-input" value={newCargaBrand} data-testid="mob-viagem-carga-brand" onChange={e => setNewCargaBrand(e.target.value)}>
                <option value="">Produto</option>
                {brandsCatalog.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
              </select>
              <input className="mob-input" type="number" inputMode="numeric" placeholder="Qtd" value={newCargaQty} data-testid="mob-viagem-carga-qty" onChange={e => setNewCargaQty(onlyDigits(e.target.value))} />
              <button type="button" className="mob-sq ink" aria-label="Adicionar produto à carga" data-testid="mob-viagem-carga-add" onClick={addCargaItem}><Plus size={20} /></button>
            </div>
            {cargaItems.length > 0 && <div className="mob-chips">{cargaItems.map(i => <span className="mob-chip" key={i.brand} data-testid={`mob-viagem-carga-chip-${i.brand}`}>{i.brand} · {i.quantity}<button type="button" aria-label="Remover item da carga" onClick={() => setCargaItems(prev => prev.filter(x => x.brand !== i.brand))}><X size={14} /></button></span>)}</div>}
          </div>}
        </div>
        <MobBtn h={64} lead={RouteIcon} icon={ArrowRight} disabled={turnoFull || busy} data-testid="mob-viagem-create" onClick={create}>{turnoFull ? 'Limite de 6 viagens no turno' : 'Criar viagem e montar rotas'}</MobBtn>
      </section>}

    <section className="mob-list">
      <div className="mob-sec-head"><b>Viagens de hoje</b><b>{viagens.length}/{VIAGENS_POR_DIA}</b></div>
      {viagens.length === 0 && <p className="mob-muted pad">Nenhuma viagem criada hoje.</p>}
      {viagens.map(v => {
        const rotas = v.rotas || [];
        const allClients = rotas.flatMap(r => (r.clientes || []).map(c => ({ ...c, rota: r, st: statusOf(v, c) })));
        const editable = v.status !== 'finalizada' && !dayClosed;
        const isOpen = openTripId === v.id;
        const inTrip = new Set(allClients.map(c => c.id));
        const pendingCount = allClients.filter(c => c.st === 'pending').length;
        const atual = v.quantidade_atual || 0;
        return <div className="mob-trip" key={v.id} data-testid={`mob-viagem-${v.id}`}>
          <div className="mob-trip-head">
            <span className={`mob-badge lg ${v.status}`}>{pad2(v.numero)}</span>
            <span className="mob-row-main"><b>{TURNO_LABELS[v.turno]} · Viagem {v.numero}</b><small>{v.codigo_viagem} · {v.status === 'finalizada' ? `${v.entregas || 0} entrega${v.entregas === 1 ? '' : 's'} · ${money(v.saldo_liquido ?? v.total_bruto)}` : v.carga_total ? `carga ${v.carga_total} un` : 'sem carga definida'}</small></span>
            <span className={`mob-tag ${v.status === 'execucao' ? 'warn' : 'neutral'}`}>{{ planejada: 'Planejada', execucao: 'Em execução', finalizada: 'Concluída' }[v.status]}</span>
          </div>

          {v.status === 'planejada' && !dayClosed && (asking === `del:${v.id}`
            ? <MobileConfirm testid="mob-viagem-excluir-confirm" title={`Excluir a viagem ${v.codigo_viagem}?`} text={allClients.length ? `${allClients.length} cliente(s) saem das rotas.` : undefined} confirmLabel="Excluir" busy={busy} onCancel={() => setAsking(null)} onConfirm={() => run(async () => { await onDelete(v); setAsking(null); }, 'Não foi possível excluir a viagem.')} />
            : <div className="mob-grid21">
              <MobBtn h={52} icon={Play} kind={viagemAtiva ? 'disabled' : 'primary'} data-testid={`mob-viagem-iniciar-${v.id}`} onClick={() => viagemAtiva ? toast('Conclua a viagem em execução primeiro.') : run(() => onIniciar(v), 'Não foi possível iniciar a viagem.')}>{viagemAtiva ? 'Aguardando' : 'Iniciar'}</MobBtn>
              <MobBtn h={52} kind="outline" data-testid={`mob-viagem-excluir-${v.id}`} onClick={() => setAsking(`del:${v.id}`)}>Excluir</MobBtn>
            </div>)}

          {v.status === 'execucao' && (asking === `fin:${v.id}`
            ? <MobileConfirm testid="mob-viagem-finalizar-confirm" title="Concluir a viagem agora?" text={`${pendingCount > 0 ? `${pendingCount} parada(s) ainda pendente(s). ` : ''}${v.carga_total && atual !== v.carga_total ? `Carga ${atual}/${v.carga_total} un. ` : ''}A sobra da carga volta para o estoque.`} confirmLabel="Concluir viagem" busy={busy} onCancel={() => setAsking(null)} onConfirm={() => run(async () => { await onFinalizar(v); setAsking(null); }, 'Não foi possível concluir a viagem.')} />
            : <div className="mob-grid2">
              <MobBtn h={52} kind="outline" icon={ArrowRight} data-testid={`mob-viagem-abrir-rota-${v.id}`} onClick={onBack}>Abrir rota</MobBtn>
              <MobBtn h={52} kind="outline" icon={Flag} data-testid={`mob-viagem-finalizar-${v.id}`} onClick={() => setAsking(`fin:${v.id}`)}>Concluir</MobBtn>
            </div>)}

          <button type="button" className="mob-link h44" data-testid={`mob-viagem-toggle-${v.id}`} onClick={() => { setOpenTripId(isOpen ? null : v.id); setPicker(null); setConfig(null); }}>{isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}{isOpen ? 'Ocultar' : 'Ver'} rotas e clientes ({rotas.length} rota{rotas.length === 1 ? '' : 's'} · {allClients.length} cliente{allClients.length === 1 ? '' : 's'})</button>

          {isOpen && <div className="mob-editor" data-testid={`mob-viagem-editor-${v.id}`}>
            {editable && mfPending.length > 0 && <div className="mob-mfblock" data-testid="mob-viagem-mf-pendentes">
              <div className="mob-mfblock-head"><TriangleAlert size={18} /><b>Trocas de MF pendentes</b></div>
              {mfPending.map(m => {
                const hit = allClients.find(c => sameName(c.name, m.customer) && c.st === 'pending');
                const last = rotas[rotas.length - 1];
                return <div className="mob-mfitem" key={m.id}>
                  <span><b>{m.customer}</b><small>{m.quantity} × {m.brand}{m.entry_number ? ` · da entrega Nº ${m.entry_number}` : ''}{m.due_date ? ` · prevista ${shortDate(m.due_date)}` : ''}</small></span>
                  <MobBtn kind="warn" h={48} lead={Plus} disabled={busy} data-testid={`mob-mf-add-${m.id}`} onClick={() => scheduleMf(v, m, hit)}>{hit ? `Somar ao pedido (Rota ${pad2(hit.rota.numero)})` : `Adicionar à Rota ${pad2(last?.numero || 1)}`}</MobBtn>
                </div>
              })}
            </div>}

            {rotas.map(r => {
              const cl = allClients.filter(c => c.rota.id === r.id);
              const picking = picker?.viagemId === v.id && picker?.rotaId === r.id;
              const cfg = config?.viagemId === v.id && config?.rotaId === r.id ? config : null;
              const canRemove = editable && cl.every(c => c.st === 'pending');
              const pickRows = picking && !cfg ? customers.filter(c => !inTrip.has(c.id) && (!pq || c.name.toLowerCase().includes(pq) || (c.code || '').toLowerCase().includes(pq) || (c.address || '').toLowerCase().includes(pq))).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR')).slice(0, 20) : [];
              return <div className="mob-rota" key={r.id} data-testid={`mob-viagem-rota-${r.id}`}>
                <div className="mob-rota-head">
                  <span className="mob-row-main"><b>Rota {pad2(r.numero)}</b><small>{cl.length} cliente{cl.length === 1 ? '' : 's'} · {cl.reduce((a, c) => a + clienteLoad(c), 0)} un</small></span>
                  {canRemove && <button type="button" className="mob-sq" aria-label="Excluir rota" data-testid={`mob-viagem-rota-excluir-${r.id}`} onClick={() => cl.length ? setAsking(`rota:${r.id}`) : run(() => onRemoveRota(v.id, r.id), 'Não foi possível excluir a rota.')}><Trash2 size={18} /></button>}
                </div>
                {asking === `rota:${r.id}` && <MobileConfirm testid="mob-viagem-rota-excluir-confirm" title={`Excluir a Rota ${pad2(r.numero)}?`} text={`${cl.length} cliente(s) saem da viagem.`} confirmLabel="Excluir rota" busy={busy} onCancel={() => setAsking(null)} onConfirm={() => run(async () => { await onRemoveRota(v.id, r.id); setAsking(null); }, 'Não foi possível excluir a rota.')} />}
                {cl.map(c => <div className="mob-client" key={c.id} data-testid={`mob-viagem-rota-cliente-${c.id}`}>
                  <span className="mob-row-main">
                    {c.mf_swap_quantity > 0 && <span className="mob-tag swap sm"><RefreshCw size={11} />Troca MF · {c.mf_swap_quantity} un</span>}
                    <b>{c.name}</b>
                    <small>{c.brand || 'sem produto'}{c.sale_type === 'full' ? ' · completo' : ' · somente água'}{c.out_of_catalog ? ' · produto novo p/ cliente' : ''}{c.st === 'done' ? ' · entregue' : c.st === 'failed' ? ' · não entregue' : ''}</small>
                  </span>
                  {editable && c.st === 'pending'
                    ? <>
                      <MobileClientQty value={c.quantity} testid={`mob-viagem-cliente-edit-qty-${c.id}`} onCommit={q => run(() => onUpdateRotaCliente(v.id, r.id, c.id, { quantity: q }), 'Não foi possível salvar a quantidade.')} />
                      <button type="button" className="mob-x" aria-label="Remover cliente" data-testid={`mob-viagem-rota-cliente-remover-${c.id}`} onClick={() => run(() => onRemoveRotaCliente(v.id, r.id, c.id), 'Não foi possível remover o cliente.')}><X size={20} /></button>
                    </>
                    : <b className="mob-locked">{Number(c.quantity) || 0} un</b>}
                </div>)}
                {picking && !cfg && <div className="mob-picker" data-testid={`mob-viagem-rota-add-cliente-form-${r.id}`}>
                  <div className="mob-picker-search">
                    <Search size={18} />
                    <input autoFocus placeholder="Buscar cliente cadastrado" value={pickQ} data-testid="mob-viagem-client-search" onChange={e => setPickQ(e.target.value)} />
                    <button type="button" className="mob-link dark" data-testid="mob-viagem-client-done" onClick={() => setPicker(null)}>Pronto</button>
                  </div>
                  {pickRows.map(c => <button type="button" className="mob-row sm pad" key={c.id} data-testid={`mob-viagem-client-${c.id}`} onClick={() => setConfig({ viagemId: v.id, rotaId: r.id, customer: c })}>
                    <span className="mob-row-main"><b>{c.name}</b><small>{brandListOf(c).map(b => b.brand).join(', ') || 'sem marca cadastrada'}{c.address ? ` · ${c.address}` : ''}</small></span>
                    <Plus size={20} />
                  </button>)}
                  {pickRows.length === 0 && <p className="mob-muted pad">Nenhum cliente encontrado.</p>}
                </div>}
                {cfg && <MobileProductConfig key={cfg.customer.id} customer={cfg.customer} rotaNumero={r.numero} brandsCatalog={brandsCatalog} busy={busy} onCancel={() => setConfig(null)} onConfirm={cliente => addCliente(v, r, cliente)} />}
                {editable && !picking && !cfg && <button type="button" className="mob-link dark h52 pad" data-testid={`mob-viagem-rota-add-cliente-${r.id}`} onClick={() => openPicker(v.id, r.id)}><UserPlus size={18} />Adicionar cliente</button>}
              </div>
            })}
            {rotas.length === 0 && !editable && <p className="mob-muted pad">Viagem sem rotas.</p>}
            {editable && <button type="button" className="mob-dashed" disabled={busy} data-testid={`mob-viagem-rota-add-${v.id}`} onClick={() => addRota(v)}><Plus size={18} />Nova rota</button>}
          </div>}
        </div>
      })}
    </section>
  </>
}

function MobileDiarioTab({ entries, date }) {
  const [rotaFilter, setRotaFilter] = useState('');
  const todaysAll = entries.filter(e => e.date === date);
  const rotaOptions = [...new Map(todaysAll.filter(e => e.rota_codigo).map(e => [e.rota_codigo, e])).values()];
  const todays = rotaFilter ? todaysAll.filter(e => e.rota_codigo === rotaFilter) : todaysAll;
  const totals = todays.reduce((s, e) => ({ qty: s.qty + Number(e.billed_quantity || 0), pix: s.pix + Number(e.pix_value || 0), cash: s.cash + Number(e.cash_value || 0) }), { qty: 0, pix: 0, cash: 0 });
  const mfDetail = e => e.mf_plan === 'swap' ? 'trocado' : e.mf_plan === 'refused' ? 'cliente não quis' : (e.mf_date || '');
  return <>
    {rotaOptions.length > 0 && <label className="mob-field"><b className="mob-label">Filtrar por rota</b>
      <select className="mob-input" value={rotaFilter} data-testid="mob-diario-viagem-filter" onChange={e => setRotaFilter(e.target.value)}>
        <option value="">Todas as rotas de hoje</option>
        {rotaOptions.map(e => <option key={e.rota_codigo} value={e.rota_codigo}>{e.rota_codigo}</option>)}
      </select>
    </label>}
    <section className="mob-stats3">
      <div><span className="mob-eyebrow">Galões</span><b className="big">{totals.qty}</b></div>
      <div><span className="mob-eyebrow">Pix</span><b>{money(totals.pix)}</b></div>
      <div><span className="mob-eyebrow">Dinheiro</span><b>{money(totals.cash)}</b></div>
    </section>
    <section className="mob-list">
      <div className="mob-sec-head"><b>Lançamentos de hoje</b><b>{todays.length}</b></div>
      {todays.length === 0 && <p className="mob-muted pad">Nada lançado ainda. Conclua uma parada na aba Rota.</p>}
      {todays.map(e => <div className="mob-entry" key={e.id} data-testid={`mob-entry-${e.id}`}>
        <div><b>{e.customer}{e.entry_number ? <small> Nº {e.entry_number}</small> : null}</b><b>{money(e.total)}</b></div>
        <div className="mob-chips">
          <span className="mob-chip">{entryItemsLabel(e)}</span>
          <span className="mob-chip">{entryPayLabel(e)}</span>
          {e.rota_codigo && <span className="mob-chip">{e.rota_codigo}</span>}
          {e.mf_quantity > 0 && <span className="mob-chip warn">{e.mf_quantity} MF · {mfDetail(e)}</span>}
        </div>
      </div>)}
    </section>
  </>
}

function MobileCaixaTab({ entries, expenses, expensesTotal, viagens, date, pendingStops, onCloseDay, dayClosed, closingDay }) {
  const [viagemFilter, setViagemFilter] = useState('');
  const [confirming, setConfirming] = useState(false);
  const todaysAll = entries.filter(e => e.date === date);
  const todays = viagemFilter ? todaysAll.filter(e => e.viagem_id === viagemFilter) : todaysAll;
  const expensesToday = (expenses || []).filter(x => manausDate(x.created_at) === date && x.status !== 'rejected');
  const filteredExpensesTotal = viagemFilter ? expensesToday.filter(x => x.viagem_id === viagemFilter).reduce((s, x) => s + Number(x.amount || 0), 0) : Number(expensesTotal || 0);
  const pix = todays.reduce((s, e) => s + Number(e.pix_value || 0), 0);
  const cash = todays.reduce((s, e) => s + Number(e.cash_value || 0), 0);
  const comp = todays.reduce((s, e) => s + Number(e.comp_value || 0), 0);
  const netTotal = pix + cash - filteredExpensesTotal;

  const viagemInfo = {};
  for (const v of (viagens || [])) viagemInfo[v.id] = v;
  const viagemOptions = (viagens || []).filter(v => todaysAll.some(e => e.viagem_id === v.id));
  const porRota = {};
  for (const e of todays) { const k = e.rota_codigo || 'Sem rota'; porRota[k] = (porRota[k] || 0) + Number(e.pix_value || 0) + Number(e.cash_value || 0); }
  const rotaInfo = {};
  for (const v of (viagens || [])) for (const r of (v.rotas || [])) rotaInfo[r.codigo_rota] = { ...r, viagem: v };
  const rotas = Object.keys(porRota).sort((a, b) => (rotaInfo[a]?.numero || 0) - (rotaInfo[b]?.numero || 0));
  const selectedViagem = viagemFilter ? viagemInfo[viagemFilter] : null;
  const rows = [
    [QrCode, 'Recebido em Pix', 'já na conta da empresa', money(pix)],
    [Banknote, 'Recebido em dinheiro', 'entregar na base', money(cash)],
    [Clock3, 'Vendas a prazo', 'lançadas hoje', money(comp)],
    [WalletCards, `Despesas${selectedViagem ? ' da viagem' : ' do dia'}`, 'descontado do saldo líquido', `−${money(filteredExpensesTotal)}`],
  ];

  return <>
    {viagemOptions.length > 0 && <label className="mob-field"><b className="mob-label">Filtrar por viagem</b>
      <select className="mob-input" value={viagemFilter} data-testid="mob-caixa-viagem-filter" onChange={e => setViagemFilter(e.target.value)}>
        <option value="">Todas as viagens de hoje</option>
        {viagemOptions.map(v => <option key={v.id} value={v.id}>{TURNO_LABELS[v.turno]} · Viagem {v.numero} · {v.codigo_viagem}</option>)}
      </select>
    </label>}
    <section className="mob-hero">
      <span className="mob-eyebrow">{selectedViagem ? `Saldo · ${TURNO_LABELS[selectedViagem.turno]} · Viagem ${selectedViagem.numero}` : 'Saldo líquido do dia'}</span>
      <b data-testid="mob-cash-to-deliver">{money(netTotal)}</b>
      <span className="mob-muted">Pix + dinheiro recebidos, já descontadas as despesas</span>
    </section>
    <section className="mob-list">
      {rows.map(([Icon, label, sub, value]) => <div className="mob-cash-row" key={label}><Icon size={22} /><span className="mob-row-main"><b>{label}</b><small>{sub}</small></span><b>{value}</b></div>)}
    </section>
    <section className="mob-card pad14">
      <span className="mob-eyebrow">Entregar na base</span>
      <b className="mob-h28" data-testid="mob-cash-in-hand">{money(cash)}</b>
      <span className="mob-muted">Dinheiro em mãos · o Pix já está na conta</span>
    </section>
    {rotas.length > 0 && <section className="mob-list">
      <div className="mob-sec-head"><b>Resumo por rota</b><b>{rotas.length}</b></div>
      {rotas.map(codigo => { const info = rotaInfo[codigo]; return <div className="mob-cash-row" key={codigo} data-testid={`mob-cash-rota-${codigo}`}>
        <Truck size={22} />
        <span className="mob-row-main"><b>{info ? `${TURNO_LABELS[info.viagem.turno]} · Viagem ${info.viagem.numero} · Rota ${pad2(info.numero)}` : codigo}</b><small>Pix + dinheiro</small></span>
        <b>{money(porRota[codigo])}</b>
      </div> })}
    </section>}
    {dayClosed
      ? <section className="mob-band" data-testid="mob-day-closed"><Lock size={20} /><b>Dia fechado. Lançamentos bloqueados.</b></section>
      : confirming
        ? <MobileConfirm testid="mob-close-day-confirm" title="Fechar o dia agora?" text={pendingStops > 0 ? `Ainda há ${pendingStops} parada(s) pendente(s) na rota. Depois de fechar, só o administrador reabre.` : 'Depois de fechar, só o administrador reabre os lançamentos.'} confirmLabel={closingDay ? 'Fechando...' : 'Sim, fechar'} busy={closingDay} onCancel={() => setConfirming(false)} onConfirm={async () => { await onCloseDay(); setConfirming(false); }} />
        : <MobBtn h={64} icon={Lock} data-testid="mob-close-day-button" onClick={() => setConfirming(true)}>Fechar o dia</MobBtn>}
  </>
}

const MOBILE_EXPENSE_CATEGORIES = [['Combustível', Fuel], ['Alimentação', Utensils], ['Pedágio', Receipt], ['Manutenção', Wrench], ['Outros', Ellipsis]];

function MobileDespesasTab({ user, date, viagens, viagemAtiva, onOpenViagens, dayClosed, toast }) {
  const [items, setItems] = useState([]);
  const [category, setCategory] = useState('Combustível');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [viagemId, setViagemId] = useState('');
  const [error, setError] = useState('');
  const [photo, setPhoto] = useState(null);
  const photoInputRef = useRef(null);
  useEffect(() => {
    setViagemId(prev => (prev && (viagens || []).some(v => v.id === prev)) ? prev : (viagemAtiva?.id || viagens?.[0]?.id || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viagemAtiva, viagens]);

  function pickPhoto(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  }

  async function load() { const { data } = await api.get('/expenses', auth()); setItems(data.filter(x => (x.driver || '') === user.name && manausDate(x.created_at) === date)); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [date]);
  useAutoRefresh(load);

  const value = parseMoney(amount);
  async function submit() {
    setError('');
    if (!viagemId) return setError('Selecione a viagem que gerou essa despesa.');
    if (!(value > 0)) return setError('Informe um valor válido.');
    try {
      const { data } = await api.post('/expenses', { type: category, driver: user.name, amount: value, notes: note, status: 'approved', viagem_id: viagemId, photo }, auth());
      setItems([data, ...items]); setAmount(''); setNote(''); setPhoto(null);
      toast('Despesa lançada.');
    } catch (e) { setError(apiError(e, 'Não foi possível lançar.')); }
  }

  const total = items.reduce((s, x) => s + Number(x.amount || 0), 0);
  const hasTrips = viagens && viagens.length > 0;
  return <>
    {dayClosed && <section className="mob-band" data-testid="mob-expense-day-closed"><Lock size={20} /><b>Dia fechado — despesas somente para consulta.</b></section>}
    {!dayClosed && !hasTrips && <section className="mob-card plain" data-testid="mob-expense-no-trip">
      <div className="mob-card-body"><b className="mob-h20">Nenhuma viagem criada hoje.</b><span className="mob-muted">Crie uma viagem para poder atribuir despesas a ela.</span></div>
      <MobBtn lead={Plus} icon={ArrowRight} onClick={() => onOpenViagens()}>Criar viagem</MobBtn>
    </section>}
    {!dayClosed && hasTrips && <>
      <label className="mob-field"><b className="mob-label">Viagem desta despesa</b>
        <select className="mob-input" value={viagemId} data-testid="mob-expense-viagem-select" onChange={e => setViagemId(e.target.value)}>
          {viagens.map(v => <option key={v.id} value={v.id}>{TURNO_LABELS[v.turno]} · Viagem {v.numero} · {v.codigo_viagem}{v.status === 'execucao' ? ' (em execução)' : v.status === 'finalizada' ? ' (concluída)' : ''}</option>)}
        </select>
      </label>
      <section className="mob-field">
        <b className="mob-label">Categoria</b>
        <div className="mob-cat-grid">{MOBILE_EXPENSE_CATEGORIES.map(([label, Icon]) => <button type="button" key={label} className={`mob-pick${category === label ? ' on' : ''}`} data-testid={`mob-expense-cat-${label}`} onClick={() => setCategory(label)}><Icon size={22} /><span>{label}</span></button>)}</div>
      </section>
      <label className="mob-field"><b className="mob-label">Valor</b>
        <span className="mob-money"><span>R$</span><input inputMode="decimal" placeholder="0,00" value={amount} data-testid="mob-expense-amount" onChange={e => setAmount(e.target.value)} /></span>
      </label>
      <label className="mob-field"><b className="mob-label">Observação (opcional)</b><input className="mob-input" placeholder="ex: posto na saída da cidade" value={note} data-testid="mob-expense-note" onChange={e => setNote(e.target.value)} /></label>
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} data-testid="mob-expense-photo-input" onChange={e => pickPhoto(e.target.files?.[0])} />
      <MobBtn kind="outline" h={56} data-testid="mob-expense-photo" lead={photo ? undefined : Camera} onClick={() => photoInputRef.current?.click()}>{photo && <img src={photo} alt="Comprovante" className="mob-thumb" />}{photo ? ' Trocar foto do comprovante' : 'Foto do comprovante'}</MobBtn>
      {error && <div className="mob-error" data-testid="mob-expense-error">{error}</div>}
      <MobBtn h={64} icon={Plus} disabled={!(value > 0) || !viagemId} data-testid="mob-expense-submit" onClick={submit}>Lançar despesa</MobBtn>
    </>}
    <section className="mob-list">
      <div className="mob-sec-head"><b>Despesas de hoje</b><b>{money(total)}</b></div>
      {items.length === 0 && <p className="mob-muted pad">Nenhuma despesa lançada.</p>}
      {items.map(x => { const CatIcon = (MOBILE_EXPENSE_CATEGORIES.find(c => c[0] === x.type) || [])[1] || Ellipsis; return <div className="mob-cash-row sm" key={x.id} data-testid={`mob-expense-row-${x.id}`}>
        {x.photo ? <img src={x.photo} alt="Comprovante" className="mob-thumb" /> : <CatIcon size={20} />}
        <span className="mob-row-main"><b>{x.type}</b><small>{x.status === 'pending' ? 'Aguardando aprovação' : x.status === 'rejected' ? 'Reprovada' : new Date(x.created_at || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{x.viagem_codigo ? ` · ${x.viagem_codigo}` : ''}</small></span>
        <b>{money(x.amount)}</b>
      </div> })}
    </section>
  </>
}

function MobileAjustesTab({ user, theme, setTheme, scale, setTextScale, onLogout }) {
  return <>
    <section className="mob-field">
      <b className="mob-label">Tamanho do texto</b>
      <div className="mob-seg">{MOBILE_SCALES.map(([v, label]) => <button type="button" key={v} className={scale === v ? 'on' : ''} style={{ fontSize: `${16 * v}px` }} data-testid={`mob-scale-${v}`} onClick={() => setTextScale(v)}>{label}</button>)}</div>
    </section>
    <section className="mob-field">
      <b className="mob-label">Fundo</b>
      <div className="mob-seg">
        <button type="button" className={theme !== 'dark' ? 'on' : ''} data-testid="mob-theme-light" onClick={() => setTheme('light')}><Sun size={18} /> Claro</button>
        <button type="button" className={theme === 'dark' ? 'on' : ''} data-testid="mob-theme-dark" onClick={() => setTheme('dark')}><Moon size={18} /> Escuro</button>
      </div>
    </section>
    <section className="mob-field">
      <b className="mob-label">Conta</b>
      <div className="mob-cash-row sm"><span className="mob-avatar">{user.name.split(' ').map(x => x[0]).join('').slice(0, 2)}</span><span className="mob-row-main"><b>{user.name}</b><small>Entregador</small></span></div>
    </section>
    <MobBtn kind="outline" lead={LogOut} data-testid="mob-logout-button" onClick={onLogout}>Sair da conta</MobBtn>
  </>
}

function DriverMobileApp({ user, customers, onLogout }) {
  const [theme, setTheme] = useDraft('hydro_theme', 'light');
  const [textScale, setTextScale] = useDraft('hydro_text_scale', 1);
  const scale = MOBILE_SCALES.map(x => x[0]).reduce((best, v) => Math.abs(v - textScale) < Math.abs(best - textScale) ? v : best, 1);
  const [tab, setTab] = useState('rota');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState([]);
  const [todaysExpenses, setTodaysExpenses] = useState([]);
  const [viagens, setViagens] = useState([]);
  const [viagensPresas, setViagensPresas] = useState([]);
  const [mfPending, setMfPending] = useState([]);
  const [dayClosure, setDayClosure] = useState(null);
  const [closingDay, setClosingDay] = useState(false);
  const [launchKey, setLaunchKey] = useState(null);
  const [openTripId, setOpenTripId] = useState(null);
  const [receiptEntry, setReceiptEntry] = useState(null);
  const [editingEntry, setEditingEntry] = useState(null);
  const [toast, setToast] = useState('');
  const [wide, setWide] = useState(false);
  const rootRef = useRef(null);
  const toastTimer = useRef(null);
  const date = todayISO(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || !window.ResizeObserver) return undefined;
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= 720));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  function showToast(text, ms = 2600) { clearTimeout(toastTimer.current); setToast(text); toastTimer.current = setTimeout(() => setToast(''), ms); }

  async function loadEntries() { const { data } = await api.get('/daily-entries', { ...auth(), params: { driver: user.name } }); setEntries(data); }
  async function loadViagens() {
    const { data } = await api.get('/viagens', { ...auth(), params: { date } }); setViagens(data.viagens);
    // Viagem de outro dia que ficou em execução bloqueia o início das de hoje.
    try { const { data: abertas } = await api.get('/viagens', { ...auth(), params: { status: 'execucao' } }); setViagensPresas(abertas.viagens.filter(v => v.date !== date && v.status === 'execucao')); } catch { /* ignore */ }
  }
  async function loadExpenses() { const { data } = await api.get('/expenses', auth()); setTodaysExpenses(data.filter(x => (x.driver || '') === user.name && manausDate(x.created_at) === date && x.status !== 'rejected')); }
  async function loadMfPending() { try { const { data } = await api.get('/mf-pendentes', auth()); setMfPending(data.filter(m => !m.scheduled_viagem_id)); } catch { /* ignore */ } }
  async function loadDayClosure() { const { data } = await api.get('/daily-closing/status', { ...auth(), params: { date } }); setDayClosure(data); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEntries(); loadViagens(); loadExpenses(); loadDayClosure(); loadMfPending(); }, []);
  useAutoRefresh(() => Promise.all([loadEntries(), loadViagens(), loadExpenses(), loadDayClosure(), loadMfPending()]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadExpenses(); }, [tab]);

  const entregasPorViagem = entries.reduce((acc, e) => {
    if (!e.viagem_id) return acc;
    const swapMf = e.mf_plan === 'swap' ? Number(e.mf_quantity || 0) : 0;
    acc[e.viagem_id] = (acc[e.viagem_id] || 0) + Number(e.billed_quantity || 0) + 2 * swapMf;
    return acc;
  }, {});
  const viagensComProgresso = viagens.map(v => ({ ...v, quantidade_atual: entregasPorViagem[v.id] || 0 }));
  const viagemAtiva = viagensComProgresso.find(v => v.status === 'execucao');
  const cargaRestante = viagemAtiva?.carga_total != null ? Math.max(0, viagemAtiva.carga_total - (viagemAtiva.quantidade_atual || 0)) : null;
  const dayClosed = !!dayClosure?.closed;

  const entriesDaViagem = entries.filter(e => e.viagem_id === viagemAtiva?.id);
  const stops = (viagemAtiva?.rotas || []).flatMap(r => (r.clientes || []).map((c, i) => {
    const entry = entriesDaViagem.find(e => sameName(e.customer, c.name));
    const customer = customers.find(x => x.id === c.id) || customers.find(x => sameName(x.name, c.name));
    return { ...c, key: `${r.id}:${c.id}`, rota_id: r.id, rota_numero: r.numero, seq: i + 1, customer, entry, address: customer?.address || '', prazo: customer?.payment_type === 'prazo', status: entry ? 'done' : c.status === 'nao_entregue' ? 'failed' : 'pending' };
  }));
  const pendingStops = stops.filter(s => s.status === 'pending');
  const launchStop = launchKey ? stops.find(s => s.key === launchKey && s.status !== 'done') : null;
  const q = search.trim().toLowerCase();
  const inTripIds = new Set(stops.map(s => s.id));
  const offRoute = viagemAtiva && q ? customers.filter(c => !inTripIds.has(c.id) && (c.name.toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q) || (c.address || '').toLowerCase().includes(q))) : [];

  async function createViagem(payload) { const { data } = await api.post('/viagens', payload, auth()); await loadViagens(); return data; }
  async function iniciarViagem(v) { await api.post(`/viagens/${v.id}/iniciar`, {}, auth()); await loadViagens(); setTab('rota'); showToast('Viagem iniciada — boa rota!'); }
  async function finalizarViagem(v) { await api.post(`/viagens/${v.id}/finalizar`, {}, auth()); setLaunchKey(null); setSearch(''); await Promise.all([loadViagens(), loadMfPending()]); showToast(`Viagem ${v.numero || ''} concluída.`); }
  async function deleteViagem(v) { await api.delete(`/viagens/${v.id}`, auth()); await Promise.all([loadViagens(), loadMfPending()]); }
  async function addRota(viagemId, payload) { const { data } = await api.post(`/viagens/${viagemId}/rotas`, payload, auth()); await loadViagens(); return data; }
  async function addRotaCliente(viagemId, rotaId, cliente) { const { data } = await api.post(`/viagens/${viagemId}/rotas/${rotaId}/clientes`, cliente, auth()); await loadViagens(); return data; }
  async function updateRotaCliente(viagemId, rotaId, clienteId, changes) { const { data } = await api.patch(`/viagens/${viagemId}/rotas/${rotaId}/clientes/${clienteId}`, changes, auth()); await loadViagens(); return data; }
  async function removeRotaCliente(viagemId, rotaId, clienteId) { const { data } = await api.delete(`/viagens/${viagemId}/rotas/${rotaId}/clientes/${clienteId}`, auth()); await Promise.all([loadViagens(), loadMfPending()]); return data; }
  async function removeRota(viagemId, rotaId) { const { data } = await api.delete(`/viagens/${viagemId}/rotas/${rotaId}`, auth()); await Promise.all([loadViagens(), loadMfPending()]); return data; }
  async function scheduleMf(viagemId, rotaId, movementId) { const { data } = await api.post(`/viagens/${viagemId}/rotas/${rotaId}/mf-troca`, { movement_id: movementId }, auth()); await Promise.all([loadViagens(), loadMfPending()]); return data; }

  const guard = (fn, fallback) => async (...args) => { try { await fn(...args); } catch (e) { showToast(apiError(e, fallback), 6000); } };
  const startTrip = guard(iniciarViagem, 'Não foi possível iniciar a viagem.');
  const finishTrip = guard(finalizarViagem, 'Não foi possível concluir a viagem.');
  const deleteEntry = guard(async entry => { await api.delete(`/daily-entries/${entry.id}`, auth()); await Promise.all([loadEntries(), loadViagens(), loadMfPending()]); showToast('Entrega excluída.'); }, 'Não foi possível excluir a entrega.');

  function openViagens(tripId) { setTab('viagens'); if (tripId) setOpenTripId(tripId); if (!wide) setLaunchKey(null); }
  function openStop(stop) {
    if (dayClosed) return showToast('O dia está fechado. Peça ao administrador para reabrir.');
    if (!viagemAtiva) return showToast('Inicie a viagem antes de lançar.');
    setLaunchKey(stop.key);
  }
  const pickOffRoute = guard(async c => {
    if (dayClosed) return showToast('O dia está fechado. Peça ao administrador para reabrir.');
    const cliente = { id: c.id, name: c.name, brand: brandListOf(c)[0]?.brand, sale_type: 'exchange' };
    const rotaAlvo = viagemAtiva.rotas?.[viagemAtiva.rotas.length - 1];
    const updated = rotaAlvo ? await addRotaCliente(viagemAtiva.id, rotaAlvo.id, cliente) : await addRota(viagemAtiva.id, { clientes: [cliente] });
    const rota = updated.rotas.find(r => (r.clientes || []).some(x => x.id === c.id));
    setSearch(''); if (rota) setLaunchKey(`${rota.id}:${c.id}`);
  }, 'Não foi possível incluir o cliente na rota.');

  // Um toque no aviso já encaixa a troca na viagem em execução (ou na próxima planejada).
  const includeMf = async m => {
    const target = viagemAtiva || viagensComProgresso.find(v => v.status === 'planejada');
    if (!target) { openViagens(); return showToast('Crie a viagem; depois toque de novo em incluir a troca de MF.', 5000); }
    try {
      let rota = (target.rotas || [])[(target.rotas || []).length - 1];
      if (!rota) { const updated = await addRota(target.id, { clientes: [] }); rota = updated.rotas[updated.rotas.length - 1]; }
      await scheduleMf(target.id, rota.id, m.id);
      showToast(`Troca de MF de ${m.customer} incluída na viagem ${target.numero}.`, 4000);
    } catch (e) {
      const missing = [404, 405].includes(e?.response?.status) && !['Rota não encontrada', 'Troca de MF pendente não encontrada', 'Viagem não encontrada'].includes(e?.response?.data?.detail);
      showToast(missing ? 'O servidor ainda não tem a função de incluir troca de MF na viagem — publique a versão nova do backend.' : apiError(e, 'Não foi possível incluir a troca de MF.'), 8000);
    }
  };

  function onEntryComplete(entry) {
    setEntries([entry, ...entries]);
    setLaunchKey(null); setTab('rota'); setSearch('');
    loadMfPending(); loadViagens();
    const base = `Entrega Nº ${entry.entry_number} registrada · ${entry.customer}. Escolha a próxima na lista.`;
    if (entry.warnings?.length) showToast(`${base} Atenção: ${entry.warnings.join(' ')}`, 9000);
    else showToast(base, 4000);
  }
  async function savePhoneForCustomerName(name, phone) {
    const c = customers.find(x => x.name === name);
    if (c) await api.patch(`/customers/${c.id}`, { phone }, auth());
  }
  async function closeDay() {
    setClosingDay(true);
    try { await api.post('/daily-closing/close', { date }, auth()); await loadDayClosure(); showToast('Dia fechado e registrado.'); }
    catch (e) { showToast(apiError(e, 'Não foi possível fechar o dia.'), 6000); }
    finally { setClosingDay(false); }
  }
  const expensesTotal = todaysExpenses.reduce((s, x) => s + Number(x.amount || 0), 0);

  return <div ref={rootRef} className={`mobile-app${theme === 'dark' ? ' dark' : ''}`} style={{ '--s': scale }} data-testid="mobile-driver-app">
    <MobileHeader user={user} title={MOBILE_TITLES[tab]} theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />
    <div className="mob-body">
      <main className="mob-main"><div className="mob-col">
        {tab === 'rota' && <MobileRotaTab viagemAtiva={viagemAtiva} viagens={viagensComProgresso} stops={stops} entries={entries} date={date} search={search} setSearch={setSearch} mfPending={mfPending} viagensPresas={viagensPresas} onFinalizarPresa={finishTrip} dayClosed={dayClosed} onOpenStop={openStop} onOpenViagens={openViagens} onStartTrip={startTrip} onFinishTrip={finishTrip} offRoute={offRoute} onPickOffRoute={pickOffRoute} onReceipt={setReceiptEntry} onEditEntry={setEditingEntry} onDeleteEntry={deleteEntry} onIncludeMf={includeMf} />}
        {tab === 'viagens' && <MobileViagensScreen viagens={viagensComProgresso} customers={customers} entries={entries} mfPending={mfPending} dayClosed={dayClosed} viagemAtiva={viagemAtiva} openTripId={openTripId} setOpenTripId={setOpenTripId} onBack={() => setTab('rota')} onCreate={createViagem} onIniciar={iniciarViagem} onFinalizar={finalizarViagem} onDelete={deleteViagem} onAddRota={addRota} onAddRotaCliente={addRotaCliente} onUpdateRotaCliente={updateRotaCliente} onRemoveRotaCliente={removeRotaCliente} onRemoveRota={removeRota} onScheduleMf={scheduleMf} toast={showToast} />}
        {tab === 'diario' && <MobileDiarioTab entries={entries} date={date} />}
        {tab === 'caixa' && <MobileCaixaTab entries={entries} expenses={todaysExpenses} expensesTotal={expensesTotal} viagens={viagensComProgresso} date={date} pendingStops={pendingStops.length} onCloseDay={closeDay} dayClosed={dayClosed} closingDay={closingDay} />}
        {tab === 'despesas' && <MobileDespesasTab user={user} date={date} viagens={viagensComProgresso} viagemAtiva={viagemAtiva} onOpenViagens={openViagens} dayClosed={dayClosed} toast={showToast} />}
        {tab === 'mais' && <MobileAjustesTab user={user} theme={theme} setTheme={setTheme} scale={scale} setTextScale={setTextScale} onLogout={onLogout} />}
      </div></main>
      {(wide || launchStop) && <aside className={`mob-panel ${wide ? 'side' : 'cover'}${launchStop ? '' : ' empty'}`} data-testid="mob-launch-panel">
        {launchStop
          ? <MobileLaunchPanel key={launchStop.key} stop={launchStop} user={user} date={date} viagemId={viagemAtiva?.id} cargaRestante={cargaRestante} othersPending={pendingStops.filter(s => s.key !== launchStop.key).reduce((a, s) => a + clienteLoad(s), 0)} onClose={() => setLaunchKey(null)} onComplete={onEntryComplete} onFailed={() => { setLaunchKey(null); loadViagens(); loadMfPending(); showToast('Marcado como não entregue.'); }} onOpenViagens={() => openViagens(viagemAtiva?.id)} />
          : <div className="mob-panel-empty"><Hand size={32} /><b>Toque numa parada para lançar a entrega.</b><span className="mob-muted">O lançamento abre aqui, sem esconder a rota.</span></div>}
      </aside>}
    </div>
    <MobileBottomNav tab={tab} setTab={t => { setTab(t); if (!wide) setLaunchKey(null); }} />
    {editingEntry && <MobileEditEntregaModal entry={editingEntry} onClose={() => setEditingEntry(null)} onSaved={() => { setEditingEntry(null); loadEntries(); loadViagens(); loadMfPending(); showToast('Revisão salva.'); }} />}
    {receiptEntry && <MobileReceiptPrompt entry={receiptEntry} customer={customers.find(c => c.name === receiptEntry.customer)} onSavePhone={p => savePhoneForCustomerName(receiptEntry.customer, p)} onClose={() => setReceiptEntry(null)} />}
    <MobileToast text={toast} />
  </div>
}

/* =================== fim app mobile do entregador ==================== */

function App() {
  const [user, setUser] = useState(null), [data, setData] = useState(null), [customers, setCustomers] = useState([]), [checking, setChecking] = useState(true), [modal, setModal] = useState(null), [editCustomer, setEditCustomer] = useState(null), [notifications, setNotifications] = useState({ pending_users: 0, pending_expenses: 0, total: 0 }), [refreshing, setRefreshing] = useState(false), [lastUpdated, setLastUpdated] = useState(null);
  useEffect(() => { const t = localStorage.getItem('hydro_token'); if (t) api.get('/auth/me', auth()).then(x => setUser(x.data)).catch(() => localStorage.removeItem('hydro_token')).finally(() => setChecking(false)); else setChecking(false) }, []);
  async function loadDashboard({ silent = false } = {}) {
    if (!silent) setRefreshing(true);
    try { const [a, c] = await Promise.all([api.get('/dashboard', auth()), api.get('/customers', auth())]); setData(a.data); setCustomers(c.data); setLastUpdated(new Date()); }
    finally { if (!silent) setRefreshing(false); }
  }
  useEffect(() => { if (user) loadDashboard(); }, [user]);
  useAutoRefresh(() => user ? loadDashboard({ silent: true }) : undefined);
  useEffect(() => {
    if (!user) return;
    const fetchNotif = () => api.get('/notifications', auth()).then(x => setNotifications(x.data)).catch(() => { });
    fetchNotif();
    const id = setInterval(fetchNotif, 30000);
    window.hydroRefreshNotifications = fetchNotif;
    return () => clearInterval(id);
  }, [user, data]);
  const isMobile = useMediaQuery('(max-width:1024px)');
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
      <Route path="/" element={<Dashboard data={data} onRefresh={loadDashboard} refreshing={refreshing} lastUpdated={lastUpdated} isDriver={user.role === 'driver'} />} />
      <Route path="/estoque" element={<Stock data={data} setData={setData} create={setModal} />} />
      <Route path="/financeiro" element={<Finance data={data} setData={setData} create={setModal} user={user} />} />
      <Route path="/margem" element={adminOnly(<MarginReport />)} />
      <Route path="/provisao" element={adminOnly(<Receivables />)} />
      <Route path="/viagens" element={<Viagens customers={customers} user={user} />} />
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

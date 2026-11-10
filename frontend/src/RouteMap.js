// Mapa das rotas sem custo: CEP pela AwesomeAPI/ViaCEP, mapa Leaflet com OpenStreetMap, traçado pelo OSRM
// e navegação por link direto do Google Maps (abre o app do celular, sem chave de API nem cartão).
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./RouteMap.css";

export const onlyDigits = s => String(s || '').replace(/\D/g, '');
export const fmtCep = s => { const d = onlyDigits(s).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };
export const hasPos = p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null;
const MANAUS = [-3.119, -60.0217];
const km = m => `${(m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
const mins = s => { const m = Math.max(1, Math.round(s / 60)); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
export const routeSummary = r => r ? `${km(r.distance)} (~${mins(r.duration)})` : '';

async function getJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(String(r.status)); return r.json(); }

// Endereço por texto (fallback quando o CEP não traz posição).
export async function geocode(q) {
  const rows = await getJson(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`);
  return rows?.[0] ? { lat: Number(rows[0].lat), lng: Number(rows[0].lon) } : null;
}

// CEP → endereço e posição. A AwesomeAPI já devolve lat/lng; sem ela, ViaCEP + busca do endereço.
export async function lookupCep(cep) {
  const d = onlyDigits(cep);
  if (d.length !== 8) throw new Error('CEP inválido — use 8 dígitos.');
  try {
    const a = await getJson(`https://cep.awesomeapi.com.br/json/${d}`);
    if (a?.cep) {
      const pos = a.lat && a.lng ? { lat: Number(a.lat), lng: Number(a.lng) } : null;
      return { cep: d, street: a.address || '', district: a.district || '', city: a.city || '', state: a.state || '', ...(pos || {}) };
    }
  } catch { /* tenta o ViaCEP */ }
  const v = await getJson(`https://viacep.com.br/ws/${d}/json/`).catch(() => null);
  if (!v || v.erro) throw new Error('CEP não encontrado.');
  const out = { cep: d, street: v.logradouro || '', district: v.bairro || '', city: v.localidade || '', state: v.uf || '' };
  const pos = await geocode([out.street, out.district, out.city, out.state].filter(Boolean).join(', ')).catch(() => null)
    || await geocode(`${out.city}, ${out.state}`).catch(() => null);
  return { ...out, ...(pos || {}) };
}
export const cepAddress = (c, numero) => [c.street && `${c.street}${numero ? `, ${numero}` : ''}`, c.district, c.city && `${c.city}/${c.state}`].filter(Boolean).join(' - ');

const routeCache = new Map();
// Traçado pelas ruas na ordem dada: distância, tempo e cada trecho.
export async function osrmRoute(points) {
  if (points.length < 2) return null;
  const coords = points.map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
  if (routeCache.has(coords)) return routeCache.get(coords);
  const j = await getJson(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  if (j.code !== 'Ok' || !j.routes?.[0]) throw new Error('Sem traçado');
  const r = j.routes[0];
  const out = { distance: r.distance, duration: r.duration, line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), legs: r.legs.map(l => ({ distance: l.distance, duration: l.duration })) };
  routeCache.set(coords, out);
  return out;
}
// Melhor sequência partindo do primeiro ponto (o depósito) e voltando a ele. Devolve os índices de entrada na nova ordem.
export async function osrmBestOrder(points) {
  const coords = points.map(p => `${Number(p.lng).toFixed(6)},${Number(p.lat).toFixed(6)}`).join(';');
  const j = await getJson(`https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=true&overview=false`);
  if (j.code !== 'Ok') throw new Error('Sem otimização');
  return j.waypoints.map((w, i) => ({ i, pos: w.waypoint_index })).sort((a, b) => a.pos - b.pos).map(x => x.i);
}

// Link oficial do Google Maps (gratuito): até 9 paradas intermediárias + o destino. Sem origem = posição atual do celular.
export const GMAPS_MAX_STOPS = 10;
const gPoint = p => hasPos(p) ? `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}` : (p.address || '');
export function googleMapsLink(origin, stops) {
  const list = stops.filter(s => hasPos(s) || s.address).slice(0, GMAPS_MAX_STOPS);
  if (!list.length) return null;
  const q = new URLSearchParams({ api: '1', travelmode: 'driving', destination: gPoint(list[list.length - 1]) });
  if (origin && hasPos(origin)) q.set('origin', gPoint(origin));
  if (list.length > 1) q.set('waypoints', list.slice(0, -1).map(gPoint).join('|'));
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

const pinIcon = (label, kind) => L.divIcon({ className: '', html: `<span class="rmap-pin ${kind || ''}">${label}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] });

// Mapa Leaflet. Com onPick, um toque no mapa (ou arrastar o pino) escolhe o local.
export function LeafletMap({ origin, stops = [], line, pick, onPick, height = 320, testid }) {
  const el = useRef(null), map = useRef(null), layer = useRef(null);
  const onPickRef = useRef(onPick); onPickRef.current = onPick;
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(MANAUS, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('click', e => onPickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    // Dentro de modal/painel que acabou de abrir o tamanho só fica certo depois do layout.
    const t = setTimeout(() => m.invalidateSize(), 120);
    return () => { clearTimeout(t); m.remove(); map.current = null; };
  }, []);
  const sig = JSON.stringify([origin && [origin.lat, origin.lng], stops.map(s => [s.lat, s.lng, s.label, s.kind]), line?.length, pick && [pick.lat, pick.lng]]);
  useEffect(() => {
    const m = map.current, g = layer.current; if (!m) return;
    g.clearLayers();
    const pts = [];
    if (line?.length) { L.polyline(line, { color: '#0a7cc4', weight: 5, opacity: 0.85 }).addTo(g); pts.push(...line); }
    if (hasPos(origin)) { L.marker([origin.lat, origin.lng], { icon: pinIcon('D', 'depot'), title: 'Ponto de saída' }).addTo(g); pts.push([origin.lat, origin.lng]); }
    stops.filter(hasPos).forEach(s => { L.marker([s.lat, s.lng], { icon: pinIcon(s.label, s.kind), title: s.title || '' }).addTo(g); pts.push([s.lat, s.lng]); });
    if (hasPos(pick)) {
      const mk = L.marker([pick.lat, pick.lng], { draggable: !!onPickRef.current, icon: pinIcon('●', 'pick') }).addTo(g);
      mk.on('dragend', () => { const p = mk.getLatLng(); onPickRef.current?.({ lat: p.lat, lng: p.lng }); });
      pts.push([pick.lat, pick.lng]);
    }
    if (pts.length === 1) m.setView(pts[0], hasPos(pick) ? Math.max(m.getZoom(), 16) : 15);
    else if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
  }, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className="rmap-map" style={{ height }} data-testid={testid} />;
}

// Painel da rota: mapa com o traçado, distância/tempo, detalhe de cada trecho, otimização e navegação.
// stops: [{key, seq, name, address, lat, lng, status: 'pending'|'done'|'failed'}] já na sequência de entrega.
export function RoutePanel({ origin, stops, onReorder, onLocate, onEditOrder, onSetOrigin, mapHeight = 320, testid = 'route-panel', compact }) {
  const pending = stops.filter(s => s.status === 'pending');
  const located = pending.filter(hasPos);
  const missing = pending.filter(s => !hasPos(s));
  const [route, setRoute] = useState(null), [routeErr, setRouteErr] = useState('');
  const [details, setDetails] = useState(!compact);
  const [proposal, setProposal] = useState(null), [optBusy, setOptBusy] = useState(false), [optErr, setOptErr] = useState('');
  const pathPoints = useMemo(() => [...(hasPos(origin) ? [origin] : []), ...located], [origin, located]);
  const pathSig = pathPoints.map(p => `${p.lat},${p.lng}`).join(';');
  useEffect(() => {
    let alive = true; setRouteErr('');
    if (pathPoints.length < 2) { setRoute(null); return; }
    osrmRoute(pathPoints).then(r => alive && setRoute(r)).catch(() => { if (alive) { setRoute(null); setRouteErr('Não foi possível traçar o caminho agora (sem internet ou serviço fora do ar). Os pontos continuam no mapa.'); } });
    return () => { alive = false; };
  }, [pathSig]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ordem ou local mudou: a sugestão anterior não vale mais.
  useEffect(() => { setProposal(null); setOptErr(''); }, [stops.map(s => s.key).join('|'), pathSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const link = googleMapsLink(null, pending);
  const markers = stops.map(s => ({ lat: s.lat, lng: s.lng, label: String(s.seq).padStart(2, '0'), kind: s.status === 'pending' ? '' : 'done', title: s.name }));
  const offset = hasPos(origin) ? 1 : 0;

  async function optimize() {
    setOptErr(''); setOptBusy(true);
    try {
      if (!hasPos(origin)) throw new Error('Cadastre o ponto de saída (depósito) para otimizar a sequência.');
      if (located.length < 2) throw new Error('São precisas ao menos 2 paradas pendentes com local no mapa.');
      const order = await osrmBestOrder([origin, ...located]);
      const best = order.filter(i => i > 0).map(i => located[i - 1]);
      const same = best.every((s, i) => s.key === located[i].key);
      if (same) { setProposal({ same: true }); return; }
      const [now, next] = await Promise.all([osrmRoute([origin, ...located]), osrmRoute([origin, ...best])]);
      const keys = [...stops.filter(s => s.status !== 'pending'), ...best, ...missing].map(s => s.key);
      setProposal({ keys, best, saved: now.distance - next.distance, next });
    } catch (e) { setOptErr(e.message === 'Sem otimização' || e.message === 'Sem traçado' || /^\d+$/.test(e.message) || e.name === 'TypeError' ? 'Não foi possível otimizar agora. Tente de novo em instantes.' : e.message); }
    finally { setOptBusy(false); }
  }

  return <div className={`rmap-panel${compact ? ' compact' : ''}`} data-testid={testid}>
    <div className="rmap-head">
      <span><b>Trajeto nas ruas</b><small>{pending.length} parada{pending.length === 1 ? '' : 's'} pendente{pending.length === 1 ? '' : 's'}{route ? ` · ${routeSummary(route)}` : ''}</small></span>
      {onSetOrigin && <button type="button" className="rmap-link" data-testid={`${testid}-origin`} onClick={onSetOrigin}>{hasPos(origin) ? 'Ponto de saída' : 'Definir ponto de saída'}</button>}
    </div>
    {link
      ? <a className="rmap-nav" href={link} target="_blank" rel="noreferrer" data-testid={`${testid}-gmaps`}>Navegar rota no Google Maps</a>
      : <span className="rmap-nav off">Sem paradas pendentes para navegar</span>}
    {pending.length > GMAPS_MAX_STOPS && <small className="rmap-note">O Google Maps abre as próximas {GMAPS_MAX_STOPS} paradas. Depois de entregá-las, toque de novo para as seguintes.</small>}
    {!hasPos(origin) && <small className="rmap-note">Sem ponto de saída cadastrado: o traçado começa na 1ª parada.</small>}
    <LeafletMap origin={origin} stops={markers} line={route?.line} height={mapHeight} testid={`${testid}-map`} />
    {routeErr && <small className="rmap-note warn">{routeErr}</small>}
    {missing.length > 0 && <div className="rmap-missing" data-testid={`${testid}-missing`}>
      <b>{missing.length} parada{missing.length === 1 ? '' : 's'} sem local no mapa</b>
      <small>Ficam fora do traçado e vão pelo endereço escrito no Google Maps. Informe o CEP ou marque no mapa:</small>
      {missing.map(s => <div key={s.key} className="rmap-missing-row"><span>{String(s.seq).padStart(2, '0')} · {s.name}</span>{onLocate && <button type="button" className="rmap-btn" data-testid={`${testid}-locate-${s.id || s.key}`} onClick={() => onLocate(s)}>Marcar local</button>}</div>)}
    </div>}
    <div className="rmap-actions">
      <button type="button" className="rmap-btn" data-testid={`${testid}-details-toggle`} onClick={() => setDetails(!details)}>{details ? 'Ocultar detalhes' : 'Ver detalhes da rota'}</button>
      {onReorder && <button type="button" className="rmap-btn" disabled={optBusy} data-testid={`${testid}-optimize`} onClick={optimize}>{optBusy ? 'Calculando…' : 'Otimizar sequência'}</button>}
      {onEditOrder && <button type="button" className="rmap-btn" data-testid={`${testid}-edit-order`} onClick={onEditOrder}>Alterar sequência</button>}
    </div>
    {optErr && <small className="rmap-note warn" data-testid={`${testid}-optimize-error`}>{optErr}</small>}
    {proposal?.same && <small className="rmap-note" data-testid={`${testid}-optimize-same`}>A sequência atual já é a mais curta.</small>}
    {proposal?.keys && <div className="rmap-proposal" data-testid={`${testid}-proposal`}>
      <b>Sequência sugerida{proposal.saved > 50 ? ` — economiza ${km(proposal.saved)}` : ''}</b>
      <small>{routeSummary(proposal.next)} · {proposal.best.map(s => s.name).join(' → ')}</small>
      <div className="rmap-actions"><button type="button" className="rmap-btn primary" data-testid={`${testid}-apply`} onClick={() => { onReorder(proposal.keys); setProposal(null); }}>Aplicar sequência</button><button type="button" className="rmap-btn" onClick={() => setProposal(null)}>Manter a atual</button></div>
    </div>}
    {details && <ol className="rmap-legs" data-testid={`${testid}-legs`}>
      {stops.filter(s => s.status !== 'pending').map(s => <li key={s.key} className="done"><span className="rmap-seq">{String(s.seq).padStart(2, '0')}</span><span><b>{s.name}</b><small>{s.status === 'failed' ? 'Não entregue' : 'Entregue'}</small></span></li>)}
      {pending.map(s => {
        const li = located.indexOf(s), leg = route && li >= 0 ? route.legs[li + offset - 1] : null;
        return <li key={s.key}><span className="rmap-seq">{String(s.seq).padStart(2, '0')}</span><span><b>{s.name}</b><small>{s.address || 'sem endereço'}</small></span><span className="rmap-leg">{leg ? `${km(leg.distance)} · ${mins(leg.duration)}` : !hasPos(s) ? 'sem local' : ''}</span></li>;
      })}
      {route && <li className="total"><span /><span><b>Total</b></span><span className="rmap-leg">{routeSummary(route)}</span></li>}
    </ol>}
  </div>;
}

// Escolher o local: pelo CEP, pela posição atual do celular ou tocando/arrastando o pino no mapa.
export function LocationModal({ title, subtitle, initial, address, onClose, onSave, testid = 'location-modal' }) {
  const [cep, setCep] = useState(fmtCep(initial?.cep || ''));
  const [pos, setPos] = useState(hasPos(initial) ? { lat: Number(initial.lat), lng: Number(initial.lng) } : null);
  const [found, setFound] = useState(null), [busy, setBusy] = useState(false), [err, setErr] = useState('');
  async function buscar() {
    setErr(''); setBusy(true);
    try { const r = await lookupCep(cep); setFound(r); if (hasPos(r)) setPos({ lat: r.lat, lng: r.lng }); else setErr('CEP encontrado, mas sem posição. Toque no mapa para marcar o local.'); }
    catch (e) { setErr(e.message || 'Não foi possível consultar o CEP.'); }
    finally { setBusy(false); }
  }
  async function porEndereco() {
    setErr(''); setBusy(true);
    try { const r = await geocode(address); if (r) setPos(r); else setErr('Endereço não encontrado no mapa. Use o CEP ou toque no mapa.'); }
    catch { setErr('Não foi possível buscar o endereço agora.'); }
    finally { setBusy(false); }
  }
  function aqui() {
    if (!navigator.geolocation) return setErr('Este aparelho não informa a localização.');
    setErr(''); setBusy(true);
    navigator.geolocation.getCurrentPosition(p => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setBusy(false); }, () => { setErr('Não foi possível pegar a localização. Verifique a permissão de localização do navegador.'); setBusy(false); }, { enableHighAccuracy: true, timeout: 15000 });
  }
  async function salvar() {
    if (!hasPos(pos)) return setErr('Informe o CEP ou toque no mapa para marcar o local.');
    setErr(''); setBusy(true);
    try { await onSave({ cep: onlyDigits(cep) || undefined, lat: pos.lat, lng: pos.lng, found }); }
    catch (e) { setErr(e?.response?.data?.detail || e.message || 'Não foi possível salvar o local.'); setBusy(false); }
  }
  return <div className="rmap-backdrop" data-testid={testid}><div className="rmap-modal" role="dialog" aria-label={title}>
    <button type="button" className="rmap-close" aria-label="Fechar" onClick={onClose} data-testid={`${testid}-close`}>×</button>
    <b className="rmap-title">{title}</b>
    {subtitle && <small className="rmap-sub">{subtitle}</small>}
    <div className="rmap-cep">
      <input inputMode="numeric" placeholder="00000-000" aria-label="CEP" value={cep} data-testid={`${testid}-cep`} onChange={e => setCep(fmtCep(e.target.value))} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }} />
      <button type="button" className="rmap-btn primary" disabled={busy || onlyDigits(cep).length !== 8} data-testid={`${testid}-cep-search`} onClick={buscar}>Buscar CEP</button>
    </div>
    {found && <small className="rmap-sub" data-testid={`${testid}-cep-result`}>{cepAddress(found)}</small>}
    <div className="rmap-actions">
      <button type="button" className="rmap-btn" disabled={busy} data-testid={`${testid}-here`} onClick={aqui}>Usar minha localização</button>
      {address && <button type="button" className="rmap-btn" disabled={busy} data-testid={`${testid}-by-address`} onClick={porEndereco}>Buscar pelo endereço</button>}
    </div>
    <LeafletMap pick={pos} onPick={setPos} height={300} testid={`${testid}-map`} />
    <small className="rmap-sub">Toque no mapa ou arraste o pino até a porta do cliente.</small>
    {err && <small className="rmap-note warn" data-testid={`${testid}-error`}>{err}</small>}
    <div className="rmap-actions end">
      <button type="button" className="rmap-btn" onClick={onClose}>Cancelar</button>
      <button type="button" className="rmap-btn primary" disabled={busy || !hasPos(pos)} data-testid={`${testid}-save`} onClick={salvar}>Salvar local</button>
    </div>
  </div></div>;
}

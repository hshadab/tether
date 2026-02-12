import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════ */

const SCENARIOS = [
  { key:'normal',             label:'Normal Flow',        expected:200,
    desc:'Agent payment within policy — proof and params match.',
    oneLiner:'Agent pays for an API call within spending policy — all fields match the proof binding.',
    tamperField:null, tamperFrom:null, tamperTo:null },
  { key:'tampered_amount',    label:'Tampered Amount',    expected:403,
    desc:'Compromised API inflates 0.0001 to 10 USDT0.',
    oneLiner:'A compromised API inflates the price after the agent\u2019s proof was generated.',
    tamperField:'amount', tamperFrom:'100', tamperTo:'10,000,000' },
  { key:'tampered_recipient', label:'Tampered Recipient', expected:403,
    desc:'Man-in-the-middle redirects to 0xdEaD.',
    oneLiner:'A man-in-the-middle redirects the agent\u2019s payment to a different address.',
    tamperField:'payTo', tamperFrom:null, tamperTo:null },
];

const PIPE = [
  { id:'wallet',   label:'WDK Wallet',      color:'#50AF95', icon:'W' },
  { id:'prover',   label:'zkML Prover',      color:'#8b5cf6', icon:'P' },
  { id:'server',   label:'x402 Server',      color:'#3b82f6', icon:'S' },
  { id:'binding',  label:'Binding Check',    color:'#f59e0b', icon:'B' },
  { id:'cosigner', label:'Cosigner',         color:'#06b6d4', icon:'C' },
  { id:'plasma',   label:'Plasma',           color:'#50AF95', icon:'$' },
];

const EV_MAP = {
  flow_reset:            { node:0, dir:-1 },
  zkml_proof_generating: { node:1, dir:0 },
  zkml_proof_received:   { node:1, dir:1 },
  payment_required:      { node:2, dir:0 },
  verify_started:        { node:2, dir:2 },
  zkml_binding_check:    { node:3, dir:3 },
  zkml_proof_rejected:   { node:3, dir:3 },
  zkml_proof_verified:   { node:4, dir:4 },
  settlement_pending:    { node:5, dir:5 },
  settlement_completed:  { node:5, dir:5 },
  verify_completed:      { node:5, dir:5 },
};

const BFIELDS = ['amount','payTo','chainId','token'];

/* ── on-chain ─────────────────────────────────────────────────────── */

const EXP   = 'https://plasmascan.to';
const RPC   = 'https://rpc.plasma.to';
const USDT0 = '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb';
const CLI_ADDR = '0x0c24ba337170D9fe066757e9F0007938e4975bdb';
const SRV_ADDR = '0x8e473885423bb172c20c399834763d8DA8d24874';
const ATK_ADDR = '0x000000000000000000000000000000000000dEaD';
const PRICE = '0.0001';
const DEC = 6;

/* ── Dwell times (ms) — presentation pacing ───────────────────────── */
const INTRO_DWELL    = 7000;
const CARD_DWELL     = 8000;
const OVERVIEW_DWELL = 12000;
const PAUSE_BETWEEN  = 2500;
const FADE_MS        = 400;
const WAIT_TIMEOUT   = 30000;

/* ── helpers ──────────────────────────────────────────────────────── */

const BAL_SIG = '0x70a08231';
async function fetchBal(addr) {
  const pad = addr.replace('0x','').toLowerCase().padStart(64,'0');
  try {
    const r = await fetch(RPC, { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_call', params:[{to:USDT0,data:BAL_SIG+pad},'latest'] }) });
    const j = await r.json();
    if (j.result) return BigInt(j.result);
  } catch {}
  return null;
}
function fmtB(raw) {
  if (raw == null) return '—';
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const s = abs.toString().padStart(DEC+1,'0');
  const w = s.slice(0, s.length-DEC) || '0';
  const f = s.slice(s.length-DEC).replace(/0+$/,'').padEnd(4,'0');
  return `${neg?'-':''}${w}.${f}`;
}
function short(a) { return a ? a.slice(0,6)+'…'+a.slice(-4) : ''; }
function Lnk({addr,label}) {
  return <a href={`${EXP}/address/${addr}`} target="_blank" rel="noopener noreferrer" style={S.link} title={addr}>{label||short(addr)}</a>;
}
function fmt(v) { const s=String(v||''); return s.length>22 ? s.slice(0,10)+'…'+s.slice(-8) : s; }
function hexStr(n) { let s=''; const c='0123456789abcdef'; for(let i=0;i<n;i++) s+=c[Math.random()*16|0]; return s; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ═══════════════════════════════════════════════════════════════════════
   APP COMPONENT
   ═══════════════════════════════════════════════════════════════════════ */

function App() {
  /* ── persistent state ──────────────────────────────────────────── */
  const [sse, setSse]         = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase]     = useState('idle');       // idle | running | complete
  const [scIdx, setScIdx]     = useState(-1);
  const [results, setResults] = useState({});           // {normal:'success', ...}

  /* balances — persistent across everything */
  const [cBal, setCBal]       = useState(null);
  const [sBal, setSBal]       = useState(null);
  const [cSnap, setCSnap]     = useState(null);
  const [sSnap, setSSnap]     = useState(null);

  /* pipeline strip */
  const [aNode, setANode]     = useState(-1);
  const [doneN, setDoneN]     = useState(new Set());
  const [fDir, setFDir]       = useState(-1);

  /* center stage — the big presentation area */
  const [card, setCard]       = useState({ type:'welcome' });
  const [cardKey, setCardKey] = useState(0);
  const [fadeClass, setFadeClass] = useState('visible');

  /* data accumulated per scenario — use refs so play() closure always has latest */
  const [bData, setBData]     = useState(null);
  const [stamp, setStamp]     = useState(null);
  const [coSig, setCoSig]     = useState(null);
  const bDataRef = useRef(null);
  const coSigRef = useRef(null);
  const txHashRef = useRef(null);
  const [txHash, setTxHash] = useState(null);

  const complRef = useRef(null);
  const pendingEvents = useRef({});
  const proveTimerRef = useRef(null);
  const [proveElapsed, setProveElapsed] = useState(0);
  const proofHex = useMemo(() => { const h = hexStr(120); return h+h; }, []);

  /* ── balance fetch ──────────────────────────────────────────────── */
  const refreshBal = useCallback(async () => {
    const [c,s] = await Promise.all([fetchBal(CLI_ADDR), fetchBal(SRV_ADDR)]);
    setCBal(c); setSBal(s);
    return {client:c, server:s};
  }, []);

  useEffect(() => { refreshBal(); const iv = setInterval(refreshBal, 15000); return () => clearInterval(iv); }, [refreshBal]);

  /* ── SSE: event-driven — resolves waitForEvent promises ─────────── */
  useEffect(() => {
    const es = new EventSource('/events');
    es.onopen  = () => setSse(true);
    es.onerror = () => setSse(false);
    es.onmessage = (e) => {
      let ev; try { ev = JSON.parse(e.data); } catch { return; }

      /* update pipeline strip */
      const m = EV_MAP[ev.step];
      if (m) {
        if (ev.step === 'verify_completed') {
          if (ev.status === 'success') {
            setANode(5); setDoneN(new Set([0,1,2,3,4,5])); setFDir(5);
          }
          if (complRef.current) { complRef.current(ev); complRef.current = null; }
        } else {
          setANode(m.node); setFDir(m.dir);
          if (m.dir >= 0) setDoneN(p => { const n = new Set(p); for(let i=0;i<m.node;i++) n.add(i); return n; });
        }
      }

      /* capture binding data */
      if (ev.step === 'zkml_binding_check') { setBData(ev.details); bDataRef.current = ev.details; }
      if (ev.step === 'zkml_proof_rejected') setStamp('REJECTED');
      if (ev.step === 'zkml_proof_verified' && ev.details?.signature) { setCoSig(ev.details.signature); coSigRef.current = ev.details.signature; }
      if (ev.step === 'settlement_completed' && ev.status === 'success' && ev.details?.txHash) { setTxHash(ev.details.txHash); txHashRef.current = ev.details.txHash; }

      /* resolve pending waitForEvent promises */
      const waiters = pendingEvents.current[ev.step];
      if (waiters && waiters.length > 0) {
        for (const resolve of waiters) resolve(ev);
        delete pendingEvents.current[ev.step];
      }
    };
    return () => es.close();
  }, []);

  /* ── card transition helper ─────────────────────────────────────── */
  const showCard = useCallback(async (newCard, dwellMs) => {
    setFadeClass('');
    await delay(FADE_MS);
    setCard(newCard);
    setCardKey(k => k+1);
    setFadeClass('visible');
    if (dwellMs > 0) await delay(dwellMs);
  }, []);

  /* ── autoplay ───────────────────────────────────────────────────── */
  const waitDone = useCallback(() => new Promise(r => { complRef.current = r; }), []);

  const waitForEvent = useCallback((step) => {
    const eventPromise = new Promise(resolve => {
      if (!pendingEvents.current[step]) pendingEvents.current[step] = [];
      pendingEvents.current[step].push(resolve);
    });
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout waiting for ${step}`)), WAIT_TIMEOUT)
    );
    return Promise.race([eventPromise, timeout]).catch(() => null);
  }, []);

  const startProveTimer = useCallback(() => {
    setProveElapsed(0);
    proveTimerRef.current = setInterval(() => setProveElapsed(t => t + 1), 1000);
  }, []);

  const stopProveTimer = useCallback(() => {
    if (proveTimerRef.current) { clearInterval(proveTimerRef.current); proveTimerRef.current = null; }
  }, []);

  const play = useCallback(async () => {
    setRunning(true); setPhase('running'); setResults({});
    setANode(-1); setDoneN(new Set()); setFDir(-1);
    setBData(null); setStamp(null); setCoSig(null); setTxHash(null);
    bDataRef.current = null; coSigRef.current = null; txHashRef.current = null;

    const snap = await refreshBal();
    setCSnap(snap.client); setSSnap(snap.server);

    /* ── WELCOME CARD with architecture overview ── */
    await showCard({ type:'overview' }, OVERVIEW_DWELL);

    for (let i = 0; i < SCENARIOS.length; i++) {
      const sc = SCENARIOS[i];
      setScIdx(i);
      setANode(-1); setDoneN(new Set()); setFDir(-1);
      setBData(null); setStamp(null); setCoSig(null); setTxHash(null);
      bDataRef.current = null; coSigRef.current = null; txHashRef.current = null;
      stopProveTimer();

      /* ── INTRO CARD: explain what's about to happen ── */
      await showCard({ type:'intro', sc, idx:i }, INTRO_DWELL);

      /* ── Register event listeners BEFORE firing the request ── */
      const evProving   = waitForEvent('zkml_proof_generating');
      const evProved    = waitForEvent('zkml_proof_received');
      const evPayReq    = waitForEvent('payment_required');
      const evComplete  = waitDone();

      /* ── Fire the scenario (don't await the fetch response) ── */
      fetch('/demo/start-flow', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({scenario:sc.key}) });

      /* ── Wait for "proving" event → show proving card ── */
      await evProving;
      startProveTimer();
      await showCard({ type:'action', step:'proving', sc, label:'Generating zkML proof…', sub:'ONNX model running inside Jolt-Atlas zkVM (ICME Labs)' }, 0);

      /* ── Wait for proof generated → show request card ── */
      const proofEv = await evProved;
      stopProveTimer();
      await showCard({ type:'action', step:'request', sc, label:'Agent sends GET /weather', sub:'Autonomous HTTP request with x402 payment + ZK proof headers', proofMeta: proofEv?.details }, 0);

      /* ── Wait for 402 → brief dwell → show verify card ── */
      await evPayReq;
      await delay(1500);
      await showCard({ type:'action', step:'verify', sc, label:'Server verifying agent payment + proof binding…', sub:'SHA-256(amount | payTo | chainId | token | proofHash)' }, 0);

      /* ── Wait for completion ── */
      const result = await evComplete;
      const status = result?.status || 'failure';
      setResults(r => ({...r,[sc.key]:status}));

      /* ── RESULT CARD ── */
      if (status === 'success') {
        await showCard({ type:'result_ok', sc, bData:bDataRef.current, coSig:coSigRef.current, txHash:txHashRef.current }, CARD_DWELL);
        setStamp('VERIFIED');
      } else {
        await showCard({ type:'result_fail', sc, bData:bDataRef.current, stamp:'REJECTED' }, CARD_DWELL);
        setStamp('REJECTED');
      }

      /* refresh balances after each scenario */
      await refreshBal();

      if (i < SCENARIOS.length - 1) await delay(PAUSE_BETWEEN);
    }

    /* ── SUMMARY ── */
    await refreshBal();
    setPhase('complete'); setRunning(false); setScIdx(-1);
    await showCard({ type:'summary' }, 0);
  }, [waitDone, waitForEvent, refreshBal, showCard, startProveTimer, stopProveTimer]);

  /* ── deltas ─────────────────────────────────────────────────────── */
  const cDelta = (cSnap!=null && cBal!=null) ? cBal-cSnap : null;
  const sDelta = (sSnap!=null && sBal!=null) ? sBal-sSnap : null;

  /* ═══════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════ */
  return (
    <div style={S.root}>
      <style>{KF}</style>

      {/* ════ PERSISTENT HEADER ════ */}
      <header style={S.hdr}>
        <div style={S.hdrLeft}>
          <span style={S.wm}>Trustless Agentic x402 USDT Payments</span>
        </div>
        <div style={S.hdrCenter}>
          {['WDK','USDT0','Plasma','x402'].map(b => <span key={b} style={S.pill}>{b}</span>)}
          <span style={S.sseBadge}><span style={{...S.sseDot, background: sse?'#50AF95':'#ef4444'}}/> <a href={EXP} target="_blank" rel="noopener noreferrer" style={{...S.link,fontSize:'0.65rem'}}>Plasma 9745</a></span>
        </div>
        <div style={S.hdrRight}>
          <button style={{...S.playBtn, opacity:running?.5:1, cursor:running?'not-allowed':'pointer', animation:!running?'pulse-green 2s infinite':'none'}} disabled={running} onClick={play}>
            {running ? 'RUNNING…' : phase==='complete' ? 'REPLAY' : 'PLAY'}
          </button>
        </div>
      </header>

      {/* ════ SCENARIO BANNER — prominent indicator of current scenario ════ */}
      {running && scIdx>=0 && (() => {
        const sc = SCENARIOS[scIdx];
        const isAttack = sc.expected === 403;
        const accentColor = isAttack ? '#ef4444' : '#50AF95';
        return (
          <div style={{...S.scenarioBanner, borderColor: accentColor+'60', background: accentColor+'0a'}}>
            <span style={{...S.scenarioBannerNum, background: accentColor+'20', color: accentColor, borderColor: accentColor+'40'}}>
              {scIdx+1}/{SCENARIOS.length}
            </span>
            <span style={{...S.scenarioBannerName, color: accentColor}}>{sc.label}</span>
            <span style={S.scenarioBannerSep}>—</span>
            <span style={S.scenarioBannerDesc}>{sc.desc}</span>
            <span style={{...S.scenarioBannerExpected, background: accentColor+'18', color: accentColor, borderColor: accentColor+'30'}}>
              Expected: {sc.expected}
            </span>
          </div>
        );
      })()}

      {/* ════ PERSISTENT BALANCE STRIP ════ */}
      <div style={S.balStrip}>
        <div style={{...S.balCard, borderColor:'#3b82f6'}}>
          <div style={S.balTop}>
            <span style={{...S.balRole,color:'#3b82f6'}}>Agent Wallet</span>
            <a href={`${EXP}/address/${CLI_ADDR}`} target="_blank" rel="noopener noreferrer" style={S.balExplorer} title="View on Plasma Explorer">{short(CLI_ADDR)} ↗</a>
          </div>
          <div style={S.balBottom}>
            <span style={S.balAmt}>{fmtB(cBal)} <span style={S.balUnit}>USDT0</span></span>
            {cDelta!=null && cDelta!==0n && <span style={{...S.balDelta, color:cDelta<0n?'#ef4444':'#50AF95'}}>{cDelta<0n?'':'+'}{fmtB(cDelta)}</span>}
          </div>
        </div>
        <div style={S.costCard}>
          <div style={S.costLabel}>Per API Call</div>
          <div style={S.costAmt}>{PRICE} USDT0</div>
          <div style={S.costSub}>100 units · <a href={`${EXP}/address/${USDT0}`} target="_blank" rel="noopener noreferrer" style={{...S.link,fontSize:'0.52rem'}}>token ↗</a></div>
        </div>
        <div style={{...S.balCard, borderColor:'#22c55e'}}>
          <div style={S.balTop}>
            <span style={{...S.balRole,color:'#22c55e'}}>Merchant Wallet</span>
            <a href={`${EXP}/address/${SRV_ADDR}`} target="_blank" rel="noopener noreferrer" style={S.balExplorer} title="View on Plasma Explorer">{short(SRV_ADDR)} ↗</a>
          </div>
          <div style={S.balBottom}>
            <span style={S.balAmt}>{fmtB(sBal)} <span style={S.balUnit}>USDT0</span></span>
            {sDelta!=null && sDelta!==0n && <span style={{...S.balDelta, color:sDelta>0n?'#50AF95':'#ef4444'}}>{sDelta>0n?'+':''}{fmtB(sDelta)}</span>}
          </div>
        </div>
      </div>

      {/* ════ PERSISTENT PIPELINE STRIP ════ */}
      <div style={S.pipeWrap}>
        {PIPE.map((nd,i) => (
          <React.Fragment key={nd.id}>
            <div style={{...S.pNode, borderColor: doneN.has(i)?nd.color:aNode===i?nd.color:'#334155', background: doneN.has(i)?nd.color+'18':aNode===i?nd.color+'28':'transparent', transform:aNode===i?'scale(1.12)':'scale(1)', boxShadow:aNode===i?`0 0 16px ${nd.color}50`:'none', transition:'all 0.4s'}}>
              <span style={{...S.pIcon, color: doneN.has(i)||aNode===i?nd.color:'#64748b'}}>{doneN.has(i)?'\u2713':nd.icon}</span>
              <span style={{...S.pLabel, color: doneN.has(i)||aNode===i?'#e2e8f0':'#64748b'}}>{nd.label}</span>
            </div>
            {i<PIPE.length-1 && (
              <div style={S.conn}>
                <div style={{...S.connLine, background: fDir>=i+1?nd.color+'60':'#1e293b'}}/>
                {fDir>=i+1 && <div style={{...S.connDot,background:nd.color}}/>}
              </div>
            )}
          </React.Fragment>
        ))}
        <div style={S.scDots}>
          {SCENARIOS.map((s,i) => {
            const r = results[s.key];
            return <div key={s.key} style={{...S.scDot, background: r==='success'?'#50AF95':r==='failure'?'#ef4444': running&&scIdx===i?'#3b82f680':'#1e293b', borderColor: r==='success'?'#50AF95':r==='failure'?'#ef4444': running&&scIdx===i?'#3b82f6':'#334155'}} title={s.label}/>;
          })}
        </div>
      </div>

      {/* ════ CENTER STAGE — the presentation area ════ */}
      <div style={{...S.stage, opacity: fadeClass==='visible'?1:0, transition:`opacity ${FADE_MS}ms ease`}} key={cardKey}>
        {renderCard(card, proofHex)}
      </div>

      {/* ════ FOOTER ════ */}
      <footer style={S.footer}>
        <span style={S.fBrand}>Powered by <b style={{color:'#50AF95'}}>Tether</b></span>
        <span style={S.fSep}>|</span>
        <span style={S.fItem}><span style={S.fLbl}>USDT0</span> <a href={`${EXP}/address/${USDT0}`} target="_blank" rel="noopener noreferrer" style={S.link}>{short(USDT0)} ↗</a></span>
        <span style={S.fItem}><span style={S.fLbl}>Agent</span> <a href={`${EXP}/address/${CLI_ADDR}`} target="_blank" rel="noopener noreferrer" style={S.link}>{short(CLI_ADDR)} ↗</a></span>
        <span style={S.fItem}><span style={S.fLbl}>Merchant</span> <a href={`${EXP}/address/${SRV_ADDR}`} target="_blank" rel="noopener noreferrer" style={S.link}>{short(SRV_ADDR)} ↗</a></span>
        <span style={S.fSep}>|</span>
        <span style={S.fItem}><a href={EXP} target="_blank" rel="noopener noreferrer" style={{...S.link,fontWeight:600}}>Plasma Explorer ↗</a></span>
      </footer>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════════════════════
   PROVE TIMER — elapsed timer shown during proof generation
   ═══════════════════════════════════════════════════════════════════════ */

function ProveTimer() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setElapsed(t => t + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  return (
    <div style={{ padding:'4px 10px', borderTop:'1px solid #334155', fontSize:'0.58rem', color:'#8b5cf6', fontWeight:700, display:'flex', justifyContent:'space-between' }}>
      <span>Elapsed: {elapsed}s</span>
      <span style={{ color:'#64748b', fontWeight:400 }}>Real Jolt-Atlas zkVM prover (ICME Labs) — no simulation</span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CARD RENDERER — the big center-stage content
   ═══════════════════════════════════════════════════════════════════════ */

function renderCard(c, proofHex) {

  /* ── WELCOME ── */
  if (c.type === 'welcome') {
    return (
      <div style={S.welcomeCard}>
        <h1 style={S.welcomeTitle}>Trustless Agentic x402 USDT0 Payments</h1>
        <p style={S.welcomeText}>
          When AI agents spend USDT0 autonomously via x402, users need more than promises that spending policy was followed — they need proof. Every payment passes through a cryptographically verified spending guardrail: a ZK proof, generated by a Jolt-Atlas zkVM (ICME Labs) running an ML model, bound to the exact payment parameters. Change any field and the cryptographic guardrail rejects it.
        </p>
        <p style={S.welcomeSub}>
          Every proof is generated by a real Jolt-Atlas zkVM prover. Every payment settles real USDT0 on Plasma via EIP-3009. Watch the balances change.
        </p>
        <p style={S.welcomeSub}>
          Press <b>PLAY</b> to run 3 live scenarios: one legitimate agent payment and two attack attempts.
        </p>
        <div style={S.welcomePills}>
          <span style={S.wpill}><b style={{color:'#50AF95'}}>WDK</b> wallet signing</span>
          <span style={S.wpill}><b style={{color:'#50AF95'}}>USDT0</b> payments</span>
          <span style={S.wpill}><b style={{color:'#50AF95'}}>x402</b> HTTP 402</span>
          <span style={S.wpill}><b style={{color:'#8b5cf6'}}>Jolt-Atlas</b> zkVM proofs</span>
        </div>
        {/* model card */}
        <div style={S.modelCard}>
          <span style={S.modelLabel}>Agent Spending Policy</span>
          <span style={S.modelDetail}>3-layer neural net &middot; 64 features &middot; 12 KB ONNX</span>
          <span style={S.modelFeats}>budget, trust, velocity, amount, category, time</span>
        </div>
      </div>
    );
  }

  /* ── ARCHITECTURE OVERVIEW ── */
  if (c.type === 'overview') {
    return (
      <div style={S.overviewCard}>
        <div style={S.ovTitle}>How It Works</div>
        <div style={S.ovFlow}>
          {[
            { num:'1', title:'Agent requests data', desc:'The agent calls GET /weather — the API replies HTTP 402 Payment Required with USDT0 price and recipient address.', color:'#3b82f6' },
            { num:'2', title:'Agent generates a zkML proof via Jolt-Atlas (ICME Labs)', desc:'The Jolt-Atlas zkVM runs an ONNX ML model that evaluates agent spending policy and produces a cryptographic proof. The proof is SHA-256 bound to the exact payment parameters.', color:'#8b5cf6' },
            { num:'3', title:'Agent retries with payment + proof', desc:'HTTP headers carry both the signed USDT0 payment (X-Payment) and the zkML proof (X-ZK-Proof). The agent pays autonomously.', color:'#50AF95' },
            { num:'4', title:'Server enforces the cryptographically verified spending guardrail', desc:'Gate 1: Is the payment signature valid? Gate 2 (spending policy enforcement): Does the proof binding match the payment params? Did the agent stay within policy? If either fails \u2192 403.', color:'#f59e0b' },
            { num:'5', title:'Cosigner verifies Jolt-Atlas zkML proof', desc:'An independent Rust verifier confirms the Jolt-Atlas SNARK proof — the ML model genuinely ran and approved the agent\u2019s transaction.', color:'#06b6d4' },
            { num:'6', title:'USDT0 settlement on Plasma', desc:'The facilitator submits a transferWithAuthorization (EIP-3009) call on USDT0. Funds move on-chain, and the agent receives the data.', color:'#50AF95' },
          ].map((step,i) => (
            <div key={i} style={{...S.ovStep, animation:`slide-in 0.5s ease-out ${i*0.15}s both`}}>
              <div style={{...S.ovNum, background:step.color+'20', color:step.color, borderColor:step.color+'40'}}>{step.num}</div>
              <div>
                <div style={S.ovStepTitle}>{step.title}</div>
                <div style={S.ovStepDesc}>{step.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── SCENARIO INTRO ── */
  if (c.type === 'intro') {
    const { sc, idx } = c;
    const isAttack = sc.expected === 403;
    return (
      <div style={S.introCard}>
        <div style={S.introLabel}>Scenario {idx+1} of {SCENARIOS.length}</div>
        <div style={{...S.introName, color: isAttack?'#ef4444':'#50AF95'}}>{sc.label}</div>
        <div style={{...S.introExpected, color: isAttack?'#ef4444':'#50AF95'}}>Expected: {sc.expected} {isAttack?'Forbidden':'OK'}</div>
        <div style={S.introOneLiner}>{sc.oneLiner}</div>
        {isAttack && sc.tamperField === 'amount' && (
          <div style={S.tamperDiff}>
            <span style={S.tamperField}>amount</span>
            <span style={S.tamperFrom}>{sc.tamperFrom}</span>
            <span style={S.tamperArrow}>{'\u2192'}</span>
            <span style={S.tamperTo}>{sc.tamperTo}</span>
            <span style={S.tamperMult}>100,000x</span>
          </div>
        )}
        {isAttack && sc.tamperField === 'payTo' && (
          <div style={S.tamperDiff}>
            <span style={S.tamperField}>payTo</span>
            <span style={S.tamperFrom}><Lnk addr={SRV_ADDR} label="merchant"/></span>
            <span style={S.tamperArrow}>{'\u2192'}</span>
            <span style={S.tamperTo}><Lnk addr={ATK_ADDR} label="0xdEaD…"/></span>
          </div>
        )}
      </div>
    );
  }

  /* ── ACTION (in-progress animation) ── */
  if (c.type === 'action') {
    return (
      <div style={S.actionCard}>
        <div style={S.actionViz}>
          {c.step === 'proving' && (
            <div style={S.actionIcon}>
              <div style={{fontSize:'2rem',animation:'pulse-brain 2s infinite'}}>&#x1F9E0;</div>
            </div>
          )}
          {c.step === 'request' && (
            <div style={S.actionIcon}>
              <div style={{fontSize:'2rem',animation:'pulse-green 1.5s infinite'}}>&#x1F310;</div>
            </div>
          )}
          {c.step === 'verify' && (
            <div style={S.actionIcon}>
              <div style={{fontSize:'2rem',animation:'lock-pop 0.6s ease-out'}}>&#x1F50D;</div>
            </div>
          )}
        </div>
        <div style={S.actionLabel}>{c.label}</div>
        <div style={S.actionSub}>{c.sub}</div>
        <div style={S.actionDots}><span style={S.dot}/><span style={{...S.dot,animationDelay:'0.3s'}}/><span style={{...S.dot,animationDelay:'0.6s'}}/></div>
        {/* Proving console */}
        {c.step === 'proving' && (
          <div style={S.console}>
            <div style={S.conHdr}><span style={S.conDotR}/><span style={S.conDotY}/><span style={S.conDotG}/><span style={S.conTitle}>jolt-atlas zkvm prover</span></div>
            <div style={S.conBody}>
              <div style={{...S.conLn,animationDelay:'0.3s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>Loading ONNX model (12 KB, 3-layer neural net)...</span></div>
              <div style={{...S.conLn,animationDelay:'1.0s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>Running inference in Jolt-Atlas zkVM...</span></div>
              <div style={{...S.conLn,animationDelay:'2.0s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>Generating zkML proof...</span></div>
              <div style={{...S.conLn,animationDelay:'3.0s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>Creating SHA-256 payment binding...</span></div>
            </div>
            <ProveTimer />
          </div>
        )}
        {/* API console */}
        {c.step === 'request' && (
          <div style={S.console}>
            <div style={S.conHdr}><span style={S.conDotR}/><span style={S.conDotY}/><span style={S.conDotG}/><span style={S.conTitle}>network</span></div>
            <div style={S.conBody}>
              <div style={{...S.conLn,animationDelay:'0.5s'}}><span style={{...S.conM,...S.conMGet}}>GET</span><span style={S.conU}>/weather</span></div>
              <div style={{...S.conLn,animationDelay:'1.0s'}}><span style={S.conArrIn}>{'\u2190'}</span><span style={S.conD}>HTTP 402 Payment Required</span></div>
              <div style={{...S.conLn,animationDelay:'1.5s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>X-Payment: amount=100, payTo={short(SRV_ADDR)}, token=USDT0, network=eip155:9745</span></div>
              <div style={{...S.conLn,animationDelay:'2.0s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>X-ZK-Proof: [{c.proofMeta ? `${Math.round((c.proofMeta.proofSize||0)/1024)} KB` : '108 KB'} zkML proof, SHA-256 binding]{c.proofMeta?.fromCache ? ' (cached)' : ''}</span></div>
              <div style={{...S.conLn,animationDelay:'2.5s'}}><span style={{...S.conM,...S.conMGet}}>GET</span><span style={S.conU}>/weather  [retry with headers]</span></div>
            </div>
          </div>
        )}
        {c.step === 'verify' && (
          <div style={S.console}>
            <div style={S.conHdr}><span style={S.conDotR}/><span style={S.conDotY}/><span style={S.conDotG}/><span style={S.conTitle}>server verification</span></div>
            <div style={S.conBody}>
              <div style={{...S.conLn,animationDelay:'0.5s'}}><span style={S.conArrIn}>{'\u2190'}</span><span style={S.conD}>Gate 1: Verify EIP-3009 payment signature</span></div>
              <div style={{...S.conLn,animationDelay:'1.0s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>Signature valid</span></div>
              <div style={{...S.conLn,animationDelay:'1.5s'}}><span style={S.conArrIn}>{'\u2190'}</span><span style={S.conD}>Gate 2 (agent spending policy): Recompute binding = SHA-256(amount|payTo|chainId|token|proofHash)</span></div>
              <div style={{...S.conLn,animationDelay:'2.0s'}}><span style={S.conArrIn}>{'\u2190'}</span><span style={S.conD}>Compare proof.binding_hash === computed_hash — is agent within policy?</span></div>
              <div style={{...S.conLn,animationDelay:'2.5s'}}><span style={{...S.conM,...S.conMPost}}>POST</span><span style={S.conU}>localhost:3001/verify  [forward to cosigner]</span></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ── RESULT OK ── */
  if (c.type === 'result_ok') {
    return (
      <div style={S.resultCard}>
        <div style={{...S.resIcon, color:'#50AF95', animation:'ok-pulse 2s infinite'}}>{'\u2713'}</div>
        <div style={{...S.resTitle, color:'#50AF95'}}>200 OK — Agent Payment Authorized</div>
        <div style={S.resSub}>Agent spending policy verified. Proof binding matched. Settlement via EIP-3009 on Plasma.</div>
        <div style={S.resFlow}>
          <Lnk addr={CLI_ADDR} label="Agent"/> <span style={{margin:'0 10px', color:'#50AF95', fontWeight:700}}>{'\u2192'} {PRICE} USDT0 {'\u2192'}</span> <Lnk addr={SRV_ADDR} label="Merchant"/>
        </div>
        {c.txHash && (
          <div style={S.txRow}>
            <span style={S.txLabel}>TX</span>
            <a href={`${EXP}/tx/${c.txHash}`} target="_blank" rel="noopener noreferrer" style={S.txLink}>{c.txHash.slice(0,10)}...{c.txHash.slice(-8)} ↗</a>
            <span style={S.txMethod}>EIP-3009</span>
          </div>
        )}
        <div style={S.console}>
          <div style={S.conHdr}><span style={S.conDotR}/><span style={S.conDotY}/><span style={S.conDotG}/><span style={S.conTitle}>response</span></div>
          <div style={S.conBody}>
            <div style={{...S.conLn,animationDelay:'0.3s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>200 OK</span></div>
            <div style={{...S.conLn,animationDelay:'0.8s'}}><span style={S.conArrOut}>{'\u2192'}</span><span style={S.conDRes}>{`{"temperature":62,"conditions":"Partly cloudy","payment":{"verified":true,"zkProofValid":true}}`}</span></div>
          </div>
        </div>
      </div>
    );
  }

  /* ── RESULT FAIL ── */
  if (c.type === 'result_fail') {
    const bd = c.bData;
    return (
      <div style={S.resultCard}>
        <div style={{...S.resIcon, color:'#ef4444', animation:'rej-pulse 2s infinite'}}>{'\u2717'}</div>
        <div style={{...S.resTitle, color:'#ef4444'}}>403 — Agent Payment Rejected</div>
        <div style={S.resSub}>The SHA-256 binding hash diverges — the agent's payment parameters don't match the proof. Spending policy violated.</div>
        {bd && (
          <div style={S.bindTbl}>
            <div style={S.bHdrRow}><span style={S.bHdr}>Field</span><span style={S.bHdr}>Proof Binding</span><span style={S.bHdr}>Payment Params</span><span style={{...S.bHdr,textAlign:'center'}}></span></div>
            {BFIELDS.map((f,i) => {
              const pv = String(bd.proofBinding?.[f]??'');
              const av = String(bd.paymentParams?.[f]??'');
              const m  = pv.toLowerCase()===av.toLowerCase();
              return (
                <div key={f} style={{...S.bRow, animation: !m?`cell-mismatch 0.8s ease-out ${i*0.15}s both`:'none'}}>
                  <span style={S.bFld}>{f}</span>
                  <span style={{...S.bVal, color:m?'#50AF95':'#ef4444'}}>{(f==='payTo'||f==='token') ? <Lnk addr={pv}/> : fmt(pv)}</span>
                  <span style={{...S.bVal, color:m?'#50AF95':'#ef4444'}}>{(f==='payTo'||f==='token') ? <Lnk addr={av}/> : fmt(av)}</span>
                  <span style={{...S.bMatch, color:m?'#50AF95':'#ef4444'}}>{m?'\u2713':'\u2717'}</span>
                </div>
              );
            })}
          </div>
        )}
        <div style={S.rejStamp}>REJECTED</div>
        <div style={S.rejSub}>No funds moved. Cosigner never contacted.</div>
      </div>
    );
  }

  /* ── SUMMARY ── */
  if (c.type === 'summary') {
    return (
      <div style={S.summaryCard}>
        <div style={S.sumTitle}>All Scenarios Complete</div>
        <div style={S.sumSub}>Agents spend autonomously. Every payment is provably authorized. The cryptographic guardrail catches every tampered payment.</div>
        <div style={S.sumGrid}>
          {SCENARIOS.map((sc,i) => {
            const ok = sc.expected === 200;
            return (
              <div key={sc.key} style={{...S.sumCell, borderColor: ok?'#50AF95':'#ef4444', animation:`slide-in 0.4s ease-out ${i*0.15}s both`}}>
                <div style={{...S.sumCellIcon, color:ok?'#50AF95':'#ef4444'}}>{ok?'\u2713':'\u2717'}</div>
                <div style={S.sumCellName}>{sc.label}</div>
                <div style={{...S.sumCellStatus, color:ok?'#50AF95':'#ef4444'}}>{sc.expected}</div>
                <div style={S.sumCellDesc}>{sc.desc}</div>
              </div>
            );
          })}
        </div>
        <div style={S.sumTagline}>Agents pay autonomously — but change the amount, recipient, chain, or token, and the cryptographic guardrail rejects it. No proof, no payment.</div>
        <div style={S.sumReplay}>Press REPLAY to run again.</div>
      </div>
    );
  }

  return null;
}


/* ═══════════════════════════════════════════════════════════════════════
   KEYFRAMES
   ═══════════════════════════════════════════════════════════════════════ */

const KF = `
@keyframes pulse-green { 0%,100%{box-shadow:0 0 8px #50AF9540} 50%{box-shadow:0 0 24px #50AF9580, 0 0 48px #50AF9530} }
@keyframes pulse-brain { 0%,100%{transform:scale(1);text-shadow:0 0 12px rgba(139,92,246,0.3)} 50%{transform:scale(1.15);text-shadow:0 0 30px rgba(139,92,246,0.7)} }
@keyframes dot-flow { 0%{left:0%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:100%;opacity:0} }
@keyframes slide-in { 0%{opacity:0;transform:translateY(12px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes fade-in-scale { 0%{opacity:0;transform:scale(0.8)} 100%{opacity:1;transform:scale(1)} }
@keyframes cell-mismatch { 0%{background:rgba(239,68,68,0)} 30%{background:rgba(239,68,68,0.3)} 100%{background:rgba(239,68,68,0.05)} }
@keyframes lock-pop { 0%{opacity:0;transform:scale(0.3)} 50%{opacity:1;transform:scale(1.15)} 100%{opacity:1;transform:scale(1)} }
@keyframes rej-pulse { 0%,100%{text-shadow:0 0 20px rgba(239,68,68,0.3)} 50%{text-shadow:0 0 40px rgba(239,68,68,0.6)} }
@keyframes ok-pulse { 0%,100%{text-shadow:0 0 20px rgba(80,175,149,0.3)} 50%{text-shadow:0 0 40px rgba(80,175,149,0.6)} }
@keyframes ln-in { 0%{opacity:0;transform:translateY(3px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes dot-bounce { 0%,80%,100%{opacity:0.3;transform:scale(0.8)} 40%{opacity:1;transform:scale(1.2)} }
button:hover{filter:brightness(1.15)}
`;


/* ═══════════════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════════════ */

const S = {
  root: { maxWidth:1100, margin:'0 auto', padding:'0 24px 32px', minHeight:'100vh', background:'#0a0f1a', color:'#e2e8f0', fontFamily:"'Inter','SF Pro Display',-apple-system,sans-serif" },
  link: { color:'#50AF95', textDecoration:'none', borderBottom:'1px dotted rgba(80,175,149,0.4)', fontSize:'inherit', fontFamily:'inherit' },

  /* header */
  hdr: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0', borderBottom:'1px solid #1e293b' },
  hdrLeft: { display:'flex', alignItems:'baseline', gap:10 },
  wm: { fontSize:'1.05rem', fontWeight:800, color:'#50AF95', letterSpacing:'-0.02em', whiteSpace:'nowrap' },
  hdrCenter: { display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', justifyContent:'center' },
  pill: { padding:'2px 12px', borderRadius:16, fontSize:'0.62rem', fontWeight:700, color:'#50AF95', background:'rgba(80,175,149,0.08)', border:'1px solid rgba(80,175,149,0.2)' },
  sseBadge: { display:'flex', alignItems:'center', gap:4, fontSize:'0.62rem', color:'#64748b' },
  sseDot: { width:6, height:6, borderRadius:'50%', display:'inline-block' },
  hdrRight: { display:'flex', alignItems:'center', gap:12 },
  playBtn: { padding:'10px 36px', fontSize:'0.85rem', fontWeight:800, color:'#0a0f1a', background:'linear-gradient(135deg,#50AF95,#009393)', border:'none', borderRadius:8, letterSpacing:'0.06em', textTransform:'uppercase', cursor:'pointer' },

  /* scenario banner */
  scenarioBanner: { display:'flex', alignItems:'center', gap:12, padding:'10px 16px', border:'1px solid', borderRadius:8, margin:'10px 0 0', animation:'fade-in-scale 0.4s ease-out' },
  scenarioBannerNum: { fontSize:'0.72rem', fontWeight:800, padding:'3px 10px', borderRadius:6, border:'1px solid', flexShrink:0, letterSpacing:'0.02em' },
  scenarioBannerName: { fontSize:'0.92rem', fontWeight:800, letterSpacing:'-0.01em', flexShrink:0 },
  scenarioBannerSep: { color:'#334155', fontSize:'0.8rem' },
  scenarioBannerDesc: { fontSize:'0.72rem', color:'#94a3b8', lineHeight:1.4, flex:1 },
  scenarioBannerExpected: { fontSize:'0.62rem', fontWeight:700, padding:'3px 10px', borderRadius:5, border:'1px solid', flexShrink:0, letterSpacing:'0.03em' },

  /* balance strip */
  balStrip: { display:'flex', gap:10, padding:'12px 0', borderBottom:'1px solid #1e293b', alignItems:'stretch' },
  balCard: { flex:1, border:'1px solid #1e293b', borderRadius:8, padding:'10px 14px', background:'rgba(255,255,255,0.02)', display:'flex', flexDirection:'column', gap:6 },
  balTop: { display:'flex', alignItems:'center', justifyContent:'space-between' },
  balRole: { fontSize:'0.6rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em' },
  balExplorer: { fontSize:'0.62rem', color:'#50AF95', textDecoration:'none', fontFamily:"'SF Mono','Fira Code',monospace", letterSpacing:'-0.02em', padding:'2px 6px', borderRadius:4, background:'rgba(80,175,149,0.08)', border:'1px solid rgba(80,175,149,0.2)', transition:'background 0.2s' },
  balBottom: { display:'flex', alignItems:'baseline', gap:8 },
  balAmt: { fontSize:'1.1rem', fontWeight:800, color:'#e2e8f0', letterSpacing:'-0.02em' },
  balUnit: { fontSize:'0.62rem', fontWeight:600, color:'#64748b' },
  balDelta: { fontSize:'0.72rem', fontWeight:700, animation:'fade-in-scale 0.4s ease-out' },
  costCard: { border:'1px solid #1e293b', borderRadius:8, padding:'8px 18px', background:'rgba(255,255,255,0.02)', textAlign:'center', display:'flex', flexDirection:'column', justifyContent:'center', minWidth:120 },
  costLabel: { fontSize:'0.55rem', fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.06em' },
  costAmt: { fontSize:'1.1rem', fontWeight:800, color:'#f59e0b' },
  costSub: { fontSize:'0.52rem', color:'#475569' },

  /* pipeline strip */
  pipeWrap: { display:'flex', alignItems:'center', justifyContent:'center', padding:'14px 0', gap:0, borderBottom:'1px solid #1e293b' },
  pNode: { display:'flex', alignItems:'center', gap:6, padding:'6px 12px', border:'1.5px solid #334155', borderRadius:8, flexShrink:0 },
  pIcon: { fontSize:'0.75rem', fontWeight:800, width:18, textAlign:'center' },
  pLabel: { fontSize:'0.58rem', fontWeight:600 },
  conn: { position:'relative', width:24, height:2, flexShrink:0 },
  connLine: { position:'absolute', top:0, left:0, right:0, height:2, borderRadius:1 },
  connDot: { position:'absolute', top:-3, width:6, height:6, borderRadius:'50%', animation:'dot-flow 1s linear infinite' },
  scDots: { display:'flex', gap:5, marginLeft:16 },
  scDot: { width:10, height:10, borderRadius:'50%', border:'1.5px solid', transition:'all 0.3s' },

  /* center stage */
  stage: { minHeight:400, padding:'30px 0', display:'flex', justifyContent:'center', alignItems:'flex-start' },

  /* welcome card */
  welcomeCard: { maxWidth:600, textAlign:'center', padding:'20px 0' },
  welcomeTitle: { fontSize:'1.4rem', fontWeight:800, color:'#50AF95', margin:'0 0 10px', letterSpacing:'-0.02em' },
  welcomeText: { fontSize:'0.82rem', color:'#cbd5e1', lineHeight:1.6, margin:'0 0 10px' },
  welcomeSub: { fontSize:'0.75rem', color:'#94a3b8', lineHeight:1.5, margin:'0 0 18px' },
  welcomePills: { display:'flex', gap:8, justifyContent:'center', flexWrap:'wrap', marginBottom:16 },
  wpill: { fontSize:'0.65rem', color:'#94a3b8', padding:'3px 10px', background:'rgba(255,255,255,0.03)', borderRadius:6, border:'1px solid #1e293b' },

  /* model card */
  modelCard: { display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:'8px 16px', background:'rgba(139,92,246,0.06)', border:'1px solid rgba(139,92,246,0.2)', borderRadius:8, flexWrap:'wrap' },
  modelLabel: { fontSize:'0.58rem', fontWeight:700, color:'#8b5cf6', textTransform:'uppercase', letterSpacing:'0.06em' },
  modelDetail: { fontSize:'0.68rem', color:'#cbd5e1' },
  modelFeats: { fontSize:'0.6rem', color:'#94a3b8', fontFamily:"'SF Mono','Fira Code',monospace" },

  /* overview card */
  overviewCard: { maxWidth:680, width:'100%' },
  ovTitle: { fontSize:'1.2rem', fontWeight:800, color:'#e2e8f0', textAlign:'center', marginBottom:20, letterSpacing:'-0.02em' },
  ovFlow: { display:'flex', flexDirection:'column', gap:12 },
  ovStep: { display:'flex', gap:14, alignItems:'flex-start' },
  ovNum: { width:32, height:32, borderRadius:'50%', border:'1.5px solid', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.82rem', fontWeight:800, flexShrink:0 },
  ovStepTitle: { fontSize:'0.85rem', fontWeight:700, color:'#e2e8f0', marginBottom:2 },
  ovStepDesc: { fontSize:'0.72rem', color:'#94a3b8', lineHeight:1.5 },

  /* intro card */
  introCard: { maxWidth:500, textAlign:'center', padding:'10px 0' },
  introLabel: { fontSize:'0.62rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#64748b', marginBottom:8 },
  introName: { fontSize:'1.5rem', fontWeight:800, letterSpacing:'-0.02em', marginBottom:6 },
  introExpected: { fontSize:'0.85rem', fontWeight:700, marginBottom:12 },
  introOneLiner: { fontSize:'0.82rem', color:'#cbd5e1', lineHeight:1.5, marginBottom:16 },
  tamperDiff: { display:'flex', alignItems:'center', justifyContent:'center', gap:10, padding:'10px 18px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:8, fontFamily:"'SF Mono','Fira Code',monospace", fontSize:'0.78rem' },
  tamperField: { color:'#64748b', fontWeight:600 },
  tamperFrom: { color:'#50AF95' },
  tamperArrow: { color:'#ef4444', fontWeight:800, fontSize:'1rem' },
  tamperTo: { color:'#ef4444', fontWeight:700 },
  tamperMult: { color:'#fbbf24', fontSize:'0.62rem', fontWeight:700, padding:'1px 6px', background:'rgba(251,191,36,0.1)', borderRadius:3, border:'1px solid rgba(251,191,36,0.2)' },

  /* action card */
  actionCard: { maxWidth:600, textAlign:'center', width:'100%' },
  actionViz: { marginBottom:12 },
  actionIcon: { display:'flex', justifyContent:'center' },
  actionLabel: { fontSize:'1rem', fontWeight:700, color:'#e2e8f0', marginBottom:4 },
  actionSub: { fontSize:'0.72rem', color:'#94a3b8', marginBottom:14, fontFamily:"'SF Mono','Fira Code',monospace" },
  actionDots: { display:'flex', justifyContent:'center', gap:6, marginBottom:16 },
  dot: { width:6, height:6, borderRadius:'50%', background:'#50AF95', animation:'dot-bounce 1.2s infinite' },

  /* result card */
  resultCard: { maxWidth:620, textAlign:'center', width:'100%' },
  resIcon: { fontSize:'3rem', fontWeight:900, marginBottom:6 },
  resTitle: { fontSize:'1.1rem', fontWeight:800, marginBottom:6, letterSpacing:'-0.01em' },
  resSub: { fontSize:'0.72rem', color:'#94a3b8', marginBottom:12 },
  resFlow: { fontSize:'0.82rem', color:'#94a3b8', marginBottom:12 },
  txRow: { display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:14, padding:'6px 14px', background:'rgba(80,175,149,0.06)', border:'1px solid rgba(80,175,149,0.15)', borderRadius:6, animation:'fade-in-scale 0.5s ease-out' },
  txLabel: { fontSize:'0.55rem', fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:'0.04em' },
  txLink: { fontSize:'0.72rem', color:'#50AF95', textDecoration:'none', fontFamily:"'SF Mono','Fira Code',monospace", borderBottom:'1px dotted rgba(80,175,149,0.4)' },
  txMethod: { fontSize:'0.52rem', fontWeight:700, color:'#f59e0b', padding:'1px 6px', borderRadius:3, background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.2)' },
  rejStamp: { fontSize:'1.8rem', fontWeight:900, color:'#ef4444', letterSpacing:'0.12em', marginTop:16, textShadow:'0 0 30px rgba(239,68,68,0.4)' },
  rejSub: { fontSize:'0.68rem', color:'#94a3b8', marginTop:6 },

  /* binding table */
  bindTbl: { textAlign:'left', fontFamily:"'SF Mono','Fira Code',monospace", fontSize:'0.68rem', margin:'0 auto 10px', maxWidth:560 },
  bHdrRow: { display:'grid', gridTemplateColumns:'80px 1fr 1fr 50px', gap:6, padding:'5px 0', borderBottom:'1px solid #1e293b' },
  bHdr: { fontWeight:700, color:'#64748b', textTransform:'uppercase', fontSize:'0.55rem', letterSpacing:'0.04em' },
  bRow: { display:'grid', gridTemplateColumns:'80px 1fr 1fr 50px', gap:6, padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', borderRadius:3 },
  bFld: { color:'#94a3b8', fontWeight:600 },
  bVal: { wordBreak:'break-all', lineHeight:1.4 },
  bMatch: { textAlign:'center', fontWeight:800, fontSize:'0.85rem' },

  /* summary */
  summaryCard: { maxWidth:700, textAlign:'center', width:'100%' },
  sumTitle: { fontSize:'1.4rem', fontWeight:800, color:'#50AF95', marginBottom:6, letterSpacing:'-0.02em' },
  sumSub: { fontSize:'0.82rem', color:'#94a3b8', marginBottom:20, lineHeight:1.5 },
  sumGrid: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 },
  sumCell: { border:'1.5px solid', borderRadius:10, padding:'16px 12px', background:'rgba(255,255,255,0.02)' },
  sumCellIcon: { fontSize:'1.6rem', fontWeight:900, marginBottom:4 },
  sumCellName: { fontSize:'0.82rem', fontWeight:700, color:'#e2e8f0', marginBottom:4 },
  sumCellStatus: { fontSize:'0.72rem', fontWeight:800, marginBottom:4 },
  sumCellDesc: { fontSize:'0.62rem', color:'#94a3b8', lineHeight:1.4 },
  sumTagline: { fontSize:'0.75rem', color:'#cbd5e1', lineHeight:1.5, marginBottom:10 },
  sumReplay: { fontSize:'0.68rem', color:'#64748b' },

  /* console */
  console: { width:'100%', maxWidth:560, margin:'0 auto', background:'#1e293b', border:'1px solid #334155', borderRadius:8, overflow:'hidden', fontSize:'0.62rem', fontFamily:"'SF Mono','Fira Code',monospace", textAlign:'left' },
  conHdr: { display:'flex', alignItems:'center', gap:4, padding:'5px 10px', background:'#0f172a', borderBottom:'1px solid #334155' },
  conDotR: { width:7, height:7, borderRadius:'50%', background:'#ef4444', display:'inline-block' },
  conDotY: { width:7, height:7, borderRadius:'50%', background:'#eab308', display:'inline-block' },
  conDotG: { width:7, height:7, borderRadius:'50%', background:'#22c55e', display:'inline-block' },
  conTitle: { marginLeft:6, fontSize:'0.52rem', color:'#64748b', fontWeight:500, letterSpacing:'0.03em', textTransform:'uppercase' },
  conBody: { padding:'6px 10px', lineHeight:1.6 },
  conLn: { display:'flex', alignItems:'flex-start', gap:6, padding:'2px 0', opacity:0, animation:'ln-in 0.5s ease forwards' },
  conM: { display:'inline-block', padding:'0 5px', borderRadius:3, fontSize:'0.52rem', fontWeight:700, flexShrink:0, textTransform:'uppercase', lineHeight:1.6 },
  conMPost: { background:'rgba(96,165,250,0.2)', color:'#93c5fd' },
  conMGet: { background:'rgba(74,222,128,0.2)', color:'#86efac' },
  conU: { color:'#e2e8f0', wordBreak:'break-all' },
  conArrIn: { fontWeight:700, flexShrink:0, color:'#60a5fa' },
  conArrOut: { fontWeight:700, flexShrink:0, color:'#4ade80' },
  conD: { color:'#64748b', wordBreak:'break-all' },
  conDRes: { color:'#94a3b8', wordBreak:'break-all' },

  /* footer */
  footer: { display:'flex', justifyContent:'center', alignItems:'center', gap:14, flexWrap:'wrap', padding:'16px 0', borderTop:'1px solid #1e293b', fontSize:'0.62rem' },
  fBrand: { color:'#94a3b8', fontSize:'0.68rem' },
  fSep: { color:'#334155' },
  fItem: { color:'#475569' },
  fLbl: { fontWeight:600, marginRight:4 },
};

export default App;

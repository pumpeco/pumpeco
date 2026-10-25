import { useEffect, useState } from 'react';
import { WalletProvider } from './lib/wallet.jsx';
import { usePath } from './lib/router.js';
import { api } from './lib/api.js';
import { Header, Ticker, WalletPicker, Footer } from './components/Chrome.jsx';
import Board from './pages/Board.jsx';
import Create from './pages/Create.jsx';
import Coin from './pages/Coin.jsx';
import How from './pages/How.jsx';

const FALLBACK = { launchReady: false, devBuyReady: false, maxDevBuySol: 50, deployCostSol: 0.025, explorer: 'https://solscan.io', solUsd: null, limits: {} };
const B58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';

function Page({ path, cfg }) {
  if (path === '/') return <Board cfg={cfg} />;
  if (path === '/create') return <Create cfg={cfg} />;
  if (path === '/how') return <How cfg={cfg} />;
  const m = path.match(new RegExp(`^/coin/(${B58})$`));
  if (m) return <Coin mint={m[1]} cfg={cfg} />;
  return <main className="wrap"><div className="empty" style={{ marginTop: 40 }}>there is nothing at {path}</div></main>;
}

export default function App() {
  const path = usePath();
  const [cfg, setCfg] = useState(FALLBACK);
  useEffect(() => {
    const load = () => api.config().then((c) => setCfg({ ...FALLBACK, ...c })).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <WalletProvider>
      <div className="bgfx" aria-hidden="true" />
      <Header />
      <Ticker />
      <Page path={path} cfg={cfg} />
      <Footer />
      <WalletPicker />
    </WalletProvider>
  );
}

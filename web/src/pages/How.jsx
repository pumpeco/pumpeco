import { Link } from '../lib/router.js';

const Step = ({ n, title, children }) => (
  <div className="how-step">
    <div className="how-n">{n}</div>
    <div style={{ display: 'grid', gap: 6 }}><div className="b" style={{ color: '#fff' }}>{title}</div>{children}</div>
  </div>
);

/** How it works for classic launches (pump.family, 6 Nov 2026): every coin is a real pump.fun coin from the first block. */
export default function How({ cfg }) {
  return (
    <main className="wrap">
      <div className="how">
        <Link href="/" className="bracket back">[go back]</Link>
        <h1>How It Works</h1>
        <p className="lead">Every coin launched here is a real Pumpfun coin.</p>
        <p>It is created on Pumpfun itself, trades on Pumpfun's curve from the first block and graduates to PumpSwap like any other Pumpfun coin.</p>
        <p>This site never holds your funds. Every launch and every trade is signed by your own wallet.</p>

        <h2>Launching a Coin</h2>
        <Step n="1" title="Create the Coin">
          <p>Choose the name, ticker, image and links for your coin.</p>
          <p>Every token address ends in <span className="green">pump</span>. The coin's data is written on chain at launch and cannot be changed afterwards.</p>
        </Step>
        <Step n="2" title="Pick a Ticker Lock">
          <p>Pick a ticker lock of 24 hours, 3 days or 7 days. Once a coin launches with a ticker, nobody can launch another coin with the same ticker here until its lock ends, the creator included. This stops copycats from riding a launch.</p>
        </Step>
        <Step n="3" title="Creator Fees Deepen Liquidity">
          <p>Every coin launched here sends its creator fees into its own liquidity. While the coin is on the bonding curve the fees wait. Once it graduates to PumpSwap, they are added to the coin's pool and the LP tokens are burned, so that liquidity stays in the pool forever.</p>
          <p>The more a coin trades, the deeper its pool gets.</p>
        </Step>
        <Step n="4" title="Approve in Your Wallet">
          <p>Your wallet signs the launch. The coin is live on Pumpfun as soon as the transaction lands, at a cost of about {cfg.deployCostSol ?? 0.025} SOL.</p>
        </Step>

        <h2>Trading</h2>
        <p>Coins trade on Pumpfun's bonding curve. You can trade here, on Pumpfun or in any app that supports Pumpfun coins.</p>
        <p>When the curve fills, the coin graduates to PumpSwap automatically, exactly like any other Pumpfun coin.</p>

        <Link href="/create" className="btn" style={{ justifySelf: 'center' }}>Launch coin</Link>
      </div>
    </main>
  );
}

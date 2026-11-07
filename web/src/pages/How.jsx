import { Link } from '../lib/router.js';

const Step = ({ n, title, children }) => (
  <div className="how-step">
    <div className="how-n">{n}</div>
    <div style={{ display: 'grid', gap: 6 }}><div className="b" style={{ color: '#fff' }}>{title}</div>{children}</div>
  </div>
);

/** How it works (pump.family, operator's text 7 Nov 2026): the fundamentals that made Pumpfun successful. */
export default function How({ cfg }) {
  return (
    <main className="wrap">
      <div className="how">
        <Link href="/" className="bracket back">[go back]</Link>
        <h1>How It Works</h1>
        <p className="lead">Pump Family brings back the fundamentals that made Pumpfun successful.</p>
        <p>Pumpfun started with a simple idea: a fair launch for everyone. No presales, no team allocations, no privileged buys. Everyone traded on the same bonding curve, and when a coin graduated, its liquidity was locked forever.</p>
        <p>Over time, those fundamentals changed. Dev buys, bundled launches, creator fees paid directly to developers and copycat tickers became part of the ecosystem.</p>
        <p>Pump Family brings the focus back to fair launches, with a few rules designed to make tokens stronger from the beginning.</p>

        <h2>The Fundamentals</h2>
        <Step n="1" title="No Dev Buys">
          <p>Every launch creates the coin and nothing else.</p>
          <p>No bundled buys, no team allocation and no tokens reserved for the creator. The creator starts with zero tokens.</p>
          <p>If the creator wants to buy, they do so on the bonding curve like everyone else, at the same price and under the same conditions.</p>
        </Step>
        <Step n="2" title="Creator Fees Build Liquidity">
          <p>Creator fees don't go to the developer. <b>100% of creator fees are used to deepen the coin's liquidity.</b></p>
          <p>While a coin is on the bonding curve, its accumulated creator fees are held until graduation.</p>
          <p>Once the coin graduates to PumpSwap, the accumulated fees are added to its liquidity pool and the LP tokens are burned permanently.</p>
          <p>This means trading activity directly contributes to the coin's liquidity instead of creating continuous sell pressure from creator rewards.</p>
          <p>The more a coin trades, the more liquidity it can build.</p>
        </Step>
        <Step n="3" title="Ticker Locks">
          <p>Copycat launches shouldn't be able to immediately take advantage of a ticker that is gaining traction.</p>
          <p>Pump Family introduces configurable ticker locks.</p>
          <p>At launch, the creator chooses between:</p>
          <ul><li><b>24 hours</b></li><li><b>3 days</b></li><li><b>7 days</b></li></ul>
          <p>During the selected period, nobody can launch another coin with the same ticker on Pump Family, including the original creator.</p>
          <p>Once the lock expires, the ticker becomes available again.</p>
        </Step>
        <Step n="4" title="Custom CA">
          <p>Every token launched through Pump Family has a contract address ending in <b className="green">fair</b>.</p>
          <p>This makes Pump Family launches easy to identify and distinguish from other tokens on Pumpfun.</p>
          <p>When looking for a Pump Family launch, simply check that the contract address ends in fair.</p>
        </Step>

        <h2>Launching a Coin</h2>
        <p>Launching takes less than a minute.</p>
        <ol>
          <li>Connect your Solana wallet.</li>
          <li>Enter your coin's name, ticker, image and social links.</li>
          <li>Choose your ticker lock: 24 hours, 3 days or 7 days.</li>
          <li>Review your details and approve the launch transaction.</li>
        </ol>
        <p>Your coin's launch configuration is written on chain and cannot be changed afterwards.</p>
        <p>Once your transaction is confirmed, your coin is live on Pumpfun and ready to trade.</p>
        <p><b>Launch cost: approximately {cfg.deployCostSol ?? 0.025} SOL.</b></p>

        <Link href="/create" className="btn" style={{ justifySelf: 'center' }}>Launch coin</Link>
      </div>
    </main>
  );
}

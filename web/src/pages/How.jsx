import { Link } from '../lib/router.js';

const Step = ({ n, title, children }) => (
  <div className="how-step">
    <div className="how-n">{n}</div>
    <div style={{ display: 'grid', gap: 6 }}><div className="b" style={{ color: '#fff' }}>{title}</div>{children}</div>
  </div>
);

/** How it works (pump.family, 7 Nov 2026): the old Pumpfun fundamentals, on real Pumpfun coins. */
export default function How({ cfg }) {
  return (
    <main className="wrap">
      <div className="how">
        <Link href="/" className="bracket back">[go back]</Link>
        <h1>How It Works</h1>
        <p className="lead">Pump Family brings back the old Pumpfun.</p>
        <p>Pumpfun started with a simple promise: a fair launch for everyone. No presale. No team allocation. Everyone buys on the same curve, and when a coin made it, its liquidity was locked for good.</p>
        <p>Over time that changed. Dev buys bundled into the launch, creator fees paid out to the dev on every trade, and copycat coins riding every ticker that moved. Pump Family takes it back to the fundamentals.</p>

        <h2>The Fundamentals</h2>
        <Step n="1" title="No Dev Buy">
          <p>A launch here creates the coin and nothing else. No buy is bundled into the launch transaction, so the creator starts with zero coins.</p>
          <p>If the creator wants in, they buy on the curve like everyone else, at the same price, in the open.</p>
        </Step>
        <Step n="2" title="Creator Fees Go Back Into the Coin">
          <p>On Pumpfun today, creator fees pay the dev on every trade. Here they never reach the dev.</p>
          <p>Every coin's creator fees go into its own liquidity. While the coin is on the bonding curve the fees wait. Once it graduates to PumpSwap, they are added to the coin's pool and the LP tokens are burned, so that liquidity can never be pulled.</p>
          <p>The more a coin trades, the deeper its pool gets. The dev wins the same way holders win: by the coin doing well.</p>
        </Step>
        <Step n="3" title="Liquidity Locked Forever">
          <p>Just like the old Pumpfun burned the liquidity of every coin that graduated, every bit of liquidity added here is burned at the moment it is added. Nobody can withdraw it, not the creator and not us.</p>
        </Step>
        <Step n="4" title="No Copycats">
          <p>The creator picks a ticker lock of 24 hours, 3 days or 7 days. Until it ends, nobody can launch another coin with the same ticker here, the creator included. A coin that takes off keeps its name.</p>
        </Step>
        <Step n="5" title="Real Pumpfun Coins">
          <p>Every coin launched here is a real Pumpfun coin. It is created on Pumpfun itself, every token address ends in <span className="green">pump</span>, and it trades on Pumpfun's curve from the first block.</p>
          <p>You can trade it here, on Pumpfun or in any app that supports Pumpfun coins. When the curve fills, it graduates to PumpSwap like any other Pumpfun coin.</p>
        </Step>
        <Step n="6" title="Your Wallet, Your Keys">
          <p>This site never holds your funds. Every launch and every trade is signed by your own wallet.</p>
        </Step>

        <h2>Launching a Coin</h2>
        <p>Choose the name, ticker, image and links for your coin, and pick the ticker lock. The coin's data is written on chain at launch and cannot be changed afterwards.</p>
        <p>Your wallet signs the launch. The coin is live on Pumpfun as soon as the transaction lands, at a cost of about {cfg.deployCostSol ?? 0.025} SOL.</p>

        <Link href="/create" className="btn" style={{ justifySelf: 'center' }}>Launch coin</Link>
      </div>
    </main>
  );
}

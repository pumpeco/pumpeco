import { Link } from '../lib/router.js';

const Step = ({ n, title, children }) => (
  <div className="how-step">
    <div className="how-n">{n}</div>
    <div style={{ display: 'grid', gap: 6 }}><div className="b" style={{ color: '#fff' }}>{title}</div>{children}</div>
  </div>
);
const Rule = ({ title, children }) => (
  <div className="how-rule"><div className="b" style={{ color: '#fff' }}>{title}</div><p>{children}</p></div>
);

/** How it works (operator's copy, 25 Oct 2026). Market caps come from the live config. */
export default function How({ cfg }) {
  const sizes = (cfg.window?.sizes || []).filter((s) => s.available && s.capSol);
  const largest = sizes.length ? sizes[sizes.length - 1] : null;
  const usd = (sol) => (cfg.solUsd ? `$${Math.round((sol * cfg.solUsd) / 1000)}k` : `${Math.round(sol)} SOL`);
  return (
    <main className="wrap">
      <div className="how">
        <Link href="/" className="bracket">[go back]</Link>
        <h1>How It Works</h1>
        <p className="lead">Every coin starts here with a fair launch.</p>
        <p>Every coin starts from the same point, trades on its own curve, and follows the rules chosen by its creator.</p>
        <p>Once the curve reaches its selected market cap, the coin automatically migrates to Pumpfun and becomes a regular Pumpfun coin. Every holder receives the migrated coin automatically.</p>

        <h2>Launching a Coin</h2>
        <Step n="1" title="Create the Coin">
          <p>Choose the name, ticker, image and links for your coin.</p>
          <p>Every token address ends in <span className="green">pump</span>. The coin's core data is written on chain at launch and cannot be changed afterwards.</p>
        </Step>
        <Step n="2" title="Choose When Trading Opens">
          <p>Set a launch delay between 5 seconds and 1 minute.</p>
          <p>Until the delay expires, buys are rejected directly on chain. This includes the creator's wallet.</p>
          <p>The only exception is an optional first buy by the creator inside the launch transaction itself, capped at a fifth of the curve. It is visible on chain from the first block, and after it the creator waits for the opening like everyone else.</p>
        </Step>
        <Step n="3" title="Choose the Migration Market Cap">
          <p>Choose when your coin should migrate:</p>
          <ul>{sizes.map((s) => <li key={s.sizeSol}>{usd(s.capSol)} market cap</li>)}</ul>
          {largest && <p>The {usd(largest.capSol)} option matches Pumpfun's standard graduation level.</p>}
          <p>Your coin continues trading on the curve until the selected market cap is reached. Once it is reached, the coin automatically migrates to Pumpfun.</p>
        </Step>
        <Step n="4" title="Add Optional Rules">
          <p>Creators can add additional rules to their launch.</p>
          <Rule title="Wallet limits">Set a maximum holding between 1% and 10% of the total supply.</Rule>
          <div className="how-rule"><div className="b" style={{ color: '#fff' }}>Creator rewards</div><p>Choose where Pumpfun creator rewards go after migration:</p>
            <ul><li>The creator, following Pumpfun's reward schedule</li><li>The holders, permanently</li></ul></div>
          <p>Both choices are fixed at launch and visible on chain.</p>
        </Step>

        <h2>Trading on the Curve</h2>
        <p>The launch curve follows the same shape and starting market cap as a Pumpfun coin.</p>
        <p>That means the price progression and amount received at each point on the curve are designed to match what you would see on Pumpfun.</p>
        <p>The token itself enforces the launch rules through its transfer hook. The rules apply regardless of whether a trade comes through this website, a bot or another application.</p>
        <h3>The rules</h3>
        <Rule title="Trading stays closed until the launch time">The blockchain clock determines when buying opens. The website does not control it.</Rule>
        <Rule title="One buy per block">If multiple buys are bundled into the launch block, only one can succeed.</Rule>
        <Rule title="Wallet limits are enforced">If the creator enabled a wallet limit, the token enforces it on every buy.</Rule>
        <Rule title="Selling is always available">Holders can sell at any time. There is no restriction on getting out.</Rule>

        <h2>Migrating to Pumpfun</h2>
        <Step n="1" title="The Curve Reaches Its Target">
          <p>When the selected market cap is reached, the curve completes.</p>
          <p>The transfer hook is then removed and the token is ready to migrate.</p>
        </Step>
        <Step n="2" title="The Curve Creates the Pumpfun Coin">
          <p>99% of the SOL raised by the curve is used to create and buy the Pumpfun coin in a single transaction.</p>
          <p>The new coin uses the same name, ticker and image and launches at the same market cap.</p>
          <p>The Pumpfun coin address is not known beforehand, so nobody can buy it before the migration transaction.</p>
        </Step>
        <Step n="3" title="Every Holder Receives the New Coin">
          <p>The Pumpfun coins are distributed automatically to every holder based on their balance.</p>
          <p>There is nothing to claim and no transaction to sign.</p>
          <p>The original token remains as a record of the launch. The Pumpfun token becomes the live, tradable coin.</p>
        </Step>
        <Step n="4" title="It's Now a Pumpfun Coin">
          <p>From this point onward, the coin behaves like any other Pumpfun launch.</p>
          <p>It trades on Pumpfun's curve, can graduate to PumpSwap and distributes creator rewards according to the option selected at launch.</p>
        </Step>

        <Link href="/create" className="btn" style={{ justifySelf: 'center' }}>Launch coin</Link>
      </div>
    </main>
  );
}

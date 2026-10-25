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
        <Link href="/" className="bracket back">[go back]</Link>
        <h1>How It Works</h1>
        <p className="lead">Every coin starts here with a fair launch.</p>
        <p>Every coin starts from the same point, trades on its own curve, and follows the rules chosen by its creator.</p>
        <p>Once the curve reaches its selected market cap, the coin automatically migrates to Pumpfun and becomes a regular Pumpfun coin. Every holder receives the migrated coin automatically.</p>

        <h2>Launching a Coin</h2>
        <Step n="1" title="Create the Coin">
          <p>Choose the name, ticker, image and links for your coin.</p>
          <p>Every token address ends in <span className="green">pump</span>. The coin's core data is written on chain at launch and cannot be changed afterwards.</p>
          <p>A ticker can be used once every 24 hours. Once a coin launches with a ticker, nobody can launch another coin with the same ticker until a day has passed. This stops copycats from riding a launch.</p>
        </Step>
        <Step n="2" title="Choose When Trading Opens">
          <p>Set a launch delay between 5 seconds and 1 minute.</p>
          <p>Until the delay expires, buys are rejected directly on chain. This includes the creator's wallet.</p>
          <p>The only exception is an optional first buy by the creator inside the launch transaction itself, capped at 3% of the total supply. It is visible on chain from the first block, and after it the creator waits for the opening like everyone else.</p>
        </Step>
        <Step n="3" title="Choose the Migration Market Cap">
          <p>Choose when your coin should migrate:</p>
          <ul>{sizes.map((s) => <li key={s.sizeSol}>{usd(s.capSol)} market cap</li>)}</ul>
          {largest && <p>The {usd(largest.capSol)} option matches Pumpfun's standard graduation level.</p>}
          <p>Your coin continues trading on the curve until the selected market cap is reached. Once it is reached, the coin automatically migrates to Pumpfun.</p>
        </Step>
        <Step n="4" title="Add Optional Rules">
          <p>Creators can add additional rules to their launch. Every rule is written into the token at launch and enforced on chain until the coin migrates.</p>
          <Rule title="Wallet limits">Set a maximum holding between 1% and 10% of the total supply.</Rule>
          <div className="how-rule"><div className="b" style={{ color: '#fff' }}>Creator rewards</div><p>Choose where Pumpfun creator rewards go after migration:</p>
            <ul><li>The creator, following Pumpfun's reward schedule</li><li>The holders, permanently</li></ul></div>
          <h3>Who can hold</h3>
          <Rule title="Allowlist">Only the wallets on the creator's list can buy the coin or receive it. The creator fills the list right after launch and can seal it. The list is public on chain.</Rule>
          <Rule title="Blocklist">The wallets on the creator's list can never buy the coin or receive it. Everyone else trades as normal.</Rule>
          <h3>Fair launch</h3>
          <Rule title="Launch window cap">A tighter wallet limit for the first minutes after launch, so nobody can load up while the price is lowest. When the window ends, the normal limit takes over.</Rule>
          <Rule title="Rising max per wallet">The wallet limit starts small and rises evenly to the full limit over a set time.</Rule>
          <Rule title="Trade guard">No single buy can move more than a set share of the supply. Large buyers have to split up.</Rule>
          <Rule title="Sniper-fee cap">For the first minutes after launch, buys that pay a priority fee or a Jito tip above the creator's cap are rejected.</Rule>
          <Rule title="Anti-dump caps">Separate limits on the size of a single buy and a single sell. The sell limit applies to the creator too.</Rule>
          <Rule title="Graduated sell caps">The bigger the bag, the smaller one sell can be. Small holders sell freely. Large holders leave in pieces, the creator included.</Rule>
          <Rule title="Chapters">A wallet limit that grows with the coin. It starts small and doubles every time a set volume has traded.</Rule>
          <h3>When it trades</h3>
          <Rule title="Trading hours">The coin can only be bought on the days and hours the creator sets, in any time zone. The creator chooses whether sells stay open outside those hours.</Rule>
          <Rule title="Market hours">The coin trades like a stock: Monday to Friday, 9:30 to 16:00 New York time, following daylight saving and closed on US market holidays.</Rule>
          <Rule title="Trade only">The coin only moves in trades with its curve. Wallet-to-wallet sends are rejected, the creator's included.</Rule>
          <p>All choices are fixed at launch and visible on chain. The rules a coin carries are listed on its page.</p>
        </Step>

        <h2>Trading on the Curve</h2>
        <p>The launch curve follows the same shape and starting market cap as a Pumpfun coin.</p>
        <p>That means the price progression and amount received at each point on the curve are designed to match what you would see on Pumpfun.</p>
        <p>The token itself enforces the launch rules through its transfer hook. The rules apply regardless of whether a trade comes through this website, a bot or another application.</p>
        <h3>The rules</h3>
        <Rule title="Trading stays closed until the launch time">The blockchain clock determines when buying opens. The website does not control it.</Rule>
        <Rule title="One buy per block">If multiple buys are bundled into the launch block, only one can succeed.</Rule>
        <Rule title="Wallet limits are enforced">If the creator enabled a wallet limit, the token enforces it on every buy.</Rule>
        <Rule title="The creator's rules are enforced">Every optional rule the creator added is checked by the token on every trade and every send. A trade that breaks a rule never lands.</Rule>
        <Rule title="The creator's wallet is not above the rules">The creator's wallet is exempt from the rules about buying and holding, so it can make its first buy. It is never exempt from sell limits or trading hours that close sells.</Rule>
        <Rule title="Selling is available">Holders can sell at any time, unless the creator added a sell rule. Sell limits and closed sell hours are shown on the coin's page before you buy.</Rule>
        <Rule title="Rules end at migration">When the coin migrates to Pumpfun, the transfer hook is removed. From then on it trades like any other Pumpfun coin, with no rules attached.</Rule>

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

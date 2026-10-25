import { useEffect, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';

const INTERVALS = [[60, '1m'], [300, '5m'], [900, '15m'], [3600, '1h'], [14400, '4h'], [86400, '1D']];
const fmtUsd = (v) => (v < 0 ? '' : v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : v >= 1 ? `$${v.toFixed(2)}` : v >= 0.01 ? `$${v.toFixed(4)}` : `$${v.toPrecision(3)}`);

/**
 * The coin's chart like the original pump.fun one: TradingView candles from the coin's real on-chain trades, volume bars,
 * crosshair, zoom and pan; intervals 1m..1D; market cap or price in USD; the live price closes the last candle.
 */
export default function Chart({ mint, solUsd, interval, setInterval: pickInterval, data }) {
  const box = useRef(null), chartRef = useRef(null), candleRef = useRef(null), volRef = useRef(null), fitted = useRef('');
  const [mode, setMode] = useState('mcap'); // 'mcap' | 'price'
  const [log, setLog] = useState(false);

  useEffect(() => {
    const chart = createChart(box.current, {
      autoSize: true, height: 340,
      layout: { background: { color: 'transparent' }, textColor: '#a1a1aa', fontFamily: 'Geist, system-ui, sans-serif' },
      grid: { vertLines: { color: 'rgba(255,255,255,.04)' }, horzLines: { color: 'rgba(255,255,255,.04)' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2f2f35', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: '#2f2f35', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      localization: { priceFormatter: fmtUsd },
    });
    candleRef.current = chart.addCandlestickSeries({ upColor: '#86efac', downColor: '#f87171', borderUpColor: '#86efac', borderDownColor: '#f87171', wickUpColor: '#86efac', wickDownColor: '#f87171', priceFormat: { type: 'custom', formatter: fmtUsd, minMove: 1e-12 } });
    volRef.current = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  useEffect(() => { chartRef.current?.priceScale('right').applyOptions({ mode: log ? 1 : 0 }); }, [log]);

  useEffect(() => {
    if (!candleRef.current || !data) return;
    const k = (solUsd || 0) * (mode === 'mcap' ? data.supply || 1e9 : 1);
    const candles = (data.candles || []).filter((c) => c.c > 0).map((c) => ({ time: Math.floor(c.t / 1000), open: c.o * k, high: c.h * k, low: c.l * k, close: c.c * k }));
    candleRef.current.setData(candles);
    volRef.current.setData((data.candles || []).filter((c) => c.c > 0).map((c) => ({ time: Math.floor(c.t / 1000), value: c.v * (solUsd || 0), color: c.c >= c.o ? 'rgba(134,239,172,.45)' : 'rgba(248,113,113,.45)' })));
    // fit once per coin / interval / mode, then leave the user's zoom alone on live updates
    const key = `${mint}:${data.interval}:${mode}`; // the interval the DATA is in, not the button just pressed
    if (fitted.current !== key && candles.length) { fitted.current = key; chartRef.current.timeScale().fitContent(); }
  }, [data, solUsd, mode, mint]);

  return (
    <div className="chart">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        <div className="seg">{INTERVALS.map(([v, t]) => <button key={v} className={interval === v ? 'on' : ''} onClick={() => pickInterval(v)}>{t}</button>)}</div>
        <div className="seg">
          <button className={mode === 'mcap' ? 'on' : ''} onClick={() => setMode('mcap')}>MCap</button>
          <button className={mode === 'price' ? 'on' : ''} onClick={() => setMode('price')}>Price</button>
          <button className={log ? 'on' : ''} onClick={() => setLog(!log)}>log</button>
        </div>
      </div>
      <div ref={box} style={{ height: 340, position: 'relative' }}>
        {data && !(data.candles || []).length && <div className="empty" style={{ position: 'absolute', inset: 0, zIndex: 2, paddingTop: 140 }}>the chart fills in as the coin trades</div>}
      </div>
    </div>
  );
}

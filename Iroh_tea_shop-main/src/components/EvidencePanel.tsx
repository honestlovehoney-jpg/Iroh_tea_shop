'use client';

import { useState, useEffect } from 'react';

interface Candle { timestamp: string; open: number; high: number; low: number; close: number; baseVolume: number; }
interface EvidencePanelProps { instrumentId: string; }

export default function EvidencePanel({ instrumentId }: EvidencePanelProps) {
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('unverified');
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!instrumentId) return;
    setLoading(true); setCandles(null);
    fetch(`/api/bitget/assets/${instrumentId}/candles?interval=1h&limit=3`)
      .then(res => res.json())
      .then(data => { setCandles(data.value); setStatus(data.status); setFetchedAt(data.fetchedAt); })
      .catch(() => setStatus('error'))
      .finally(() => setLoading(false));
  }, [instrumentId]);

  if (!instrumentId) return <div className="p-8 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">Select an instrument to view evidence</div>;
  if (loading) return <div className="p-8 text-center text-slate-500 bg-white rounded-xl border border-slate-200"><div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-2"></div>Loading market data...</div>;
  if (status === 'error' || !candles) return <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-800">Error retrieving data. Status: {status}</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
        <h3 className="font-bold text-slate-800">Price Evidence (1H)</h3>
        <span className={`text-xs px-3 py-1 rounded-full font-medium ${status === 'available' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
          {status}
        </span>
      </div>
      <div className="divide-y divide-slate-100">
        {candles.map((candle, i) => (
          <div key={i} className="px-6 py-4 hover:bg-slate-50 transition-colors">
            <div className="text-xs text-slate-400 mb-3 font-mono">{new Date(candle.timestamp).toLocaleString()}</div>
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center"><div className="text-xs text-slate-400 mb-1">Open</div><div className="font-mono font-semibold text-slate-700">{candle.open.toFixed(2)}</div></div>
              <div className="text-center"><div className="text-xs text-slate-400 mb-1">High</div><div className="font-mono font-semibold text-green-600">{candle.high.toFixed(2)}</div></div>
              <div className="text-center"><div className="text-xs text-slate-400 mb-1">Low</div><div className="font-mono font-semibold text-red-600">{candle.low.toFixed(2)}</div></div>
              <div className="text-center"><div className="text-xs text-slate-400 mb-1">Close</div><div className="font-mono font-bold text-slate-900">{candle.close.toFixed(2)}</div></div>
            </div>
          </div>
        ))}
      </div>
      {fetchedAt && <div className="px-6 py-2 bg-slate-50 text-xs text-slate-400 text-right">Fetched: {new Date(fetchedAt).toLocaleTimeString()}</div>}
    </div>
  );
}

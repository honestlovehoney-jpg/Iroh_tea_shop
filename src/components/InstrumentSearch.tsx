'use client';

import { useState } from 'react';

interface Instrument {
  instrumentId: string;
  symbol: string;
  companyName: string;
  productType: string;
}

interface InstrumentSearchProps {
  onInstrumentSelect: (instrument: Instrument) => void;
}

export default function InstrumentSearch({
  onInstrumentSelect,
}: InstrumentSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Instrument[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (searchQuery: string) => {
    setQuery(searchQuery);
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(
        `/api/bitget/assets/search?q=${encodeURIComponent(searchQuery)}`,
      );
      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search instruments (e.g., BTC, AAPL, TSLA)..."
          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-slate-800 placeholder-slate-400"
        />
        {loading && (
          <div className="absolute right-4 top-3.5">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>

      {results.length > 0 && (
        <div className="mt-2 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-80 overflow-y-auto custom-scrollbar">
          {results.map((instrument) => (
            <button
              key={instrument.instrumentId}
              onClick={() => onInstrumentSelect(instrument)}
              className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-0 flex justify-between items-center group"
            >
              <div>
                <span className="font-bold text-slate-900 group-hover:text-blue-600">
                  {instrument.symbol}
                </span>
                <span className="ml-2 text-sm text-slate-500">
                  {instrument.companyName}
                </span>
              </div>
              <span className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-md">
                {instrument.productType}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';

interface Thesis {
  id: string;
  title: string;
  content?: string;
  createdAt?: string;
}

export default function ThesisManager({
  selectedInstrument,
}: {
  selectedInstrument: any;
}) {
  const [theses, setTheses] = useState<Thesis[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/saved-theses')
      .then((res) => res.json())
      .then((data) => {
        // Robustly extract the array from various API response shapes
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data.theses)
            ? data.theses
            : Array.isArray(data.data)
              ? data.data
              : [];
        setTheses(list);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!selectedInstrument) return;
    setSaving(true);
    try {
      await fetch('/api/saved-theses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: selectedInstrument.symbol,
          content: `Research on ${selectedInstrument.companyName} (${selectedInstrument.instrumentId})`,
        }),
      });
      // Refresh list
      const res = await fetch('/api/saved-theses');
      const data = await res.json();
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data.theses)
          ? data.theses
          : Array.isArray(data.data)
            ? data.data
            : [];
      setTheses(list);
    } catch (e) {
      console.error('Save failed', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 h-full">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-slate-800">My Theses</h3>
        <button
          onClick={handleSave}
          disabled={!selectedInstrument || saving}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {saving ? 'Saving...' : '+ Save to Thesis'}
        </button>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
        {theses.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">
            No theses saved yet.
          </p>
        ) : (
          theses.map((t: any, i: number) => (
            <div
              key={t.id || i}
              className="p-3 bg-slate-50 border border-slate-100 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <div className="font-semibold text-slate-800">
                {t.title || 'Untitled'}
              </div>
              {t.content && (
                <div className="text-xs text-slate-500 mt-1 line-clamp-2">
                  {t.content}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

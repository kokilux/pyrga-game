export function WeightBar({ label, value, maxVal, color, desc }: { label: string; value: number; maxVal: number; color: string; desc?: string }) {
  const percentage = maxVal === 0 ? 0 : Math.min((Math.abs(value) / maxVal) * 100, 100);
  return (
    <div className="group rounded-xl bg-slate-800/40 p-1.5 border border-slate-700/50 hover:bg-slate-800/70 transition">
      <div className="flex items-center justify-between font-semibold mb-0.5">
        <span className="text-[11px] text-slate-200">{label}</span>
        <span className="font-mono text-[11px] text-slate-100">{value > 0 ? "+" : ""}{value.toFixed(1)}</span>
      </div>
      <div className="relative w-full h-1.5 bg-slate-900 rounded overflow-hidden">
        <div className={`absolute inset-y-0 ${value < 0 ? "right-1/2" : "left-1/2"} ${color} rounded-sm`} style={{ width: `${percentage / 2}%` }}></div>
      </div>
      {desc && <p className="max-h-0 opacity-0 group-hover:max-h-8 group-hover:opacity-100 overflow-hidden text-[9px] text-slate-400 mt-0.5 transition-all">{desc}</p>}
    </div>
  );
}


import { SHAPES } from "../engine/constants";
import { towerComplete, towerOwner } from "../engine/rules";
import type { Cell } from "../engine/types";
import { EmptySlot, PieceIcon } from "./Pieces";

export function CellView({ cell, isValid, isLast, onClick }: { cell: Cell; isValid: boolean; isLast: boolean; onClick: () => void }) {
  const owner = towerOwner(cell);
  const complete = towerComplete(cell);

  let borderClass = "border-slate-700";
  let bg = "bg-slate-800/60";
  if (complete) {
    if (owner === "white") { borderClass = "border-slate-100 ring-1 ring-white/50"; bg = "bg-slate-100/10"; }
    else if (owner === "black") { borderClass = "border-slate-950 ring-1 ring-slate-950"; bg = "bg-slate-950/60"; }
  }
  if (isValid) { borderClass = "border-amber-400 animate-pulse"; bg = "bg-amber-400/15"; }
  if (isLast) { borderClass = "border-sky-400 ring-1 ring-sky-400"; }

  return (
    <button onClick={onClick} disabled={!isValid} className={`relative aspect-square rounded-lg border-2 ${borderClass} ${bg} transition-all duration-150 ${isValid ? "cursor-pointer ring-2 ring-amber-300/50 ring-offset-1 ring-offset-slate-900 hover:scale-[1.03]" : "cursor-default"}`}>
      {complete && owner && <div className={`absolute -top-2 -right-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow ${owner === "white" ? "bg-slate-100 text-slate-900" : "bg-slate-950 text-slate-100 border border-slate-100/30"}`}>★</div>}
      <div className="flex h-full w-full items-center justify-center gap-1 px-1">
        {SHAPES.map((shape) => {
          if (shape === "square" && cell.square) return <PieceIcon key={shape} shape="square" color={cell.square} size={28} />;
          if (shape === "triangle" && cell.triangle) return <PieceIcon key={shape} shape="triangle" color={cell.triangle.color} dir={cell.triangle.dir} size={28} />;
          if (shape === "circle" && cell.circle) return <PieceIcon key={shape} shape="circle" color={cell.circle} size={28} />;
          return <div key={shape} className="opacity-15"><EmptySlot shape={shape} size={20} /></div>;
        })}
      </div>
    </button>
  );
}

// ============================================================
// Main App

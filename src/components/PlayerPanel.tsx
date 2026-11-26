import { DIRS, SHAPES } from "../engine/constants";
import type { Color, Direction, Shape } from "../engine/types";
import { PieceIcon, PieceTriangle } from "./Pieces";

export function PlayerPanel({ color, inventory, isCurrent, towers, partials, selectedShape, selectedDir, onSelectShape, onSelectDir, disabled, bannedShape, validTriangleDirs, isAI }: { color: Color; inventory: Record<Shape, number>; isCurrent: boolean; towers: number; partials: number; selectedShape: Shape; selectedDir: Direction; onSelectShape: (s: Shape) => void; onSelectDir: (d: Direction) => void; disabled: boolean; bannedShape: Shape | null; validTriangleDirs: Set<Direction>; isAI: boolean }) {
  const name = color === "white" ? "白 (先手)" : "黒 (後手)";
  return (
    <div className={`rounded-2xl border-2 p-4 transition ${isCurrent ? "border-amber-400 bg-slate-900/80 shadow-lg" : "border-slate-700 bg-slate-900/30 opacity-75"}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-4 w-4 rounded-full ${color === "white" ? "bg-slate-100" : "bg-slate-950 border border-slate-100/40"}`} />
          <div className="flex flex-col">
            <span className="font-bold text-slate-100">{name}</span>
            <span className="text-[10px] text-slate-400">{isAI ? "🤖 AI" : "👤 人間"}</span>
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 border border-slate-700/50 px-2 py-1 text-xs">支配塔 <span className="text-base font-black text-amber-300">{towers}</span><span className="ml-1 text-slate-500">/3</span></div>
      </div>
      <div className="mb-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">駒を選択</div>
        <div className="grid grid-cols-3 gap-2">
          {SHAPES.map(shape => {
            const count = inventory[shape];
            const sel = selectedShape === shape;
            const isBanned = bannedShape === shape;
            return (
              <button key={shape} disabled={disabled || count === 0 || isBanned} onClick={() => onSelectShape(shape)} className={`flex flex-col items-center gap-1 rounded-xl border-2 p-2 transition ${sel && !disabled ? "border-amber-400 bg-amber-400/10" : "border-slate-700 bg-slate-800/50"} ${disabled || count === 0 || isBanned ? "opacity-30 cursor-not-allowed" : "hover:border-slate-500"}`}>
                <PieceIcon shape={shape} color={color} dir="up" size={32} />
                <div className="text-xs font-bold text-slate-200">×{count}</div>
                {isBanned && <div className="text-[9px] font-bold text-rose-400">使用不可</div>}
              </button>
            );
          })}
        </div>
      </div>
      <div className={`space-y-2 transition ${selectedShape === "triangle" ? "opacity-100" : "opacity-30"}`}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">▲ 三角の向き</div>
        <div className="grid grid-cols-4 gap-2">
          {DIRS.map(d => {
            const sel = selectedDir === d;
            const isActive = selectedShape === "triangle" && !disabled;
            const dirValid = validTriangleDirs.has(d);
            return (
              <button key={d} disabled={!isActive || !dirValid} onClick={() => onSelectDir(d)} className={`flex items-center justify-center rounded-lg border-2 p-1.5 transition ${sel && isActive && dirValid ? "border-amber-400 bg-amber-400/10" : "border-slate-700 bg-slate-800/50"} ${!isActive || !dirValid ? "opacity-30 cursor-not-allowed" : "hover:border-slate-500"}`}>
                <PieceTriangle color={color} dir={d} size={24} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400 font-mono">
        <div className="rounded bg-slate-800/50 px-2 py-1 border border-slate-700/30">残り: <span className="font-bold text-slate-200">{inventory.square + inventory.triangle + inventory.circle}</span></div>
        <div className="rounded bg-slate-800/50 px-2 py-1 border border-slate-700/30">優勢: <span className="font-bold text-slate-200">{partials}</span></div>
      </div>
    </div>
  );
}


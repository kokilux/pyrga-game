import type { Color, LastMove, Shape } from "../engine/types";

export function StatusBar({ currentPlayer, gameOver, winner, fallback, lastMove, legalCount, bannedShape, aiThinking, searchStats, lostPatternsCount }: { currentPlayer: Color; gameOver: boolean; winner: Color | "draw" | null; fallback: boolean; lastMove: LastMove | null; legalCount: number; bannedShape: Shape | null; aiThinking: boolean; searchStats: { nodes: number; eval: number; patternsAvoided: number } | null; lostPatternsCount: number }) {
  let msg = "";
  let subMsg = "";
  if (gameOver) msg = winner === "draw" ? "終了 — 引き分け" : `終了 — ${winner === "white" ? "白" : "黒"}の勝ち`;
  else if (aiThinking) {
    msg = `${currentPlayer === "white" ? "白" : "黒"} (AI) 思考中...`;
    if (searchStats) subMsg = `探索: ${searchStats.nodes} nodes | eval: ${Math.round(searchStats.eval)} | 回避P: ${lostPatternsCount}`;
  } else if (!lastMove) msg = "白の番 — 初手";
  else if (fallback) msg = `${currentPlayer === "white" ? "白" : "黒"}の番 — ルール3適用`;
  else msg = `${currentPlayer === "white" ? "白" : "黒"}の番`;
  if (!aiThinking && searchStats && !gameOver) {
    subMsg = `最終探索: ${searchStats.nodes} nodes | eval: ${Math.round(searchStats.eval)}`;
  }

  return (
    <div className="flex w-full max-w-[540px] flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-600 bg-slate-900/80 px-4 py-2 text-sm shadow-md">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${aiThinking ? "bg-amber-400 animate-ping" : gameOver ? "bg-slate-500" : currentPlayer === "white" ? "bg-slate-100" : "bg-slate-950 ring-1 ring-slate-100/50"}`} />
        <div className="flex flex-col">
          <span className="font-semibold text-slate-100">{msg}</span>
          {subMsg && <span className="font-mono text-[10px] text-amber-400">{subMsg}</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
        {bannedShape && <span className="rounded bg-rose-950/40 px-1.5 py-0.5 text-rose-300 font-bold">{bannedShape === "square" ? "■" : bannedShape === "triangle" ? "▲" : "●"}不可</span>}
        <span>合法手: <span className="font-bold text-slate-200">{legalCount}</span></span>
      </div>
    </div>
  );
}


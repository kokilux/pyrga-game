export function RulesPanel() {
  return (
    <details className="mt-6 rounded-xl border border-slate-700 bg-slate-900/40 p-4 text-xs text-slate-400">
      <summary className="cursor-pointer text-sm font-bold text-slate-200">📜 ピルガ公式ルール</summary>
      <div className="mt-3 space-y-2 leading-relaxed">
        <p><strong>概要</strong>: 3つの塔を支配した最初のプレイヤーが勝利。</p>
        <p><strong>配置</strong>: 各マスには ■▲● をそれぞれ最大1つずつ配置。</p>
        <p><strong>移動制限</strong>: 直前の駒が ■→隣接、▲→頂点方向同列、●→同マス</p>
        <p><strong>先手2手目制限</strong>: 1手目と同じ駒は選べない</p>
        <p><strong>三角の向き</strong>: 盤面外を指せない</p>
      </div>
    </details>
  );
}

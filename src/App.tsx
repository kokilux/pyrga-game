import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_WEIGHTS, DIRS, MAX_PATTERNS } from "./engine/constants";
import { appendBoundedPatterns, extractLearningPatterns, sanitizeWeights, updateWeightsTD } from "./engine/learning";
import GameWorker from "./workers/gameWorker.ts?worker&inline";
import {
  checkGameOverState,
  cloneBoard,
  countTowers,
  emptyBoard,
  generateAllLegalMoves,
  getBannedShape,
  getFeatureVector,
  getLegalMoves,
  isDirValidForCell,
  partialOwner,
  startingInventory,
} from "./engine/rules";
import type {
  AIWeights,
  Cell,
  Color,
  Direction,
  FullLegalMove,
  GameRecord,
  Inventory,
  LastMove,
  LearningHistory,
  LostPattern,
  SavedGame,
  Shape,
  WinPattern,
} from "./engine/types";

import { CellView } from "./components/CellView";
import { dirSymbol } from "./components/Pieces";
import { PlayerPanel } from "./components/PlayerPanel";
import { RulesPanel } from "./components/RulesPanel";
import { StatusBar } from "./components/StatusBar";
import { WeightBar } from "./components/WeightBar";

// React Component Helpers
// ============================================================
// ============================================================
export default function App() {
  const [activeTab, setActiveTab] = useState<"game" | "train" | "archive">("game");

  // Game state
  const [board, setBoard] = useState<Cell[][]>(emptyBoard);
  const [currentPlayer, setCurrentPlayer] = useState<Color>("white");
  const [inventory, setInventory] = useState<Inventory>(startingInventory);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [whiteFirstShape, setWhiteFirstShape] = useState<Shape | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [moveHistoryLen, setMoveHistoryLen] = useState<number>(0);
  
  // 人間対戦用のゲームログ（リアルタイム学習用）
  const [gameMovesLog, setGameMovesLog] = useState<GameRecord["moves"]>([]);
  const [gameMode, setGameMode] = useState<"human" | "ai_black" | "ai_white" | "ai_vs_ai">("ai_black");
  const [aiDifficulty, setAiDifficulty] = useState<"easy" | "normal" | "hard" | "master">("hard");
  const [selectedShape, setSelectedShape] = useState<Shape>("square");
  const [selectedDir, setSelectedDir] = useState<Direction>("up");
  const [winner, setWinner] = useState<Color | "draw" | null>(null);
  const [gameOver, setGameOver] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const [searchStats, setSearchStats] = useState<{ nodes: number; eval: number; patternsAvoided: number } | null>(null);

  // Learning state
  const [aiWeights, setAiWeights] = useState<AIWeights>(DEFAULT_WEIGHTS);
  const [lostPatterns, setLostPatterns] = useState<LostPattern[]>([]);
  const [winPatterns, setWinPatterns] = useState<WinPattern[]>([]);
  const [learningHistory, setLearningHistory] = useState<LearningHistory>({
    totalGames: 0, whiteWins: 0, blackWins: 0, draws: 0, patternsLearned: 0, lastUpdateTime: 0
  });
  const [isTraining, setIsTraining] = useState(false);
  const [trainProgress, setTrainProgress] = useState(0);
  const [trainLog, setTrainLog] = useState<string>("学習センター準備完了。");
  const [evalResult, setEvalResult] = useState<{ wins: number; losses: number; draws: number } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [learningRate, setLearningRate] = useState(0.005);
  const [epsilon, setEpsilon] = useState(0.1);
  const [customTrainCount, setCustomTrainCount] = useState<string>("50");
  
  // 強化機構の有効無効
  const [enableOpeningBook, setEnableOpeningBook] = useState(true); // オープニングブック
  const [enableTemperature, setEnableTemperature] = useState(true); // 温度付き選択
  const [enableTransposition, setEnableTransposition] = useState(true); // トランスポジション表
  const [temperature, setTemperature] = useState(0.5); // 温度パラメータ


  // Archive state
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [viewingSavedGame, setViewingSavedGame] = useState<SavedGame | null>(null);

  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage (once). Saving is gated until hydration completes to avoid overwriting persisted data with defaults.
  useEffect(() => {
    try {
      const version = localStorage.getItem("pyrga_storage_version");
      // version is informational for now; we sanitize/migrate defensively.
      void version;
      const storedWeights = localStorage.getItem("pyrga_ai_weights_v2");
      if (storedWeights) {
        const parsed = JSON.parse(storedWeights);
        if (parsed && typeof parsed === "object") setAiWeights(sanitizeWeights({ ...DEFAULT_WEIGHTS, ...parsed }, DEFAULT_WEIGHTS));
      }

      const storedLost = localStorage.getItem("pyrga_lost_patterns");
      if (storedLost) {
        const parsed = JSON.parse(storedLost);
        if (Array.isArray(parsed)) setLostPatterns(parsed.slice(-MAX_PATTERNS));
      }

      const storedWin = localStorage.getItem("pyrga_win_patterns");
      if (storedWin) {
        const parsed = JSON.parse(storedWin);
        if (Array.isArray(parsed)) setWinPatterns(parsed.slice(-MAX_PATTERNS));
      }

      const storedHistory = localStorage.getItem("pyrga_learning_history");
      if (storedHistory) {
        const parsed = JSON.parse(storedHistory);
        if (parsed && typeof parsed === "object") setLearningHistory((prev) => ({ ...prev, ...parsed }));
      }

      const storedGames = localStorage.getItem("pyrga_saved_games");
      if (storedGames) {
        const parsed = JSON.parse(storedGames);
        if (Array.isArray(parsed)) setSavedGames(parsed.slice(0, 30));
      }
    } catch (e) {
      console.error("Failed to load data from localStorage", e);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Save to localStorage after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem("pyrga_storage_version", "3");
      localStorage.setItem("pyrga_ai_weights_v2", JSON.stringify(aiWeights));
      localStorage.setItem("pyrga_lost_patterns", JSON.stringify(lostPatterns.slice(-MAX_PATTERNS)));
      localStorage.setItem("pyrga_win_patterns", JSON.stringify(winPatterns.slice(-MAX_PATTERNS)));
      localStorage.setItem("pyrga_learning_history", JSON.stringify(learningHistory));
      localStorage.setItem("pyrga_saved_games", JSON.stringify(savedGames));
    } catch (e) {
      console.error("Failed to save data to localStorage", e);
    }
  }, [hydrated, aiWeights, lostPatterns, winPatterns, learningHistory, savedGames]);

  // Latest-state ref to avoid stale closures in async callbacks (AI timeout, training loops).
  const latestStateRef = useRef({
    board,
    currentPlayer,
    inventory,
    lastMove,
    whiteFirstShape,
    history,
    moveHistoryLen,
    gameMovesLog,
    gameMode,
    aiDifficulty,
    winner,
    gameOver,
    aiWeights,
    lostPatterns,
    winPatterns,
    learningHistory,
    learningRate,
    savedGames,
  });
  latestStateRef.current = {
    board,
    currentPlayer,
    inventory,
    lastMove,
    whiteFirstShape,
    history,
    moveHistoryLen,
    gameMovesLog,
    gameMode,
    aiDifficulty,
    winner,
    gameOver,
    aiWeights,
    lostPatterns,
    winPatterns,
    learningHistory,
    learningRate,
    savedGames,
  };

  // Web Worker for heavy AI/training work (keeps main thread responsive).
  const workerRef = useRef<Worker | null>(null);
  const workerSeqRef = useRef(0);
  const workerCallbacksRef = useRef(new Map<string, (msg: any) => void>());

  useEffect(() => {
    const w = new GameWorker();
    w.onmessage = (e: MessageEvent<any>) => {
      const cb = workerCallbacksRef.current.get(e.data?.id);
      if (cb) cb(e.data);
    };
    w.onerror = (err) => {
      console.error("Worker error", err);
    };
    workerRef.current = w;
    return () => {
      w.terminate();
      workerRef.current = null;
      workerCallbacksRef.current.clear();
    };
  }, []);

  const callWorker = useCallback(<T,>(type: string, payload: any, onProgress?: (msg: any) => void): Promise<T> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error("Worker not available"));
    const id = `${type}-${++workerSeqRef.current}-${Date.now()}`;
    return new Promise<T>((resolve, reject) => {
      workerCallbacksRef.current.set(id, (msg: any) => {
        if (msg.type === "train-progress") {
          onProgress?.(msg);
          return;
        }
        workerCallbacksRef.current.delete(id);
        if (msg.ok) resolve(msg.result as T);
        else reject(new Error(msg.error || "Worker request failed"));
      });
      worker.postMessage({ type, id, payload });
    });
  }, []);

  // Game calculations
  const bannedShape = useMemo(() => {
    return getBannedShape(currentPlayer, moveHistoryLen, whiteFirstShape);
  }, [currentPlayer, moveHistoryLen, whiteFirstShape]);

  const { moves: legalMoves, fallback } = useMemo(() => {
    return getLegalMoves(board, lastMove, inventory[currentPlayer], bannedShape);
  }, [board, lastMove, inventory, currentPlayer, bannedShape]);

  const validCellSet = useMemo(() => {
    const s = new Set<string>();
    for (const m of legalMoves) {
      if (m.shape === selectedShape) s.add(`${m.row},${m.col}`);
    }
    return s;
  }, [legalMoves, selectedShape]);

  const towers = useMemo(() => countTowers(board), [board]);

  const partialW = useMemo(() => {
    let w = 0, b = 0;
    for (const r of board) for (const c of r) {
      const po = partialOwner(c, 2);
      if (po === "white") w++;
      else if (po === "black") b++;
    }
    return { white: w, black: b };
  }, [board]);

  const validTriangleDirs = useMemo(() => {
    const valid = new Set<Direction>();
    for (const d of DIRS) {
      for (const m of legalMoves) {
        if (m.shape === "triangle" && isDirValidForCell(m.row, m.col, d)) {
          valid.add(d);
          break;
        }
      }
    }
    return valid;
  }, [legalMoves]);

  // Player move handling
  function handleCellClick(row: number, col: number) {
    if (gameOver || winner || aiThinking) return;
    if (inventory[currentPlayer][selectedShape] <= 0) return;
    if (!validCellSet.has(`${row},${col}`)) return;
    if (selectedShape === "triangle" && !isDirValidForCell(row, col, selectedDir)) return;

    executeMove({ row, col, shape: selectedShape, dir: selectedShape === "triangle" ? selectedDir : undefined });
  }

  const executeMove = useCallback((m: FullLegalMove) => {
    const s = latestStateRef.current;
    const { board: curBoard, inventory: curInv, currentPlayer: curPlayer, moveHistoryLen: curLen, whiteFirstShape: curWfs, lastMove: curLast, gameMovesLog: curLog, aiWeights: curWeights, lostPatterns: curLost, winPatterns: curWin, learningRate: curLR, gameMode: curMode, aiDifficulty: curDiff } = s;

    const newBoard = cloneBoard(curBoard);
    if (m.shape === "square") newBoard[m.row][m.col].square = curPlayer;
    else if (m.shape === "triangle") newBoard[m.row][m.col].triangle = { color: curPlayer, dir: m.dir! };
    else newBoard[m.row][m.col].circle = curPlayer;

    const newInv = { white: { ...curInv.white }, black: { ...curInv.black } };
    newInv[curPlayer][m.shape]--;

    const nextWfs = curLen === 0 && curPlayer === "white" ? m.shape : curWfs;
    if (curLen === 0 && curPlayer === "white") setWhiteFirstShape(m.shape);

    const newLast: LastMove = { shape: m.shape, row: m.row, col: m.col, dir: m.dir, by: curPlayer };
    const nextP: Color = curPlayer === "white" ? "black" : "white";
    const nextHistoryLen = curLen + 1;

    const moveDesc = `${curPlayer === "white" ? "白" : "黒"}: ${m.shape === "square" ? "■" : m.shape === "triangle" ? "▲" : "●"}${m.shape === "triangle" ? `(${dirSymbol(m.dir!)})` : ""} → (${m.row + 1},${m.col + 1})`;

    const curBanned = getBannedShape(curPlayer, curLen, curWfs);
    const curLegals = generateAllLegalMoves(curBoard, curLast, curInv[curPlayer], curBanned);
    const opp: Color = curPlayer === "white" ? "black" : "white";
    const oppBanned = getBannedShape(opp, curLen, curWfs);
    const oppMoves = generateAllLegalMoves(curBoard, curLast, curInv[opp], oppBanned).length;
    const whiteMovesCount = curPlayer === "white" ? curLegals.length : oppMoves;
    const blackMovesCount = curPlayer === "black" ? curLegals.length : oppMoves;
    const currentFeatures = getFeatureVector(curBoard, whiteMovesCount, blackMovesCount, curInv);
    const updatedMovesLog = [
      ...curLog,
      { board: cloneBoard(curBoard), move: { ...m }, player: curPlayer, features: currentFeatures },
    ];
    setGameMovesLog(updatedMovesLog);

    setHistory((h) => [moveDesc, ...h].slice(0, 20));
    setBoard(newBoard);
    setInventory(newInv);
    setLastMove(newLast);
    setMoveHistoryLen(nextHistoryLen);
    setCurrentPlayer(nextP);

    const nextBanned = getBannedShape(nextP, nextHistoryLen, nextWfs);
    const nextLegals = generateAllLegalMoves(newBoard, newLast, newInv[nextP], nextBanned);
    const nextTowers = countTowers(newBoard);
    const goState = checkGameOverState(newBoard, nextLegals.length, nextTowers);

    if (goState.isOver) {
      setWinner(goState.winner);
      setGameOver(true);

      const gameWinner = goState.winner;
      const gameLoser = gameWinner === "white" ? "black" : gameWinner === "black" ? "white" : null;
      const gameRecord: GameRecord = { moves: updatedMovesLog, winner: gameWinner || "draw", loser: gameLoser };

      const { newLostPatterns, newWinPatterns } = extractLearningPatterns(gameRecord, curLost, curWin);
      setLostPatterns((prev) => appendBoundedPatterns(prev, newLostPatterns, MAX_PATTERNS));
      setWinPatterns((prev) => appendBoundedPatterns(prev, newWinPatterns, MAX_PATTERNS));

      const newWeights = updateWeightsTD(curWeights, gameRecord, curLR);
      setAiWeights(newWeights);

      setLearningHistory((prev) => ({
        totalGames: prev.totalGames + 1,
        whiteWins: prev.whiteWins + (gameWinner === "white" ? 1 : 0),
        blackWins: prev.blackWins + (gameWinner === "black" ? 1 : 0),
        draws: prev.draws + (gameWinner === "draw" ? 1 : 0),
        patternsLearned: prev.patternsLearned + newLostPatterns.length + newWinPatterns.length,
        lastUpdateTime: Date.now(),
      }));

      setTrainLog(`対局から学習完了: ${gameWinner === "draw" ? "引き分け" : gameWinner === "white" ? "白の勝ち" : "黒の勝ち"} (+${newLostPatterns.length}負けパターン、+${newWinPatterns.length}勝ちパターン)`);

      if (curMode !== "human" && curDiff === "master") {
        saveWinningBoardInternal(newBoard, goState.winner!, nextHistoryLen, "AI決着対局 (マスター)");
      }
    }
  }, []);

  // AI turn handling (offloaded to Web Worker to keep UI responsive)
  useEffect(() => {
    if (gameOver || winner || aiThinking) return;

    const isAITurn =
      (gameMode === "ai_black" && currentPlayer === "black") ||
      (gameMode === "ai_white" && currentPlayer === "white") ||
      (gameMode === "ai_vs_ai");

    if (!isAITurn) return;

    let cancelled = false;
    setAiThinking(true);
    const delay = gameMode === "ai_vs_ai" ? 200 : 400;

    const timer = setTimeout(async () => {
      const s = latestStateRef.current;
      try {
        const result = await callWorker<{ move: FullLegalMove; stats: { nodes: number; patternsAvoided: number; eval: number } }>(
          "ai-move",
          {
            board: s.board,
            lastMove: s.lastMove,
            whiteFirstShape: s.whiteFirstShape,
            historyLen: s.moveHistoryLen,
            player: s.currentPlayer,
            inv: s.inventory,
            weights: s.aiWeights,
            difficulty: s.aiDifficulty,
            lostPatterns: s.lostPatterns,
            winPatterns: s.winPatterns,
            options: { enableOpeningBook, enableTemperature, enableTransposition, temperature },
          },
        );
        if (cancelled) return;
        const cur = latestStateRef.current;
        if (cur.gameOver || cur.winner || cur.currentPlayer !== s.currentPlayer) return;
        setSearchStats(result.stats);
        executeMove(result.move);
      } catch (e) {
        if (!cancelled) console.error("AI Error:", e);
      } finally {
        if (!cancelled) setAiThinking(false);
      }
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setAiThinking(false);
    };
  }, [currentPlayer, gameMode, aiDifficulty, gameOver, winner, board, lastMove, whiteFirstShape, moveHistoryLen, inventory, aiWeights, lostPatterns, winPatterns, executeMove, enableOpeningBook, enableTemperature, enableTransposition, temperature, callWorker]);

  function resetGame() {
    setBoard(emptyBoard());
    setCurrentPlayer("white");
    setInventory(startingInventory());
    setLastMove(null);
    setWhiteFirstShape(null);
    setHistory([]);
    setMoveHistoryLen(0);
    setWinner(null);
    setGameOver(false);
    setAiThinking(false);
    setSearchStats(null);
    setGameMovesLog([]);
  }

  // Training functions
  async function runTrainingBatch(size: number) {
    if (isTraining) return;
    setIsTraining(true);
    setTrainProgress(0);
    setTrainLog(`学習開始: ${size}回の自己対局をワーカーで実行中...`);

    const s = latestStateRef.current;
    try {
      const result = await callWorker<{
        weights: AIWeights;
        lostPatterns: LostPattern[];
        winPatterns: WinPattern[];
        whiteWins: number;
        blackWins: number;
        draws: number;
        totalGames: number;
      }>("train-batch", {
        weights: s.aiWeights,
        lostPatterns: s.lostPatterns,
        winPatterns: s.winPatterns,
        epsilon,
        learningRate,
        count: size,
      }, (msg) => {
        setTrainProgress(msg.progress ?? 0);
        setTrainLog(`自己対局 #${msg.completed}/${msg.count}: ${msg.winner === "white" ? "白勝" : msg.winner === "black" ? "黒勝" : "引分"} | 新規負けP: ${msg.newLost} | 新規勝ちP: ${msg.newWin}`);
      });

      setAiWeights(sanitizeWeights(result.weights, DEFAULT_WEIGHTS));
      setLostPatterns(result.lostPatterns.slice(-MAX_PATTERNS));
      setWinPatterns(result.winPatterns.slice(-MAX_PATTERNS));
      setLearningHistory((prev) => ({
        totalGames: prev.totalGames + result.totalGames,
        whiteWins: prev.whiteWins + result.whiteWins,
        blackWins: prev.blackWins + result.blackWins,
        draws: prev.draws + result.draws,
        patternsLearned: result.lostPatterns.length + result.winPatterns.length,
        lastUpdateTime: Date.now(),
      }));
      setTrainProgress(100);
      setTrainLog(`学習完了: ${size}回 | 白勝 ${result.whiteWins} / 黒勝 ${result.blackWins} / 引分 ${result.draws}`);
    } catch (e) {
      console.error("Training failed", e);
      setTrainLog(`学習エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsTraining(false);
    }
  }

  function startCustomTraining() {
    const count = parseInt(customTrainCount);
    if (isNaN(count) || count <= 0) {
      alert("1以上の数値を入力してください");
      return;
    }
    runTrainingBatch(count);
  }

  async function runEvaluation() {
    if (isEvaluating || isTraining) return;
    setIsEvaluating(true);
    setEvalResult(null);
    try {
      const s = latestStateRef.current;
      const result = await callWorker<{ wins: number; losses: number; draws: number }>("evaluate-baseline", {
        weights: s.aiWeights,
        baseline: DEFAULT_WEIGHTS,
        games: 20,
      });
      setEvalResult(result);
      setTrainLog(`評価(20局, depth2): 勝ち ${result.wins} / 負け ${result.losses} / 引分 ${result.draws}`);
    } catch (e) {
      console.error("Evaluation failed", e);
      setTrainLog(`評価エラー: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsEvaluating(false);
    }
  }

  function resetTrainingParams() {
    if (window.confirm("AIの学習データ（重み、パターン）を完全にリセットしますか？")) {
      setAiWeights(DEFAULT_WEIGHTS);
      setLostPatterns([]);
      setWinPatterns([]);
      setLearningHistory({ totalGames: 0, whiteWins: 0, blackWins: 0, draws: 0, patternsLearned: 0, lastUpdateTime: 0 });
      localStorage.removeItem("pyrga_ai_weights_v2");
      localStorage.removeItem("pyrga_lost_patterns");
      localStorage.removeItem("pyrga_win_patterns");
      localStorage.removeItem("pyrga_learning_history");
      setTrainLog("AIの知識をリセットしました。");
    }
  }

  function saveWinningBoardInternal(b: Cell[][], win: Color | "draw", moves: number, customName?: string) {
    setSavedGames(prev => {
      const exists = prev.some(g => JSON.stringify(g.board) === JSON.stringify(b));
      if (exists) return prev;
      const newGame: SavedGame = {
        id: "game_" + Math.random().toString(36).substr(2, 9),
        name: customName || `決着盤面 #${prev.length + 1} (${moves}手)`,
        winner: win,
        moveCount: moves,
        date: new Date().toLocaleString(),
        board: b,
        lastMove: null
      };
      const next = [newGame, ...prev].slice(0, 30);
      return next;
    });
  }

  function saveCurrentBoard() {
    const name = window.prompt("この盤面に名前をつけて保存します:", `対局局面 (${moveHistoryLen}手目)`);
    if (name) {
      saveWinningBoardInternal(board, winner || "draw", moveHistoryLen, name);
      alert("盤面アーカイブに保存しました！");
    }
  }

  function deleteSavedGame(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (window.confirm("この盤面レコードを削除しますか？")) {
      setSavedGames(prev => prev.filter(g => g.id !== id));
      if (viewingSavedGame?.id === id) setViewingSavedGame(null);
    }
  }

  const winRate = useMemo(() => {
    const total = learningHistory.whiteWins + learningHistory.blackWins + learningHistory.draws;
    return total === 0 ? 0 : Math.round((learningHistory.whiteWins / total) * 100);
  }, [learningHistory]);

  const maxWeightValue = useMemo(() => Math.max(...Object.values(aiWeights).map(Math.abs), 100), [aiWeights]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-6xl">
        
        <header className="mb-4 flex flex-col gap-2 border-b border-slate-700 pb-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="bg-gradient-to-r from-amber-300 via-rose-300 to-violet-300 bg-clip-text text-4xl font-black tracking-tight text-transparent">PYRGA AI</h1>
              <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs font-bold tracking-wider text-indigo-300 border border-indigo-500/30">PATTERN LEARNING v2.0</span>
            </div>
            <p className="text-xs text-slate-400">同じ負け方をしない — 経験から学ぶ最強のピルガAI</p>
          </div>
          
          <div className="flex gap-1 rounded-xl bg-slate-800/80 p-1 border border-slate-700">
            {(["game", "train", "archive"] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold transition ${activeTab === tab ? "bg-amber-400 text-slate-900" : "text-slate-300 hover:bg-slate-700/60"}`}>
                {tab === "game" && "🎮 対局"}
                {tab === "train" && "🧠 AI強化センター"}
                {tab === "archive" && "📜 盤面アーカイブ"}
                {tab === "archive" && savedGames.length > 0 && <span className="ml-1 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] text-white">{savedGames.length}</span>}
              </button>
            ))}
          </div>
        </header>

        {/* TAB 1: GAME */}
        {activeTab === "game" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr]">
            <PlayerPanel color="white" inventory={inventory.white} isCurrent={currentPlayer === "white" && !gameOver} towers={towers.white} partials={partialW.white} selectedShape={selectedShape} selectedDir={selectedDir} onSelectShape={setSelectedShape} onSelectDir={setSelectedDir} disabled={currentPlayer !== "white" || gameOver || aiThinking} bannedShape={bannedShape} validTriangleDirs={validTriangleDirs} isAI={gameMode === "ai_white" || gameMode === "ai_vs_ai"} />
            
            <div className="flex flex-col items-center gap-3">
              <div className="flex w-full max-w-[540px] flex-col gap-2 rounded-xl border border-slate-700 bg-slate-900/50 p-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-300">モード:</span>
                    <select value={gameMode} onChange={(e) => { setGameMode(e.target.value as any); resetGame(); }} className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semibold text-slate-100">
                      <option value="human">PvP</option>
                      <option value="ai_black">vs AI (黒)</option>
                      <option value="ai_white">AI (白) vs 人間</option>
                      <option value="ai_vs_ai">AI vs AI</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-slate-300">難易度:</span>
                    <select value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value as any)} disabled={gameMode === "human"} className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-semibold text-slate-100 disabled:opacity-40">
                      <option value="easy">初級</option>
                      <option value="normal">中級</option>
                      <option value="hard">上級</option>
                      <option value="master">最強</option>
                    </select>
                  </div>
                  <button onClick={resetGame} className="rounded border border-slate-600 bg-slate-800/80 px-2.5 py-1 font-bold text-slate-200 hover:bg-slate-700">🔄 リセット</button>
                </div>
              </div>

              <StatusBar currentPlayer={currentPlayer} gameOver={gameOver} winner={winner} fallback={fallback} lastMove={lastMove} legalCount={legalMoves.length} bannedShape={bannedShape} aiThinking={aiThinking} searchStats={searchStats}  lostPatternsCount={lostPatterns.length} />

              <div className="relative">
                <div className="grid grid-cols-4 gap-2 rounded-2xl border border-slate-600 bg-slate-900/80 p-3 shadow-2xl" style={{ width: "min(540px, 90vw)" }}>
                  {board.map((row, r) => row.map((cell, c) => <CellView key={`${r}-${c}`} cell={cell} isValid={validCellSet.has(`${r},${c}`) && !gameOver && !aiThinking} isLast={!!(lastMove?.row === r && lastMove?.col === c)} onClick={() => handleCellClick(r, c)} />))}
                </div>
                {aiThinking && aiDifficulty === "master" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-slate-950/40 backdrop-blur-sm">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-400 border-t-transparent" />
                    <div className="mt-3 rounded bg-slate-900/90 border border-slate-700 px-3 py-1.5 text-center shadow-lg">
                      <div className="font-bold text-amber-300 animate-pulse">AI 思考中</div>
                      <div className="mt-1 font-mono text-[10px] text-slate-400">{searchStats ? `探索: ${searchStats.nodes}ノード | 回避パターン: ${searchStats.patternsAvoided}` : "探索中..."}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex w-full max-w-[540px] items-start gap-3">
                <div className="flex-1 rounded-xl border border-slate-700 bg-slate-900/50 p-2.5 text-xs">
                  <div className="mb-1 flex items-center justify-between font-semibold text-slate-300">
                    <span>手の履歴 ({moveHistoryLen}手)</span>
                    <button onClick={saveCurrentBoard} className="rounded bg-indigo-500/20 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/30">💾 記録</button>
                  </div>
                  {history.length === 0 ? <div className="py-2 text-center text-slate-500">対局を開始してください</div> : <ol className="grid max-h-24 grid-cols-2 gap-x-3 gap-y-0.5 overflow-y-auto font-mono text-slate-400">{history.map((h, i) => <li key={i} className={i === 0 ? "font-bold text-amber-400" : ""}>{history.length - i}. {h}</li>)}</ol>}
                </div>
              </div>
            </div>

            <PlayerPanel color="black" inventory={inventory.black} isCurrent={currentPlayer === "black" && !gameOver} towers={towers.black} partials={partialW.black} selectedShape={selectedShape} selectedDir={selectedDir} onSelectShape={setSelectedShape} onSelectDir={setSelectedDir} disabled={currentPlayer !== "black" || gameOver || aiThinking} bannedShape={null} validTriangleDirs={validTriangleDirs} isAI={gameMode === "ai_black" || gameMode === "ai_vs_ai"} />
          </div>
        )}

        {/* TAB 2: TRAINING */}
        {activeTab === "train" && (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="text-base font-bold border-b border-slate-700 pb-1.5 text-amber-300 flex items-center gap-1.5">🧠 経験学習ステータス</h2>
              
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-slate-800/60 p-3 border border-slate-700/50">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">総学習対局</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-slate-100">{learningHistory.totalGames}</div>
                </div>
                <div className="rounded-xl bg-slate-800/60 p-3 border border-slate-700/50">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">記憶パターン</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-rose-400">{lostPatterns.length + winPatterns.length}</div>
                </div>
                <div className="rounded-xl bg-slate-800/60 p-3 border border-slate-700/50">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">白勝率</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-amber-400">{winRate}%</div>
                </div>
              </div>

              <div className="rounded-xl bg-slate-800/30 p-3 border border-slate-700/30 text-xs text-slate-400">
                <div className="mb-1.5 font-semibold text-rose-300">⚠️ 負けパターン記録: {lostPatterns.length}</div>
                <div className="mb-2 font-semibold text-emerald-300">✅ 勝ちパターン記録: {winPatterns.length}</div>
                <div className="border-t border-slate-700/50 pt-2 mt-2 flex gap-4 font-mono">
                  <div>白勝: <span className="font-bold text-slate-200">{learningHistory.whiteWins}</span></div>
                  <div>黒勝: <span className="font-bold text-slate-200">{learningHistory.blackWins}</span></div>
                  <div>引分: <span className="font-bold text-slate-200">{learningHistory.draws}</span></div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl bg-slate-800/40 p-3 border border-slate-700/50 text-xs">
                <div>
                  <div className="flex justify-between font-semibold mb-1"><span className="text-slate-400">学習率 (α)</span><span className="font-mono text-amber-400">{learningRate}</span></div>
                  <input type="range" min="0.001" max="0.05" step="0.001" value={learningRate} onChange={(e) => setLearningRate(parseFloat(e.target.value))} disabled={isTraining} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400" />
                </div>
                <div>
                  <div className="flex justify-between font-semibold mb-1"><span className="text-slate-400">探索率 (ε)</span><span className="font-mono text-amber-400">{(epsilon * 100).toFixed(0)}%</span></div>
                  <input type="range" min="0" max="0.3" step="0.01" value={epsilon} onChange={(e) => setEpsilon(parseFloat(e.target.value))} disabled={isTraining} className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400" />
                </div>
              </div>

              <div className="mt-auto space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={customTrainCount}
                    onChange={(e) => setCustomTrainCount(e.target.value)}
                    disabled={isTraining}
                    min="1"
                    max="10000"
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs font-bold text-slate-100 disabled:opacity-40"
                    placeholder="回数を入力"
                  />
                  <button disabled={isTraining} onClick={startCustomTraining} className="flex-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">カスタム学習</button>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <button disabled={isTraining} onClick={() => runTrainingBatch(10)} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">10回</button>
                  <button disabled={isTraining} onClick={() => runTrainingBatch(50)} className="rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">50回</button>
                  <button disabled={isTraining} onClick={() => runTrainingBatch(100)} className="rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 hover:from-amber-400 hover:to-rose-400 disabled:opacity-40 py-1.5 text-xs font-bold text-slate-950 transition shadow">100回</button>
                  <button disabled={isTraining} onClick={() => runTrainingBatch(500)} className="rounded-lg bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400 disabled:opacity-40 py-1.5 text-xs font-bold text-slate-950 transition shadow">500回</button>
                </div>

                <button disabled={isTraining || isEvaluating} onClick={runEvaluation} className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 py-1.5 text-xs font-bold text-white transition shadow">{isEvaluating ? "評価中..." : "ベースライン評価 (20局)"}</button>
                {evalResult && (
                  <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-2 text-[11px] text-emerald-200 font-mono">
                    vs DEFAULT(depth2): W {evalResult.wins} / L {evalResult.losses} / D {evalResult.draws}
                  </div>
                )}
                <button disabled={isTraining} onClick={resetTrainingParams} className="w-full rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-400 py-1.5 text-xs transition">知識を完全にリセット</button>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col gap-4 rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
              <h2 className="text-base font-bold border-b border-slate-700 pb-1.5 text-amber-300">📊 学習状況リアルタイム</h2>

              {isTraining && (
                <div className="rounded-xl bg-indigo-950/40 border border-indigo-700/30 p-3">
                  <div className="flex justify-between text-xs font-bold text-indigo-300 mb-1"><span>学習中...</span><span className="font-mono">{trainProgress}%</span></div>
                  <div className="w-full bg-slate-800 rounded-full h-2"><div className="bg-gradient-to-r from-indigo-500 to-amber-400 h-2 rounded-full transition-all" style={{ width: `${trainProgress}%` }}></div></div>
                  <div className="mt-1 text-center font-mono text-[10px] text-slate-400 truncate">{trainLog}</div>
                </div>
              )}

              <div className="flex-1 space-y-2">
                <WeightBar label="w1: 塔支配" value={aiWeights.tower} maxVal={maxWeightValue} color="bg-amber-400" />
                <WeightBar label="w2: 2駒優勢" value={aiWeights.partial2} maxVal={maxWeightValue} color="bg-rose-400" />
                <WeightBar label="w3: 1駒優勢" value={aiWeights.partial1} maxVal={maxWeightValue} color="bg-orange-400" />
                <WeightBar label="w4: 機動力" value={aiWeights.mobility} maxVal={maxWeightValue} color="bg-sky-400" />
                <WeightBar label="w5: ■残り数" value={aiWeights.sqInv} maxVal={maxWeightValue} color="bg-emerald-400" />
                <WeightBar label="w6: ▲残り数" value={aiWeights.trInv} maxVal={maxWeightValue} color="bg-teal-400" />
                <WeightBar label="w7: ●残り数" value={aiWeights.ciInv} maxVal={maxWeightValue} color="bg-green-400" />
                <WeightBar label="w8: 中央支配" value={aiWeights.center} maxVal={maxWeightValue} color="bg-violet-400" />
                <WeightBar label="w9: リーチ" value={aiWeights.completion} maxVal={maxWeightValue} color="bg-pink-400" />
                <WeightBar label="w10: パターン回避" value={aiWeights.patternAvoid} maxVal={maxWeightValue} color="bg-red-400" desc="過去に負けにつながった手を避ける重み" />
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-xs text-slate-400">
                <div className="font-bold text-slate-300 mb-2">💡 AI強化機構</div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                    <input type="checkbox" checked={enableOpeningBook} onChange={(e) => setEnableOpeningBook(e.target.checked)} disabled={isTraining} className="w-3 h-3 rounded" />
                    <span>📖 オープニングブック（初手の最適応答を学習）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                    <input type="checkbox" checked={enableTemperature} onChange={(e) => setEnableTemperature(e.target.checked)} disabled={isTraining} className="w-3 h-3 rounded" />
                    <span>🌡️ 温度付き探索（多様な戦略の発見）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer hover:text-slate-300">
                    <input type="checkbox" checked={enableTransposition} onChange={(e) => setEnableTransposition(e.target.checked)} disabled={isTraining} className="w-3 h-3 rounded" />
                    <span>⚡ トランスポジション表（同一盤面の再計算を削減）</span>
                  </label>
                  {enableTemperature && (
                    <div className="ml-5 mt-2">
                      <div className="flex justify-between text-[10px] mb-1">
                        <span>温度パラメータ (τ)</span>
                        <span className="font-mono text-amber-400">{temperature.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="2.0"
                        step="0.1"
                        value={temperature}
                        onChange={(e) => setTemperature(parseFloat(e.target.value))}
                        disabled={isTraining || !enableTemperature}
                        className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400"
                      />
                      <p className="text-[9px] text-slate-500 mt-1">低いほど最適手の確率を重視、高いほど多様性を重視</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: ARCHIVE */}
        {activeTab === "archive" && (
          <div className="grid gap-6 md:grid-cols-[280px_1fr]">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-900/50 p-4 max-h-[70vh] overflow-y-auto">
              <h2 className="text-base font-bold border-b border-slate-700 pb-1.5 text-indigo-300">📜 記録済み盤面</h2>
              {savedGames.length === 0 ? <div className="text-center text-slate-500 py-8 text-sm">記録なし</div> : (
                <div className="flex flex-col gap-2">
                  {savedGames.map(g => (
                    <div key={g.id} onClick={() => setViewingSavedGame(g)} className={`group relative flex flex-col gap-1 rounded-xl border p-2.5 cursor-pointer transition ${viewingSavedGame?.id === g.id ? "border-amber-400 bg-amber-400/10" : "border-slate-700 bg-slate-800/40 hover:bg-slate-800/80"}`}>
                      <button onClick={(e) => deleteSavedGame(g.id, e)} className="absolute top-2 right-2 rounded p-1 text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100">🗑️</button>
                      <div className="pr-6 font-bold text-xs text-slate-200 truncate">{g.name}</div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>{g.date.split(" ")[0]} ({g.moveCount}手)</span>
                        <span className={`rounded px-1 font-bold ${g.winner === "white" ? "bg-slate-100 text-slate-900" : g.winner === "black" ? "bg-slate-950 text-slate-100 border border-slate-700" : "bg-slate-700 text-slate-200"}`}>{g.winner === "white" ? "白勝" : g.winner === "black" ? "黒勝" : "引分"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700 bg-slate-900/50 p-6">
              {viewingSavedGame ? (
                <div className="flex flex-col items-center gap-4 w-full">
                  <div className="text-center w-full max-w-[480px]">
                    <div className="text-sm font-bold text-amber-300">🔍 盤面リプレイ</div>
                    <div className="text-xl font-black text-slate-100 mt-0.5">{viewingSavedGame.name}</div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 rounded-2xl border border-slate-600 bg-slate-950 p-3" style={{ width: "min(420px, 80vw)" }}>
                    {viewingSavedGame.board.map((row, r) => row.map((cell, c) => <CellView key={`v-${r}-${c}`} cell={cell} isValid={false} isLast={false} onClick={() => {}} />))}
                  </div>
                  <div className="flex w-full max-w-[420px] gap-3 text-xs">
                    <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-center">
                      <div className="text-slate-400">白支配</div>
                      <div className="text-lg font-black text-slate-100">{countTowers(viewingSavedGame.board).white}</div>
                    </div>
                    <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-center">
                      <div className="text-slate-400">勝者</div>
                      <div className={`text-sm font-bold mt-1 inline-block px-2 py-0.5 rounded ${viewingSavedGame.winner === "white" ? "bg-slate-100 text-slate-900" : viewingSavedGame.winner === "black" ? "bg-slate-950 text-slate-100 border border-slate-700" : "bg-slate-700 text-slate-200"}`}>{viewingSavedGame.winner === "white" ? "👑 白" : viewingSavedGame.winner === "black" ? "👑 黒" : "引分"}</div>
                    </div>
                    <div className="flex-1 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5 text-center">
                      <div className="text-slate-400">黒支配</div>
                      <div className="text-lg font-black text-slate-100">{countTowers(viewingSavedGame.board).black}</div>
                    </div>
                  </div>
                  <button onClick={() => setViewingSavedGame(null)} className="mt-2 rounded bg-slate-800 border border-slate-700 hover:bg-slate-700 px-4 py-1.5 text-xs text-slate-200">閉じる</button>
                </div>
              ) : (
                <div className="flex flex-col items-center py-20 text-slate-500 text-center">
                  <span className="text-4xl mb-3">📜</span>
                  <div className="text-sm font-bold">盤面を選択</div>
                </div>
              )}
            </div>
          </div>
        )}

        <RulesPanel />
      </div>

      {gameOver && activeTab === "game" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
            <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">対局終了</div>
            <div className="mb-4 text-3xl font-black bg-gradient-to-r from-amber-300 to-rose-300 bg-clip-text text-transparent">
              {winner === "white" && "🏆 白の勝利！"}
              {winner === "black" && "🏆 黒の勝利！"}
              {winner === "draw" && "🤝 引き分け"}
            </div>
            <div className="mb-6 rounded-xl bg-slate-800/80 p-3 border border-slate-700/50 text-xs text-slate-300">
              <div className="flex items-center justify-around mb-2">
                <div><div className="text-[10px] text-slate-400">白</div><div className="text-2xl font-black text-slate-100">{towers.white}</div></div>
                <div className="text-xl text-slate-500 font-bold">VS</div>
                <div><div className="text-[10px] text-slate-400">黒</div><div className="text-2xl font-black text-slate-100">{towers.black}</div></div>
              </div>
            </div>
            <button onClick={resetGame} className="w-full rounded-xl bg-gradient-to-r from-amber-400 to-rose-500 px-5 py-2.5 font-bold text-slate-950 hover:scale-[1.02] shadow-lg">もう一度</button>
          </div>
        </div>
      )}
    </div>
  );
}


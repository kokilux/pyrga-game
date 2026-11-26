# Pyrga (ピルガ)

A 4x4 strategy board game with a pattern-learning AI, built with React 19, TypeScript, Vite, and Tailwind CSS.

## Overview

Two players (White/Black) take turns placing pieces on a 4x4 board. Each cell can hold up to three different piece types: **Square (■)**, **Triangle (▲)**, and **Circle (●)**. The first player to control **3 towers** wins.

The project includes an AI opponent with alpha-beta search and a lightweight learning system that records win/loss patterns from self-play and human games.

## Rules

- **Board**: 4x4 grid. Each cell may contain at most one ■, one ▲, and one ● (pieces can be from either player).
- **Inventory**: Each player starts with 5 of each shape (15 pieces total).
- **Tower**: A cell containing all three shapes. The tower is controlled by the player who owns 2+ pieces in that cell.
- **Win condition**: First player to control 3 towers wins.
- **Placement restriction (Rule 2)**: After the first move, placement is restricted by the previous move:
  - **■ Square**: place in any orthogonally adjacent cell (up/down/left/right).
  - **▲ Triangle**: place in any cell along the direction the triangle points, in a straight line.
  - **● Circle**: place in the same cell.
- **Fallback (Rule 3)**: If no legal move exists under Rule 2, the player may place any available piece on any empty cell.
- **White 2nd-move restriction**: White’s second move (game move #3 overall) cannot use the same shape as White’s first move.
- **Triangle direction**: A triangle cannot point outside the board.
- **Endgame / tie-break**: If a player has no legal moves, compare controlled towers. If tied, compare cells with 2-piece advantage, then 1-piece advantage; otherwise draw.

## Development

```bash
npm install
npm run dev
```

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start Vite dev server |
| `npm run build` | Typecheck and build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript checks (`tsc --noEmit`) |

## AI & Learning

- **Modes**: Human vs Human, Human vs AI (Black/White), AI vs AI.
- **Difficulty**: Easy (random), Normal (depth 2), Hard (depth 3), Master (depth 4) alpha-beta search.
- **Learning**: The AI stores evaluation weights and win/loss patterns in browser `localStorage`. Self-play training and completed human games update these records.
- **Reset**: Use the “知識を完全にリセット” button in the AI Training Center to clear learned weights/patterns.

## Project Structure

```text
src/
  App.tsx        # Game UI, game rules, AI, learning, persistence (currently monolithic)
  main.tsx       # React entry point
  index.css      # Tailwind entry
  utils/cn.ts    # className utility (currently unused)
```

## Notes

- Learning data is stored locally in the browser (`localStorage`); it is not synced across devices.
- This repository is an early prototype; game engine extraction and automated tests are planned improvements.

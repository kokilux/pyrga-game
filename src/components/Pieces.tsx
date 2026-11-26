import type { Color, Direction, Shape } from "../engine/types";

export function dirSymbol(dir: Direction): string {
  return { up: "↑", down: "↓", left: "←", right: "→" }[dir];
}

export function PieceSquare({ color, size = 28 }: { color: Color; size?: number }) {
  const fill = color === "white" ? "#f8fafc" : "#0f172a";
  const stroke = color === "white" ? "#0f172a" : "#f8fafc";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect x="4" y="4" width="24" height="24" rx="2" fill={fill} stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

export function PieceTriangle({ color, dir = "up", size = 28 }: { color: Color; dir?: Direction; size?: number }) {
  const fill = color === "white" ? "#f8fafc" : "#0f172a";
  const stroke = color === "white" ? "#0f172a" : "#f8fafc";
  const rotate = { up: 0, right: 90, down: 180, left: 270 }[dir];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <polygon points="16,3 29,28 3,28" fill={fill} stroke={stroke} strokeWidth="2" strokeLinejoin="round" transform={`rotate(${rotate} 16 16)`} />
    </svg>
  );
}

export function PieceCircle({ color, size = 28 }: { color: Color; size?: number }) {
  const fill = color === "white" ? "#f8fafc" : "#0f172a";
  const stroke = color === "white" ? "#0f172a" : "#f8fafc";
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="12" fill={fill} stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

export function PieceIcon({ shape, color, dir, size }: { shape: Shape; color: Color; dir?: Direction; size?: number }) {
  if (shape === "square") return <PieceSquare color={color} size={size} />;
  if (shape === "triangle") return <PieceTriangle color={color} dir={dir} size={size} />;
  return <PieceCircle color={color} size={size} />;
}

export function EmptySlot({ shape, size = 22 }: { shape: Shape; size?: number }) {
  const stroke = "#475569";
  if (shape === "square") return <svg width={size} height={size} viewBox="0 0 32 32"><rect x="5" y="5" width="22" height="22" rx="2" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
  if (shape === "triangle") return <svg width={size} height={size} viewBox="0 0 32 32"><polygon points="16,4 28,27 4,27" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
  return <svg width={size} height={size} viewBox="0 0 32 32"><circle cx="16" cy="16" r="11" fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="3 3" /></svg>;
}

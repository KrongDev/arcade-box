/**
 * 아케이드박스 픽셀 아이콘 — 16×16 칸에 찍은 그림. 오락실 타이틀처럼 칸이 보이게 그린다.
 * 보상·게임·아이템처럼 "물건"을 보여 줄 때 쓰고, 버튼 안 조작 아이콘(닫기·꺾쇠)은 icons.tsx를 쓴다.
 *
 * 칸 지도의 글자 하나가 한 칸의 색이다('.'은 빈칸). 같은 색 칸은 path 하나로 묶어 그린다.
 * 16의 배수 크기(16·32·48)로 쓰면 칸이 고르게 보인다.
 * 장식이라 기본은 aria-hidden이다. 뜻을 전해야 하면 label을 넘긴다.
 */
import { memo } from 'react';
import { pathsFor, type ArcadeIconName, type CoinTint } from './arcadeIconData';

export type { ArcadeIconName, CoinTint } from './arcadeIconData';

export const ArcadeIcon = memo(function ArcadeIcon({
  name,
  size = 32,
  label,
  className,
  coin,
}: {
  name: ArcadeIconName;
  size?: number | string;
  label?: string;
  className?: string;
  coin?: CoinTint;
}) {
  const tint = coin ? { F: coin.face, f: coin.light, A: coin.side } : undefined;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={className ? `arcade-icon ${className}` : 'arcade-icon'}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      shapeRendering="crispEdges"
      style={{ display: 'inline-block', verticalAlign: '-0.2em', flexShrink: 0 }}
    >
      {pathsFor(name, tint).map(([color, d]) => (
        <path key={color} d={d} fill={color} />
      ))}
    </svg>
  );
});

/** 게임별 아이콘 (코인 표시·탭·시트) */
export function GameIcon({ id, size = 16 }: { id: string; size?: number }) {
  return <ArcadeIcon name={id === 'minesweeper' ? 'bomb' : 'pinball'} size={size} />;
}

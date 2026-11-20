import type { BreakoutGear } from '../breakout/engine';
import {
  defaultItem,
  getItem,
  slotKey,
  type BallLook,
  type BrickSetLook,
  type Effect,
  type MapLook,
  type PaddleLook,
  type PinballTableLook,
  type ShopItem,
  type Slot,
  type TileLook,
} from './catalog';
import type { GameId } from './registry';
import type { SaveData } from './save';

export function isOwned(save: SaveData, item: ShopItem): boolean {
  if (item.price.type === 'free') return true;
  if (item.price.type === 'paid') {
    return Object.values(save.paidOrders).some((o) => o?.itemId === item.id && !o.refunded);
  }
  return save.owned.includes(item.id);
}

export function equippedItem(save: SaveData, game: GameId, slot: Slot): ShopItem {
  const id = save.equipped[slotKey(game, slot)];
  const item = id ? getItem(id) : undefined;
  return item && item.slot === slot && isOwned(save, item) ? item : defaultItem(game, slot);
}

export function isEquipped(save: SaveData, item: ShopItem): boolean {
  return equippedItem(save, item.game, item.slot).id === item.id;
}

export function pinballLooks(save: SaveData): { table: PinballTableLook; ball: BallLook } {
  const table = equippedItem(save, 'pinball', 'table');
  const ball = equippedItem(save, 'pinball', 'ball');
  return { table: table.look as PinballTableLook, ball: ball.look as BallLook };
}

/** 핀볼에 장착한 판·공의 능력과 이펙트 */
export interface PinballGear {
  coinSpawn: number;
  coinValue: number;
  effect: Effect;
}

export function pinballGear(save: SaveData): PinballGear {
  const table = equippedItem(save, 'pinball', 'table');
  const ball = equippedItem(save, 'pinball', 'ball');
  return {
    coinSpawn: table.ability?.coinSpawn ?? 0,
    coinValue: ball.ability?.coinValue ?? 0,
    effect: { ...table.effect, ...ball.effect },
  };
}

export function tileLook(save: SaveData): TileLook {
  return equippedItem(save, 'minesweeper', 'tile').look as TileLook;
}

export function mapLook(save: SaveData): MapLook {
  return equippedItem(save, 'minesweeper', 'map').look as MapLook;
}

/** 지뢰찾기에 장착한 발판·맵의 능력과 이펙트 */
export interface MinesweeperGear {
  tile: ShopItem;
  map: ShopItem;
  coinValue: number;
  shield: number;
  /** 초급·중급·고급에 더해지는 숨은 동전 수 */
  extraCoins: [number, number, number];
  effect: Effect;
}

export function minesweeperGear(save: SaveData): MinesweeperGear {
  const tile = equippedItem(save, 'minesweeper', 'tile');
  const map = equippedItem(save, 'minesweeper', 'map');
  return {
    tile,
    map,
    coinValue: tile.ability?.coinValue ?? 0,
    shield: tile.ability?.shield ?? 0,
    extraCoins: map.ability?.extraCoins ?? [0, 0, 0],
    effect: { ...tile.effect, ...map.effect },
  };
}

/** 벽돌깨기에 장착한 패들·벽돌 모양 */
export function breakoutLooks(save: SaveData): { paddle: PaddleLook; bricks: BrickSetLook } {
  return {
    paddle: equippedItem(save, 'breakout', 'paddle').look as PaddleLook,
    bricks: equippedItem(save, 'breakout', 'bricks').look as BrickSetLook,
  };
}

/** 벽돌깨기에 장착한 패들·벽돌의 능력 */
export function breakoutGear(save: SaveData): BreakoutGear {
  return {
    coinSpawn: equippedItem(save, 'breakout', 'bricks').ability?.coinSpawn ?? 0,
    coinValue: equippedItem(save, 'breakout', 'paddle').ability?.coinValue ?? 0,
  };
}

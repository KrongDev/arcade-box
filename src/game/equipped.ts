import { defaultItem, getItem, slotKey, type BallLook, type PinballTableLook, type ShopItem, type Slot, type TileLook } from './catalog';
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
  return item && isOwned(save, item) ? item : defaultItem(game, slot);
}

export function isEquipped(save: SaveData, item: ShopItem): boolean {
  return equippedItem(save, item.game, item.slot).id === item.id;
}

export function pinballLooks(save: SaveData): { table: PinballTableLook; ball: BallLook } {
  const table = equippedItem(save, 'pinball', 'table');
  const ball = equippedItem(save, 'pinball', 'ball');
  return { table: table.look as PinballTableLook, ball: ball.look as BallLook };
}

export function tileLook(save: SaveData): TileLook {
  return equippedItem(save, 'minesweeper', 'tile').look as TileLook;
}

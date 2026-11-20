import { createContext, useContext } from 'react';
import type { GameId } from './registry';
import type { RunReport } from './api';
import type { SaveData, Settings } from './save';
import type { SyncStatus } from './sync';

export interface ScoreResult {
  isBest: boolean;
  best: number;
  /** 이번 점수로 새로 열린 게임 */
  newlyUnlocked: GameId[];
}

export interface ClearResult {
  isBest: boolean;
  /** 최단 기록(초) */
  best: number;
  /** 이 단계를 처음 깼는지 */
  firstClear: boolean;
  /** 이번 클리어로 새로 열린 게임 */
  newlyUnlocked: GameId[];
}

export type BuyResult = 'ok' | 'owned' | 'insufficient' | 'unavailable';

export interface SaveApi {
  save: SaveData;
  addCoins: (gameId: GameId, amount: number) => void;
  recordScore: (gameId: GameId, score: number) => ScoreResult;
  /** 단계 클리어와 시간을 기록한다 (시간은 짧을수록 좋다) */
  recordClear: (stageKey: string, seconds: number) => ClearResult;
  /** 단계 점수를 기록한다 (높을수록 좋다). 못 깬 판도 기록한다 */
  recordStageScore: (stageKey: string, score: number) => { isBest: boolean; best: number };
  /** 코인 아이템을 산다. 성공하면 바로 장착한다 */
  buyItem: (itemId: string) => BuyResult;
  equipItem: (itemId: string) => void;
  /** 유료 아이템을 지급(기기 저장)하고 장착한다. 같은 주문은 한 번만 지급한다. 저장했으면 true */
  grantPaidOrder: (orderId: string, itemId: string) => boolean;
  updateSettings: (patch: Partial<Settings>) => void;
  /** 오늘 남은 광고 보상 횟수 */
  adRewardsLeft: number;
  /** 광고를 끝까지 본 보상을 그 게임 코인으로 지급한다. 오늘 횟수를 다 썼으면 false */
  claimAdReward: (gameId: GameId) => boolean;
  canClaimAttendance: boolean;
  claimAttendance: (gameId: GameId) => void;
  /** 한 판 결과를 서버에 보낸다 (서버를 안 쓰면 아무것도 하지 않는다) */
  submitRun: (report: RunReport) => void;
  /**
   * 내 기록 지우기 — 서버(있으면)와 기기의 코인·기록·아이템을 모두 지운다. 성공하면 true.
   * 유료 아이템은 토스 구매 내역으로 다시 받는다.
   */
  eraseRecords: () => Promise<boolean>;
  /** 서버 연결 상태. 서버 주소가 없으면 'off' */
  serverStatus: SyncStatus;
}

export const SaveContext = createContext<SaveApi | null>(null);

export function useSave(): SaveApi {
  const api = useContext(SaveContext);
  if (!api) throw new Error('useSave must be used inside SaveProvider');
  return api;
}

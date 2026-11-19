/**
 * 임시 진동 점검 패널 — 폰에서 진동이 오지 않는 원인을 찾으려고 넣었다.
 * 원인을 찾으면 이 파일과 Settings의 <HapticCheck />를 지운다. 검수 번들에는 넣지 않는다.
 */
import { Device, Environment, type HapticFeedbackType } from '@apps-in-toss/web-framework';
import { useState } from 'react';
import { haptic } from '../game/haptic';
import { useSave } from '../game/save-context';

const TYPES: HapticFeedbackType[] = ['tap', 'basicMedium', 'success', 'error', 'wiggle', 'confetti'];

function safe<T>(read: () => T): string {
  try {
    return String(read());
  } catch (e) {
    return `읽기 실패(${e instanceof Error ? e.message : String(e)})`;
  }
}

export function HapticCheck() {
  const { save } = useSave();
  const [log, setLog] = useState<string[]>([]);
  const push = (line: string) => setLog((prev) => [line, ...prev].slice(0, 8));

  const direct = (type: HapticFeedbackType) => {
    const started = performance.now();
    try {
      Device.triggerHaptic({ type }).then(
        (res) => push(`${type} → 성공 ${Math.round(performance.now() - started)}ms 응답=${JSON.stringify(res) ?? 'undefined'}`),
        (err: unknown) => push(`${type} → 실패: ${err instanceof Error ? `${err.name} ${err.message}` : JSON.stringify(err)}`),
      );
    } catch (err) {
      push(`${type} → 바로 오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const viaApp = () => {
    haptic('basicMedium', 0);
    push(`앱 경로(설정 진동=${save.settings.haptic ? '켜짐' : '꺼짐'}) 호출함`);
  };

  const webVibrate = () => {
    const nav = navigator as Navigator & { vibrate?: (p: number) => boolean };
    push(typeof nav.vibrate === 'function' ? `navigator.vibrate → ${String(nav.vibrate(200))}` : 'navigator.vibrate 없음');
  };

  return (
    <div className="settings-info">
      <p className="settings-info-title">진동 점검 (임시)</p>
      <p className="haptic-check-meta">
        기기 {safe(() => Device.os)} · 토스 {safe(() => Environment.tossAppVersion)}
      </p>
      <div className="haptic-check-buttons">
        {TYPES.map((t) => (
          <button key={t} type="button" className="ab-btn ab-btn--sm ab-btn--ghost" onClick={() => direct(t)}>
            {t}
          </button>
        ))}
        <button type="button" className="ab-btn ab-btn--sm ab-btn--ghost" onClick={viaApp}>
          앱 경로
        </button>
        <button type="button" className="ab-btn ab-btn--sm ab-btn--ghost" onClick={webVibrate}>
          웹 진동
        </button>
      </div>
      <ul className="haptic-check-log">
        {log.length === 0 ? <li>버튼을 눌러 보세요</li> : log.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
      </ul>
    </div>
  );
}

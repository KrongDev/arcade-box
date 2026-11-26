/**
 * admin — 운영 기록(`admin_actions`), 운영자가 조정하는 설정값(`app_config`), 바꾸는 명령의 틀.
 * 다른 도메인은 이 파일로만 가져온다 (테이블에 외래 키를 걸 때만 `schema.ts`).
 */
export { commands } from './commands.ts';
export { audit, CONFIG_DEFAULTS, getNumber, mutation, setNumber, type ConfigKey } from './service.ts';

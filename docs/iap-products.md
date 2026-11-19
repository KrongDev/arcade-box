# 인앱결제 상품 (유료 아이템 8개)

상점의 유료 아이템을 앱인토스 콘솔의 인앱결제 상품으로 등록할 때 쓰는 값이에요. 모두 **비소모품**(한 번 사면 계속 쓰는 상품)이에요.

## 등록 전에 콘솔 웹에서 할 일

공식 문서([인앱 결제](https://developers-apps-in-toss.toss.im/guide/monetization/in-app-payment)) 순서예요. 콘솔 MCP로는 할 수 없어서 콘솔 웹에서 직접 해야 해요.

1. **사업자 정보 등록**: 서류를 내면 검토에 영업일 1~2일 걸려요.
2. **정산 정보 입력**: 워크스페이스 '정보' 탭에서 입력해요. 검토에 영업일 평균 2~3일 걸려요.
3. **인앱결제 약관 동의**: '인앱결제상품약관동의' 페이지에서 해요. 워크스페이스 대표관리자만 할 수 있어요.
4. **거래처 등록**: 콘솔 웹 인앱결제 화면에서 해요.

## 상품

가격은 콘솔에 **공급가**(부가세 제외)로 넣어요. 사용자가 내는 판매가는 공급가에 부가세 10%를 더한 값으로 콘솔이 계산해요. 앱은 콘솔의 표시 가격을 먼저 보여 주고, 불러오지 못하면 `src/game/catalog.ts`의 판매가를 보여 줘요.

| 아이템 ID | 상품 이름 | 설명 | 공급가 | 판매가 | 아이콘 |
|---|---|---|---:|---:|---|
| `pinball.table.neon` | 네온 시티 판 (핀볼) | 핀볼 판 꾸미기 · 판 위 동전 20% 더 자주 · 네온 빛 · 평생 소장 | 3,000 | 3,300 | `assets/iap/pinball.table.neon.png` |
| `pinball.table.galaxy` | 은하수 판 (핀볼) | 핀볼 판 꾸미기 · 판 위 동전 30% 더 자주 · 별똥별 · 평생 소장 | 5,000 | 5,500 | `assets/iap/pinball.table.galaxy.png` |
| `pinball.ball.ruby` | 루비 공 (핀볼) | 핀볼 공 꾸미기 · 동전 코인 +15% · 반짝이는 꼬리 · 평생 소장 | 1,000 | 1,100 | `assets/iap/pinball.ball.ruby.png` |
| `pinball.ball.fire` | 불꽃 공 (핀볼) | 핀볼 공 꾸미기 · 동전 코인 +20% · 불꽃 꼬리 · 평생 소장 | 2,000 | 2,200 | `assets/iap/pinball.ball.fire.png` |
| `pinball.ball.thunder` | 번개 공 (핀볼) | 핀볼 공 꾸미기 · 동전 코인 +30% · 번개 꼬리 · 평생 소장 | 4,000 | 4,400 | `assets/iap/pinball.ball.thunder.png` |
| `minesweeper.tile.night` | 한밤 발판 (지뢰찾기) | 지뢰찾기 발판 · 동전 코인 +20% · 판마다 지뢰 1번 막기 · 평생 소장 | 3,000 | 3,300 | `assets/iap/minesweeper.tile.night.png` |
| `minesweeper.tile.gold` | 황금 발판 (지뢰찾기) | 지뢰찾기 발판 · 동전 코인 +40% · 판마다 지뢰 1번 막기 · 평생 소장 | 5,000 | 5,500 | `assets/iap/minesweeper.tile.gold.png` |
| `minesweeper.map.temple` | 황금 사원 맵 (지뢰찾기) | 지뢰찾기 맵 · 숨은 동전 4·7·10개 더 · 금빛 동전 · 평생 소장 | 4,000 | 4,400 | `assets/iap/minesweeper.map.temple.png` |

- 이름은 30자, 설명은 45자 이내예요.
- 아이콘은 1024×1024 PNG예요. 상점 미리보기와 같은 픽셀 그림이에요.
- 상품 코드(productId)는 콘솔이 자동으로 발급해요. 받은 코드는 `src/game/catalog.ts`에서 그 아이템의 `paid(...)` 옆 `iapSku`에 채워요.

## 테스트할 때 주의

콘솔 QR로 토스 앱에서 테스트해도 인앱결제는 모의 결제가 아니라 **실제 결제**로 처리돼요. 테스트로 산 상품은 환불 요청으로 정리해요.

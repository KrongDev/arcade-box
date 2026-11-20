# 안드로이드 앱 (구글 플레이)

아케이드박스를 안드로이드 앱으로 구글 플레이에 내는 방법이에요. 목적은 **구글 플레이의 자체등급분류**를 받아 앱인토스 콘솔의 게임 등급분류에 "스토어 링크" 방식으로 내는 것이에요.

## 무엇이 들어가나

- 핀볼 · 지뢰찾기 · 벽돌깨기, 상점(코인 아이템), 출석 보상, 효과음 · 진동, 안드로이드 뒤로가기 버튼
- 코인과 기록은 **이 기기에만** 저장해요(서버 연결 없음)
- 유료 아이템 · 광고 보상 · 점수 공유 · 순위표는 숨겨요(플랫폼 모듈에서 `null`)

토스 미니앱과 같은 게임 코드를 [Capacitor](https://capacitorjs.com)로 감싸요. 플랫폼마다 다른 기능은 `src/platform/`에 있고, 빌드할 때 하나만 들어가요.

| | 토스 미니앱 | 안드로이드 앱 |
|---|---|---|
| 플랫폼 구현 | `src/platform/toss` (앱인토스 SDK) | `src/platform/android` (Capacitor) |
| 웹 빌드 | `npm run build` → `dist/` → `.ait` | `npm run build:android` → `dist-android/` → `android/` |
| 저장 | 토스 저장소 + 게임 서버 | 기기(SharedPreferences) |

## 빌드 준비 (한 번만)

- **Android SDK**: Android Studio를 설치하면 함께 깔려요.
- **JDK 21**: Capacitor 8은 Java 21이 필요해요. Android Studio에 들어 있는 JDK가 25라면 Gradle 8.14가 실행되지 않으니 JDK 21을 따로 써요.
  - 예: `export JAVA_HOME=$(/usr/libexec/java_home -v 21)`

### 서명 키 만들기 (업로드 키)

구글 플레이는 앱 서명 키를 구글이 관리하고(Play 앱 서명), 개발자는 **업로드 키**로 서명해 올려요. 업로드 키를 잃으면 구글 플레이 고객센터에 재설정을 요청해야 하니 안전한 곳에 백업해 두세요.

```bash
mkdir -p ~/dev/secrit/arcade-box-android
"$JAVA_HOME/bin/keytool" -genkeypair -v -keystore ~/dev/secrit/arcade-box-android/upload.jks \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=arcade-box"
```

비밀번호는 직접 입력해요(PKCS12 형식이라 키 비밀번호도 같은 값이에요). 그다음 같은 폴더에 `keystore.properties`를 만들어요(저장소에 올리지 않아요). 아래처럼 하면 비밀번호가 셸 기록에 남지 않아요(zsh).

```bash
read -s "P?키 비밀번호: "; echo
printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=upload\nkeyPassword=%s\n' \
  "$HOME/dev/secrit/arcade-box-android/upload.jks" "$P" "$P" \
  > ~/dev/secrit/arcade-box-android/keystore.properties
chmod 600 ~/dev/secrit/arcade-box-android/keystore.properties; unset P
```

비밀번호에 `\`는 쓰지 않아요(properties 파일에서 이스케이프 문자로 읽혀요).

## 출시용 빌드

```bash
npm run build:android                       # 웹 빌드 + android/에 복사
cd android
ARCADE_KEYSTORE_PROPERTIES=~/dev/secrit/arcade-box-android/keystore.properties \
ANDROID_VERSION_CODE=1 ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

- 올릴 때마다 `ANDROID_VERSION_CODE`를 1씩 올려요.
- 폰·에뮬레이터에서 먼저 보려면 `./gradlew assembleDebug` 후 `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- 브라우저에서 안드로이드 화면을 보려면 `npm run dev:android`(Capacitor 플러그인의 웹 대체 동작을 써요).

## 구글 플레이 콘솔에 올리기

1. **앱 만들기**: 앱 이름 `아케이드박스`, 기본 언어 한국어, 게임, 무료.
2. **개발자 이름 확인**: 앱인토스 콘솔은 스토어의 등록자명(구글 플레이 개발자 이름)과 사업자명이 다르면 반려해요. **앱인토스 워크스페이스와 같은 명의**여야 해요.
3. **스토어 등록정보** (아래 문구 사용)
4. **앱 콘텐츠**
   - 개인정보처리방침: `https://github.com/KrongDev/arcade-box/blob/main/docs/privacy-policy.md`
   - 광고: 없음
   - 앱 액세스: 모든 기능을 제한 없이 쓸 수 있음
   - 콘텐츠 등급(IARC 설문): 아래 답변 참고
   - 타겟층: 13세 이상 (13세 미만을 고르면 가족 정책 요건이 추가돼요)
   - 데이터 보안: 수집·공유하는 데이터 없음 (기기에만 저장, 서버 통신 없음)
5. **테스트·출시**
   - 2023년 11월 13일 이후 만든 **개인** 개발자 계정은 테스터 12명이 14일 연속 비공개 테스트를 해야 프로덕션에 낼 수 있어요. 그 전에 만든 계정이나 조직 계정은 바로 프로덕션 출시를 신청할 수 있어요.

### 스토어 등록정보 문구

- **앱 이름** (30자): 아케이드박스
- **간단한 설명** (80자): 핀볼, 지뢰찾기, 벽돌깨기를 한곳에 모은 픽셀 오락실 게임 모음
- **자세한 설명**:

```
아케이드박스는 가볍게 즐기는 게임을 한곳에 모은 픽셀 오락실 게임 모음이에요.

핀볼: 화면을 누르고 있으면 발사대 스프링이 당겨지고, 손을 떼면 공이 발사돼요. 공이 판에 들어가면 화면 왼쪽과 오른쪽을 눌러 플리퍼를 움직이고, 범퍼를 맞히거나 판 위의 동전을 주워 점수를 올려요.

지뢰찾기: 초급, 중급, 고급 세 단계가 있어요. 칸을 눌러 열고, 길게 눌러 깃발을 꽂아요. 큰 판은 두 손가락으로 확대하고 끌어서 옮길 수 있어요.

벽돌깨기: 화면을 누른 채 좌우로 움직여 패들을 옮기고, 손을 떼면 공이 출발해요. 벽돌을 모두 깨면 다음 스테이지로 넘어가고, 떨어지는 동전과 아이템은 패들로 받아요.

핀볼 30,000점을 넘기면 지뢰찾기가, 지뢰찾기 고급을 깨면 벽돌깨기가 열려요. 게임에서 모은 코인과 출석 보상으로 판·공·발판·맵·패들·벽돌을 꾸며요.

코인과 기록은 이 기기에 저장되고, 개인정보를 받지 않아요. 광고와 유료 결제가 없어요.
```

- **카테고리**: 게임 › 아케이드
- **연락처 이메일**: leegeondev@gmail.com
- **그래픽**: 앱 아이콘 512×512, 그래픽 이미지 1024×500, 휴대전화 스크린샷 2장 이상(콘솔 등록용 `assets/` 이미지를 바탕으로 만들 수 있어요)

### 콘텐츠 등급 설문 답변 (IARC)

| 질문 | 답 |
|---|---|
| 폭력 · 유혈 | 없음 (공이 튕기는 물리 표현, 지뢰 칸의 작은 픽셀 폭발 효과뿐) |
| 공포 · 성적 콘텐츠 · 비속어 | 없음 |
| 약물 · 알코올 · 담배 | 없음 |
| 도박 · 모의 도박 | 없음 (베팅·뽑기·현금화 없음) |
| 사용자 간 상호작용 · 사용자 제작 콘텐츠 | 없음 (채팅·게시판 없음) |
| 위치 공유 | 없음 |
| 디지털 상품 구매 | 없음 |

## 출시 뒤 앱인토스 콘솔에 등급 넣기

1. 게임물관리위원회 '자체등급분류 게임물 조회'에서 아케이드박스를 찾아요(구글 플레이 출시 뒤 등록돼요).
2. 앱인토스 콘솔 › 앱 정보 › 게임 등급분류에서 **스토어 링크**를 골라요.
   - 스토어 링크: `https://play.google.com/store/apps/details?id=com.geonbox.arcadebox`
   - 등록자명: 구글 플레이 개발자 이름
   - 자체등급분류사업자명: 구글
   - 등급분류일자 · 등급분류번호 · 이용등급 · 내용정보: 조회 결과와 똑같이
   - 대표자 인감 또는 사인 이미지
   - 플레이 화면: 구글 플레이판 2장 + 앱인토스판 2장(편집하지 않은 원본)

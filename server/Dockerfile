# Node 24는 .ts 파일을 그대로 실행한다(타입 제거). 빌드 단계가 없다.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# 운영 이미지에는 실행에 쓰는 패키지(drizzle-orm, jose, pg와 그 의존성)만 넣는다.
# --omit=dev만으로는 PGlite와 @types가 남는다: drizzle-orm이 "있으면 쓰는" 패키지이기도 해서 잠금 파일에 devOptional로 적힌다.
# --omit=optional까지 줘야 빠진다. 함께 빠지는 pg-cloudflare는 Cloudflare Workers에서만 쓰는 것이다 (test/runtime-deps.test.ts)
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY src ./src
# 마이그레이션 SQL — 서버가 뜰 때 적용한다 (src/shared/db의 MIGRATIONS_DIR)
COPY drizzle ./drizzle
# 게임 묶음과 아이콘을 두는 곳(DATA_DIR). 여기에 붙는 새 볼륨이 이 디렉토리의 주인(node)을 물려받아, 서버가 root가 아니어도 쓸 수 있다
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]

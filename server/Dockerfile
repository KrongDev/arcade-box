# Node 24는 .ts 파일을 그대로 실행한다(타입 제거). 빌드 단계가 없다.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# 운영 이미지에는 실행에 쓰는 패키지만 넣는다 (drizzle-kit·PGlite·typescript는 개발용이라 빠진다)
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
# 마이그레이션 SQL — 서버가 뜰 때 적용한다 (src/shared/db의 MIGRATIONS_DIR)
COPY drizzle ./drizzle
# 게임 묶음과 아이콘을 두는 곳(DATA_DIR). 여기에 붙는 새 볼륨이 이 디렉토리의 주인(node)을 물려받아, 서버가 root가 아니어도 쓸 수 있다
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]

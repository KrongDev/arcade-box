# Node 24는 .ts 파일을 그대로 실행한다(타입 제거). 빌드 단계가 없다.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY mock-partner ./mock-partner
USER node
EXPOSE 8080
CMD ["node", "src/index.ts"]

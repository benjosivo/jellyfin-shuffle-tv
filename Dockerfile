FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY web ./web
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    JELLYFIN_OFFICE_DIR=/data \
    PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Scripts d'installation d'un nouvel écran, servis sur /lecteur.ps1 et /lecteur.sh.
COPY deploy/windows/mpv-shim.ps1 deploy/windows/lecteur.ps1 ./deploy/windows/
COPY deploy/linux/mpv-shim.sh deploy/linux/lecteur.sh ./deploy/linux/
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:8787/api/version').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]

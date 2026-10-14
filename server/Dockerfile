# The Hallowmarch's own server (rung 2), built from the repository's root:
#   docker build -f server/Dockerfile -t hallowmarch-server .
#   docker run -p 8787:8787 -e HM_SECRET=... -v hm-data:/data hallowmarch-server
# Railway (project hallowmarch, service march): the service builds this Dockerfile from the repository's root
# (its Dockerfile path set to server/Dockerfile and RAILWAY_DOCKERFILE_PATH; health check /health);
# a volume mounted at /data keeps the accounts, saves and the shared war across deploys; HM_SECRET signs the tokens.
FROM python:3.12-slim AS page
WORKDIR /app
COPY build.py ./
COPY src ./src
RUN python3 build.py

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HM_DATA=/data HM_SRC=/app/src HM_PAGE=/app/hallowmarch.html
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/server.js ./server/
COPY src/00_util.js src/01_world.js ./src/
COPY --from=page /app/hallowmarch.html ./hallowmarch.html
# runs as root: a Railway volume mounted at /data is root's
RUN mkdir -p /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]

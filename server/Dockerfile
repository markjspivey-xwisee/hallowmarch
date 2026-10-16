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

# Private workspace packages are built from the reviewed, immutable Interego
# revision. No account token, private registry or runtime identity enters this
# stage. Its committed lockfile pins transitive dependencies as well.
FROM node:22-slim AS interego
WORKDIR /opt/interego
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git init . && git remote add origin https://github.com/markjspivey-xwisee/interego.git \
    && git fetch --depth 1 origin 87ee71626c015af3c1e7b9dac5579eff6899e8c1 \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = 87ee71626c015af3c1e7b9dac5579eff6899e8c1
RUN npm ci --workspace @interego/core --workspace @interego/solid --workspace @interego/pgsl --include-workspace-root=false --ignore-scripts --no-audit --no-fund \
    && npm run build --workspace @interego/core \
    && npm run build --workspace @interego/solid \
    && npm run build --workspace @interego/pgsl \
    && npm prune --omit=dev --workspace @interego/core --workspace @interego/solid --workspace @interego/pgsl --include-workspace-root=false --ignore-scripts --no-audit --no-fund

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787 HM_DATA=/data HM_SRC=/app/src HM_PAGE=/app/hallowmarch.html
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev
# Preserve workspace-relative resolution for the actual native SDK, while the
# ordinary game's dependencies retain their own server/package-lock.json pins.
COPY --from=interego /opt/interego/node_modules /opt/interego/node_modules
COPY --from=interego /opt/interego/packages/core/package.json /opt/interego/packages/core/package.json
COPY --from=interego /opt/interego/packages/core/dist /opt/interego/packages/core/dist
COPY --from=interego /opt/interego/packages/solid/package.json /opt/interego/packages/solid/package.json
COPY --from=interego /opt/interego/packages/solid/dist /opt/interego/packages/solid/dist
COPY --from=interego /opt/interego/packages/pgsl/package.json /opt/interego/packages/pgsl/package.json
COPY --from=interego /opt/interego/packages/pgsl/dist /opt/interego/packages/pgsl/dist
COPY --from=interego /opt/interego/LICENSE /opt/interego/LICENSE
RUN mkdir -p server/node_modules/@interego \
    && ln -s /opt/interego/packages/core server/node_modules/@interego/core \
    && ln -s /opt/interego/packages/solid server/node_modules/@interego/solid \
    && ln -s /opt/interego/packages/pgsl server/node_modules/@interego/pgsl \
    && node --input-type=module -e "const n=await import('/opt/interego/packages/pgsl/dist/index.js');const c=await import('/opt/interego/packages/core/dist/index.js');const s=await import('/opt/interego/packages/solid/dist/index.js');if(typeof s.digestedGraphRegion!=='function'||typeof s.parseAuthorshipProofFromDescriptorTurtle!=='function'||typeof s.parseDistributionFromDescriptorTurtle!=='function'||typeof n.NativeCommitStore!=='function'||typeof n.createNativeByteArtifact!=='function'||typeof n.readNativeByteArtifact!=='function'||typeof c.deriveEncryptionKeyPair!=='function')throw Error('Native SDK contract unavailable')"
COPY server/*.js ./server/
COPY server/gaming ./server/gaming
# the sites (00_util.js, 01_world.js) and the season's realm module (08m_realm.js once loops's lands; server/realm_stub.js until then)
COPY src ./src
COPY --from=page /app/hallowmarch.html ./hallowmarch.html
# runs as root: a Railway volume mounted at /data is root's
RUN mkdir -p /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=4s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]

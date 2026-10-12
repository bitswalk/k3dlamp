# syntax=docker/dockerfile:1
# End-to-end image: the packaged Headlamp under Xvfb, a private Docker daemon
# for k3d, and Playwright to drive the app. scripts/test-headlamp.sh runs it.
FROM docker:29-dind AS docker

FROM node:22-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      iptables xvfb xauth fonts-dejavu-core \
      libgtk-3-0 libnss3 libgbm1 libasound2 libxss1 libxtst6 libnotify4 libsecret-1-0 \
      libdrm2 libxkbcommon0 libatspi2.0-0 libatk-bridge2.0-0 libcups2 \
 && rm -rf /var/lib/apt/lists/*

# Static Docker Engine binaries and the dind wrapper that sets up cgroup nesting.
COPY --from=docker /usr/local/bin/ /usr/local/bin/

# The upstream k3d release. The specs copy it onto PATH partway through.
ARG K3D_VERSION=v5.9.0
ARG K3D_SHA256=06d8f25bc3a971c4eb29e0ff08429b180402db0f4dec838c9eac427e296800a0
RUN curl -fsSL -o /opt/k3d "https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-amd64" \
 && echo "${K3D_SHA256}  /opt/k3d" | sha256sum -c - \
 && chmod 0755 /opt/k3d

WORKDIR /e2e
COPY test/e2e/package.json test/e2e/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY test/e2e/ ./
COPY install.sh /e2e/
COPY app-build-manifest.json /product/
COPY examples/dev-cluster.yaml /fixtures/

ENTRYPOINT ["/e2e/run.sh"]

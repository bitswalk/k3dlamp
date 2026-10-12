# syntax=docker/dockerfile:1
# Builds Headlamp Desktop for Linux x64 from a pinned Headlamp commit, branded
# as k3dlamp, with this product's app-build-manifest.json. The k3d plugin isn't
# part of the build: users install it from Artifact Hub.
#
#   docker build -f build/headlamp.Dockerfile --output out .
#
# The only output is out/k3dlamp-<version>-linux-x64.tar.gz.

FROM golang:1.26-bookworm AS go

FROM node:22-bookworm AS build
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:/go/bin:$PATH GOPATH=/go

# runCommands and approvedCommands exist only on Headlamp main after v0.45.0.
ARG HEADLAMP_COMMIT=032c275fcd3c0301bf03f46c097f012237780d0c
WORKDIR /src/headlamp
RUN git init -q . \
 && git remote add origin https://github.com/kubernetes-sigs/headlamp.git \
 && git fetch -q --depth 1 origin "$HEADLAMP_COMMIT" \
 && git checkout -q FETCH_HEAD

# Dependencies come before the product files, so a manifest change reuses them.
RUN cd backend && go mod download
RUN cd frontend && npm ci --no-audit --no-fund
RUN cd app && npm ci --no-audit --no-fund
RUN make backend

COPY branding/apply.sh /product/branding/
COPY branding/overlay/ /product/branding/overlay/
RUN /product/branding/apply.sh /src/headlamp

COPY app-build-manifest.json /product/
ENV HEADLAMP_BUILD_MANIFEST=/product/app-build-manifest.json \
    HEADLAMP_SOURCE_COMMIT=$HEADLAMP_COMMIT

RUN cd frontend && npm run build
RUN cd app && node --experimental-strip-types ./scripts/setup-plugins.ts
RUN cd app && npm run package -- --linux tar.gz --x64

FROM scratch
COPY --from=build /src/headlamp/app/dist/*.tar.gz /

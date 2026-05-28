FROM --platform=$BUILDPLATFORM node:22-alpine AS web-build
ARG VERSION=dev
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN VERSION=$VERSION npm run build

FROM --platform=$BUILDPLATFORM golang:1.24-alpine AS service-build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY usage-service ./usage-service
COPY --from=web-build /app/dist/index.html ./usage-service/internal/httpapi/web/management.html
WORKDIR /src/usage-service
RUN go mod download
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /out/cpa-manager ./cmd/cpa-manager

FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget
WORKDIR /app
COPY --from=service-build /out/cpa-manager /usr/local/bin/cpa-manager
ENV HTTP_ADDR=0.0.0.0:18317
ENV USAGE_DATA_DIR=/data
ENV USAGE_DB_PATH=/data/usage.sqlite
EXPOSE 18317
ENTRYPOINT ["cpa-manager"]

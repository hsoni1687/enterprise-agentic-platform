FROM golang:1.23-alpine AS builder

# Use http:// for apk to bypass Zscaler TLS interception
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk update && apk add --no-cache ca-certificates

# Copy and install Zscaler cert
COPY infra/certs/zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

ENV GOPROXY=direct GOSUMDB=off

WORKDIR /app

# Copy everything needed
COPY packages/go-shared ../go-shared
COPY services/mcp-registry .

# Build with direct module mode (no proxy)
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o mcp-registry .

# Final stage - use distroless for smaller image and no package install issues
FROM gcr.io/distroless/base-debian12

WORKDIR /root/

COPY --from=builder /app/mcp-registry .

EXPOSE 8090

CMD ["./mcp-registry"]

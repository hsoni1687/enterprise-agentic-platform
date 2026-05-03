FROM golang:1.21-alpine AS builder

# Use http:// for apk to bypass Zscaler TLS interception
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk update && apk add --no-cache ca-certificates

# Copy and install Zscaler cert
COPY infra/certs/zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

WORKDIR /app

# Copy go.mod and go.sum (if exists)
COPY services/mcp-server/go.mod .
COPY services/mcp-server/go.sum . 2>/dev/null || true

# Copy go-shared dependency
COPY packages/go-shared ../go-shared

# Download dependencies
RUN go mod download

# Copy source
COPY services/mcp-server .

# Build
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o mcp-server .

# Final stage
FROM alpine:latest

# Use http:// for apk to bypass Zscaler TLS interception
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk update && apk add --no-cache ca-certificates

# Copy and install Zscaler cert
COPY infra/certs/zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

WORKDIR /root/

COPY --from=builder /app/mcp-server .

EXPOSE 8091

CMD ["./mcp-server"]

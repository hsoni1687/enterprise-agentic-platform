FROM golang:1.23-alpine AS builder

# Use http:// for apk to bypass Zscaler TLS interception
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk update && apk add --no-cache ca-certificates git

# Copy and install Zscaler cert
COPY infra/certs/zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

WORKDIR /app

# Copy go-shared to where the replace directive expects it
COPY packages/go-shared /app/packages/go-shared
COPY services/mcp-server /app/mcp-server

WORKDIR /app/mcp-server

# Fix go.mod replace path for Docker context
RUN sed -i 's|=> ../../packages/go-shared|=> ../packages/go-shared|' go.mod

# Download dependencies
RUN go mod download

# Tidy go.sum
RUN go mod tidy

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

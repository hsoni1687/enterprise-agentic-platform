# --- Build Stage ---
FROM golang:alpine AS builder

# Use http:// for apk to bypass Zscaler TLS interception
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk update && apk add --no-cache ca-certificates git

# Copy and install Zscaler cert
COPY infra/certs/zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

WORKDIR /app

# Copy shared packages
COPY packages ./packages

# Copy service code
COPY services/admin-api ./services/admin-api

WORKDIR /app/services/admin-api
RUN GOPROXY=direct go mod download
RUN go build -o /admin-api main.go

# --- Final Stage ---
FROM alpine:latest

# Use http:// for apk to bypass Zscaler TLS interception
RUN sed -i 's/https/http/g' /etc/apk/repositories && \
    apk update && apk add --no-cache ca-certificates

# Copy and install Zscaler cert
COPY infra/certs/zscaler-root-ca.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

WORKDIR /
COPY --from=builder /admin-api /admin-api

EXPOSE 8089

ENTRYPOINT ["/admin-api"]

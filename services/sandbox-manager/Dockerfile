# --- Build Stage ---
FROM golang:alpine AS builder

# Bypass TLS for apk then install certs
RUN sed -i "s/https/http/g" /etc/apk/repositories
COPY zscaler.pem /usr/local/share/ca-certificates/zscaler.crt
RUN apk add --no-cache ca-certificates git && update-ca-certificates

WORKDIR /app

# Copy shared packages
COPY packages ./packages

# Copy service code
COPY services/sandbox-manager ./services/sandbox-manager

WORKDIR /app/services/sandbox-manager
RUN GOPROXY=direct go mod download
RUN go build -o /sandbox-manager main.go

# --- Final Stage ---
FROM alpine:latest

RUN sed -i "s/https/http/g" /etc/apk/repositories && \
    apk add --no-cache ca-certificates && \
    sed -i "s/http/https/g" /etc/apk/repositories
COPY zscaler.pem /usr/local/share/ca-certificates/zscaler.crt
RUN update-ca-certificates

WORKDIR /
COPY --from=builder /sandbox-manager /sandbox-manager

EXPOSE 8082

ENTRYPOINT ["/sandbox-manager"]

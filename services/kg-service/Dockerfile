# --- Build Stage ---
FROM golang:alpine AS builder

# Bypass TLS for apk then install certs
RUN sed -i "s/https/http/g" /etc/apk/repositories
RUN apk add --no-cache ca-certificates git

WORKDIR /app

COPY packages ./packages
COPY services/kg-service ./services/kg-service

WORKDIR /app/services/kg-service
RUN GOPROXY=https://proxy.golang.org,direct go mod download
RUN go build -o /kg-service main.go

# --- Final Stage ---
FROM alpine:latest

WORKDIR /
COPY --from=builder /kg-service /kg-service

EXPOSE 8093

ENTRYPOINT ["/kg-service"]

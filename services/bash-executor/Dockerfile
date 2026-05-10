FROM golang:1.21 AS builder

WORKDIR /app

COPY services/bash-executor/go.mod services/bash-executor/go.sum* ./
RUN go mod download 2>/dev/null || true

COPY services/bash-executor/ ./

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o /bash-executor main.go

FROM debian:bookworm-slim

COPY zscaler.pem /usr/local/share/ca-certificates/zscaler.crt
RUN apt-get update && apt-get install -y --no-install-recommends bash ca-certificates && update-ca-certificates && rm -rf /var/lib/apt/lists/*
ENV REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt

COPY --from=builder /bash-executor /bash-executor

EXPOSE 8092

CMD ["/bash-executor"]

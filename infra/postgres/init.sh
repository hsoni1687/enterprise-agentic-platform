#!/bin/bash
set -e

# Create a dedicated database for LiteLLM.
# LiteLLM runs its own Prisma migrations on startup — keeping it isolated
# from agentplatform prevents those migrations from touching platform tables.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE litellm;
EOSQL

# Enable pgvector on the main agent database
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
EOSQL

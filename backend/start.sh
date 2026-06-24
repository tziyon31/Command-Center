#!/usr/bin/env bash
set -euo pipefail

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting API server..."
exec node src/index.js

#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== aH-Ha deploy ==="

echo "[1/5] git pull"
git pull origin main

echo "[2/5] install backend deps"
npm install --legacy-peer-deps

echo "[3/5] build backend"
npm run build

echo "[4/5] build frontend"
cd web
npm install --legacy-peer-deps
npx vite build
cd ..

echo "[5/5] reload PM2"
pm2 reload ecosystem.config.cjs

echo "=== deploy complete ==="

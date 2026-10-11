#!/bin/sh
# Baixa a biblioteca @vladmandic/face-api (MIT) e os modelos reais para uso LOCAL (self-hosted).
# Requer internet e curl. Rode uma vez antes do deploy: npm run setup:face
set -e
V=1.7.13
B="https://cdn.jsdelivr.net/npm/@vladmandic/face-api@$V"
cd "$(dirname "$0")/../public"
mkdir -p vendor models
curl -fL "$B/dist/face-api.js" -o vendor/face-api.js
for m in tiny_face_detector_model face_landmark_68_model face_recognition_model; do
  curl -fL "$B/model/$m.json" -o "models/$m.json"
  curl -fL "$B/model/$m.bin" -o "models/$m.bin"
done
echo "OK: biblioteca e modelos faciais instalados em public/vendor e public/models"

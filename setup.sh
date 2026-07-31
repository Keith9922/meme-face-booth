#!/usr/bin/env bash
# 拉取模型和 wasm 到本地。全部本地化是为了现场断网也能跑 —— 活动现场的
# WiFi 是最不可靠的东西，走 CDN 首次加载失败等于整个装置挂掉。
set -euo pipefail
cd "$(dirname "$0")"

MP=https://storage.googleapis.com/mediapipe-models
TV_VERSION=1.0.0

echo "==> 下载 MediaPipe 模型 (~17MB)"
mkdir -p models
[ -f models/face_landmarker.task ] || curl -fsSL -o models/face_landmarker.task \
  "$MP/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
[ -f models/hand_landmarker.task ] || curl -fsSL -o models/hand_landmarker.task \
  "$MP/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"
[ -f models/pose_landmarker_lite.task ] || curl -fsSL -o models/pose_landmarker_lite.task \
  "$MP/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"

echo "==> 下载 @mediapipe/tasks-vision@$TV_VERSION (~34MB)"
if [ ! -d vendor/tasks-vision ]; then
  mkdir -p vendor && cd vendor
  npm pack "@mediapipe/tasks-vision@$TV_VERSION" >/dev/null
  tar -xzf "mediapipe-tasks-vision-$TV_VERSION.tgz"
  rm "mediapipe-tasks-vision-$TV_VERSION.tgz"
  mv package tasks-vision
  # 只留运行时要的：ESM 入口 + wasm
  (cd tasks-vision && rm -f ./*.map vision_bundle.cjs vision_bundle.js README.md)
  cd ..
fi

echo
echo "完成。启动：  node serve.mjs   然后打开 http://localhost:5173"
echo "注意：memes/ 是空的，需要放入你自己有授权的表情包图片，"
echo "      并在 memes/manifest.json 登记。"

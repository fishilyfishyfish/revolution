#!/bin/bash
# 사용: scripts/runall.sh <stage> [ticks]  — 시드 1~3 병렬 실행, out/ 에 결과 저장
stage=$1; ticks=${2:-100000}
for s in 1 2 3; do npx tsx scripts/headless.ts --stage $stage --seed $s --ticks $ticks > /dev/null 2>&1 & done
wait

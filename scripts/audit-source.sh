#!/usr/bin/env bash
set -euo pipefail

oversized=0
while IFS= read -r file; do
  lines="$(wc -l < "$file")"
  if (( lines >= 300 )); then
    printf '[OVERSIZED] %s: %s lines\n' "$file" "$lines"
    oversized=1
  fi
done < <(find src -type f -name '*.ts' ! -name '*.spec.ts' | sort)

if (( oversized )); then
  exit 1
fi

if rg -n --glob '!*.spec.ts' \
  '(-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]+|mongodb(\+srv)?://[^/@:]+:[^/@]+@)' \
  src scripts; then
  printf '[SECRET_PATTERN_FOUND]\n'
  exit 1
fi

schema_failure=0
while IFS= read -r file; do
  if ! rg -q '(documentOptions|createdAtOptions)(<[^>]+>)?\(' "$file"; then
    printf '[UNSAFE_MONGOOSE_SCHEMA_OPTIONS] %s\n' "$file"
    schema_failure=1
  fi
done < <(find src/database/models -type f -name '*.models.ts' | sort)

if (( schema_failure )); then
  exit 1
fi

printf '[SOURCE_AUDIT_OK] production TypeScript < 300 lines; strict Mongoose schemas; no known secret patterns\n'

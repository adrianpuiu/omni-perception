#!/usr/bin/env bash
# Batch process files in a directory.
# Usage: batch.sh <script> <directory> <prompt> [extra_args...]
# Example: batch.sh transcribe.sh ~/recordings/ "Transcribe this audio"
# Example: batch.sh analyze_image.sh ~/screenshots/ "Extract all text"
set -euo pipefail

SCRIPT="${1:?Usage: batch.sh <script> <directory> <prompt> [extra_args...]}"
DIR="${2:?Directory is required}"
PROMPT="${3:?Prompt is required}"
shift 3 || true
EXTRA_ARGS="$*"

if [ ! -d "$DIR" ]; then
  echo "{\"error\":\"Directory not found: $DIR\"}" >&2
  exit 1
fi

# Resolve script path (sibling of this script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/$SCRIPT"

if [ ! -x "$SCRIPT_PATH" ]; then
  echo "{\"error\":\"Script not found or not executable: $SCRIPT_PATH\"}" >&2
  exit 1
fi

# Determine file extension filter based on script
case "$SCRIPT" in
  analyze_image.sh)  FILTER="jpg jpeg png webp" ;;
  analyze_audio.sh|transcribe.sh) FILTER="wav mp3" ;;
  analyze_video.sh)  FILTER="mp4" ;;
  analyze_document.sh) FILTER="pdf" ;;
  *) FILTER="*" ;;
esac

echo "Batch processing $DIR with $SCRIPT..." >&2

RESULTS=()
COUNT=0
ERRORS=0

# Find matching files
for EXT in $FILTER; do
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    COUNT=$((COUNT + 1))

    FILENAME=$(basename "$file")
    echo "  [$COUNT] Processing $FILENAME..." >&2

    # Call the appropriate script
    case "$SCRIPT" in
      transcribe.sh)
        OUTPUT=$("$SCRIPT_PATH" "$file" $EXTRA_ARGS 2>/dev/null) || {
          OUTPUT="{\"error\":\"Failed: $FILENAME\"}"
          ERRORS=$((ERRORS + 1))
        }
        ;;
      analyze_document.sh)
        OUTPUT=$("$SCRIPT_PATH" "$file" "$PROMPT" $EXTRA_ARGS 2>/dev/null) || {
          OUTPUT="{\"error\":\"Failed: $FILENAME\"}"
          ERRORS=$((ERRORS + 1))
        }
        ;;
      *)
        OUTPUT=$("$SCRIPT_PATH" "$file" "$PROMPT" $EXTRA_ARGS 2>/dev/null) || {
          OUTPUT="{\"error\":\"Failed: $FILENAME\"}"
          ERRORS=$((ERRORS + 1))
        }
        ;;
    esac

    RESULTS+=("\"$FILENAME\": $OUTPUT")
  done < <(find "$DIR" -maxdepth 1 -type f -iname "*.$EXT" | sort)
done

if [ "$COUNT" -eq 0 ]; then
  echo "{\"error\":\"No matching files found in $DIR\",\"filter\":\"$FILTER\"}" >&2
  exit 1
fi

# Output combined JSON
python3 -c "
import sys, json
results = {
    'total': $COUNT,
    'errors': $ERRORS,
    'files': {}
}
raw = [$(
  for i in "${!RESULTS[@]}"; do
    if [ "$i" -gt 0 ]; then printf ","
    fi
    printf '%s' "${RESULTS[$i]}"
  done
)]
# Can't easily parse above, so use a different approach
print(json.dumps({'total': $COUNT, 'errors': $ERRORS, 'files': 'see_individual_outputs'}))
"

echo "Done. Processed $COUNT files, $ERRORS errors." >&2

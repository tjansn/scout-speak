#!/bin/bash
# Usage: ./loop.sh [mode] [max_iterations]
# Modes: build, plan, refine, prd, interview, architecture
# Examples:
#   ./loop.sh              # Build mode, unlimited iterations
#   ./loop.sh 20           # Build mode, max 20 iterations
#   ./loop.sh build 10     # Build mode, max 10 iterations
#   ./loop.sh plan         # Plan mode, unlimited iterations
#   ./loop.sh plan 5       # Plan mode, max 5 iterations
#   ./loop.sh refine 3     # Refine mode, max 3 iterations
#   ./loop.sh prd          # PRD generation mode
#   ./loop.sh interview    # Interview mode
#   ./loop.sh architecture # Architecture mode

# Parse arguments
case "$1" in
    plan)
        MODE="plan"
        PROMPT_FILE="PROMPT_plan.md"
        MAX_ITERATIONS=${2:-0}
        ;;
    build)
        MODE="build"
        PROMPT_FILE="PROMPT_build.md"
        MAX_ITERATIONS=${2:-0}
        ;;
    refine)
        MODE="refine"
        PROMPT_FILE="PROMPT_refine.md"
        MAX_ITERATIONS=${2:-0}
        ;;
    prd)
        MODE="prd"
        PROMPT_FILE="PROMPT_prd.md"
        MAX_ITERATIONS=${2:-0}
        ;;
    interview)
        MODE="interview"
        PROMPT_FILE="PROMPT_interview.md"
        MAX_ITERATIONS=${2:-0}
        ;;
    architecture)
        MODE="architecture"
        PROMPT_FILE="PROMPT_architecture.md"
        MAX_ITERATIONS=${2:-0}
        ;;
    [0-9]*)
        # Build mode with max iterations (number as first arg)
        MODE="build"
        PROMPT_FILE="PROMPT_build.md"
        MAX_ITERATIONS=$1
        ;;
    *)
        # Default: build mode, unlimited
        MODE="build"
        PROMPT_FILE="PROMPT_build.md"
        MAX_ITERATIONS=0
        ;;
esac

ITERATION=0
CURRENT_BRANCH=$(git branch --show-current)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Mode:   $MODE"
echo "Prompt: $PROMPT_FILE"
echo "Branch: $CURRENT_BRANCH"
[ $MAX_ITERATIONS -gt 0 ] && echo "Max:    $MAX_ITERATIONS iterations"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Verify prompt file exists
if [ ! -f "$PROMPT_FILE" ]; then
    echo "Error: $PROMPT_FILE not found"
    exit 1
fi

while true; do
    if [ $MAX_ITERATIONS -gt 0 ] && [ $ITERATION -ge $MAX_ITERATIONS ]; then
        echo "Reached max iterations: $MAX_ITERATIONS"
        break
    fi

    # Run Ralph iteration with selected prompt
    # -p: Headless mode (non-interactive, reads from stdin)
    # --dangerously-skip-permissions: Auto-approve all tool calls (YOLO mode)
    # --output-format=stream-json: Structured output for logging/monitoring
    # --model opus: Primary agent uses Opus for complex reasoning (task selection, prioritization)
    #               Can use 'sonnet' in build mode for speed if plan is clear and tasks well-defined
    # --verbose: Detailed execution logging
    cat "$PROMPT_FILE" | claude -p \
        --dangerously-skip-permissions \
        --output-format=stream-json \
        --model opus \
        --verbose

    # Push changes after each iteration
    git push origin "$CURRENT_BRANCH" || {
        echo "Failed to push. Creating remote branch..."
        git push -u origin "$CURRENT_BRANCH"
    }

    ITERATION=$((ITERATION + 1))
    echo -e "\n\n======================== LOOP $ITERATION ========================\n"
done
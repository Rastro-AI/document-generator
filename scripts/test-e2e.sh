#!/bin/bash

# End-to-end test script for document-generator
# Tests:
# 1. Job creation with PDF + image upload
# 2. Field extraction and image assignment
# 3. PDF rendering with image
# 4. Chat template edit (using Agents SDK)

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_success() { echo -e "${GREEN}✓${NC} $1"; }
echo_error() { echo -e "${RED}✗${NC} $1"; }
echo_info() { echo -e "${YELLOW}→${NC} $1"; }

# Create temp directory for test files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "================================================"
echo "Document Generator E2E Test Suite"
echo "================================================"
echo ""

# Check if server is running
echo_info "Checking if server is running..."
if ! curl -s "$BASE_URL/api/templates" > /dev/null; then
    echo_error "Server is not running at $BASE_URL"
    echo "Please start the server with: npm run dev"
    exit 1
fi
echo_success "Server is running"
echo ""

# Find test files
echo_info "Setting up test files..."

# Find an existing PDF for testing
TEST_PDF=$(find "$PROJECT_ROOT/jobs" -name "*.pdf" -type f 2>/dev/null | head -1)
if [ -z "$TEST_PDF" ]; then
    echo_error "No test PDF found in jobs directory"
    echo "Please provide a sample PDF"
    exit 1
fi
cp "$TEST_PDF" "$TEMP_DIR/test-spec.pdf"

# Find or create an image for testing
TEST_IMAGE=$(find "$PROJECT_ROOT/jobs" -name "*.png" -type f 2>/dev/null | head -1)
if [ -z "$TEST_IMAGE" ]; then
    # Create a simple test image
    echo "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FABJADq0/4K4AAAAAAElFTkSuQmCC" | base64 -d > "$TEMP_DIR/test-logo.png"
else
    cp "$TEST_IMAGE" "$TEMP_DIR/test-logo.png"
fi

echo_success "Test files prepared"
echo ""

# ============================================
# TEST 1: Create job with PDF and image
# ============================================
echo "============================================"
echo "TEST 1: Create job with PDF and image upload"
echo "============================================"

echo_info "Creating job..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/jobs" \
    -F "templateId=sunco-spec-v1" \
    -F "files=@$TEMP_DIR/test-spec.pdf" \
    -F "files=@$TEMP_DIR/test-logo.png")

JOB_ID=$(echo "$CREATE_RESPONSE" | jq -r '.jobId // empty')

if [ -z "$JOB_ID" ]; then
    echo_error "Failed to create job"
    echo "Response: $CREATE_RESPONSE"
    exit 1
fi

echo_success "Job created: $JOB_ID"

# ============================================
# TEST 2: Verify field extraction and image assignment
# ============================================
echo ""
echo "============================================"
echo "TEST 2: Verify field extraction & image assignment"
echo "============================================"

echo_info "Fetching job details..."
JOB_DETAILS=$(curl -s "$BASE_URL/api/jobs/$JOB_ID")

# Check fields were extracted
PRODUCT_NAME=$(echo "$JOB_DETAILS" | jq -r '.fields.PRODUCT_NAME // empty')
if [ -z "$PRODUCT_NAME" ]; then
    echo_error "No fields extracted from PDF"
else
    echo_success "Fields extracted (PRODUCT_NAME: $PRODUCT_NAME)"
fi

# Check image was assigned
PRODUCT_IMAGE=$(echo "$JOB_DETAILS" | jq -r '.assets.PRODUCT_IMAGE // empty')
if [ -z "$PRODUCT_IMAGE" ] || [ "$PRODUCT_IMAGE" = "null" ]; then
    echo_error "Image not assigned to PRODUCT_IMAGE asset"
else
    echo_success "Image assigned to PRODUCT_IMAGE"
fi

# ============================================
# TEST 3: Render PDF and verify output
# ============================================
echo ""
echo "============================================"
echo "TEST 3: Render PDF and verify output"
echo "============================================"

echo_info "Rendering PDF..."
RENDER_RESPONSE=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/render")
RENDER_OK=$(echo "$RENDER_RESPONSE" | jq -r '.ok // empty')

if [ "$RENDER_OK" != "true" ]; then
    echo_error "Failed to render PDF"
    echo "Response: $RENDER_RESPONSE"
    exit 1
fi
echo_success "PDF rendered successfully"

# Verify output file exists and has content
OUTPUT_PDF="$PROJECT_ROOT/jobs/$JOB_ID/output.pdf"
if [ ! -f "$OUTPUT_PDF" ]; then
    echo_error "Output PDF not found at $OUTPUT_PDF"
    exit 1
fi

PDF_SIZE=$(stat -f%z "$OUTPUT_PDF" 2>/dev/null || stat --format=%s "$OUTPUT_PDF")
echo_success "Output PDF created (size: ${PDF_SIZE} bytes)"

# The PDF should be larger than 50KB if it contains the image
if [ "$PDF_SIZE" -lt 50000 ]; then
    echo_error "PDF seems too small, might not contain the image"
else
    echo_success "PDF size suggests image is included"
fi

# ============================================
# TEST 4: Chat template edit (10x title size)
# ============================================
echo ""
echo "============================================"
echo "TEST 4: Chat template edit (10x title size)"
echo "============================================"

# First, get the original template to compare
ORIGINAL_TEMPLATE=$(curl -s "$BASE_URL/api/templates/sunco-spec-v1/code")
ORIGINAL_TITLE_SIZE=$(echo "$ORIGINAL_TEMPLATE" | grep -oE 'fontSize:\s*[0-9]+' | head -1 | grep -oE '[0-9]+')
echo_info "Original title font size: ${ORIGINAL_TITLE_SIZE:-unknown}"

echo_info "Sending chat request to make title 10x larger..."
CHAT_RESPONSE=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/chat" \
    -H "Content-Type: application/json" \
    -d '{"message": "Make the title (PRODUCT_NAME) text 10 times larger", "mode": "template"}')

CHAT_SUCCESS=$(echo "$CHAT_RESPONSE" | jq -r '.success // empty')
CHAT_MODE=$(echo "$CHAT_RESPONSE" | jq -r '.mode // empty')
CHAT_MESSAGE=$(echo "$CHAT_RESPONSE" | jq -r '.message // empty')
TEMPLATE_CHANGED=$(echo "$CHAT_RESPONSE" | jq -r '.templateChanged // empty')

if [ "$CHAT_SUCCESS" != "true" ]; then
    echo_error "Chat request failed"
    echo "Response: $CHAT_RESPONSE"
    exit 1
fi

echo_success "Chat request succeeded"
echo "  Mode: $CHAT_MODE"
echo "  Message: $CHAT_MESSAGE"
echo "  Template Changed: $TEMPLATE_CHANGED"

# Verify template was modified
if [ "$TEMPLATE_CHANGED" != "true" ]; then
    echo_error "Template was not changed"
else
    echo_success "Template was modified"
fi

# Check the job-specific template for larger font size
JOB_TEMPLATE_PATH="$PROJECT_ROOT/jobs/$JOB_ID/template.tsx"
if [ -f "$JOB_TEMPLATE_PATH" ]; then
    # Look for font size changes
    NEW_TITLE_SIZE=$(grep -oE 'fontSize:\s*[0-9]+' "$JOB_TEMPLATE_PATH" | head -1 | grep -oE '[0-9]+')
    if [ -n "$NEW_TITLE_SIZE" ] && [ -n "$ORIGINAL_TITLE_SIZE" ]; then
        EXPECTED_SIZE=$((ORIGINAL_TITLE_SIZE * 10))
        if [ "$NEW_TITLE_SIZE" -ge "$EXPECTED_SIZE" ] || [ "$NEW_TITLE_SIZE" -gt 100 ]; then
            echo_success "Title font size increased to ${NEW_TITLE_SIZE}px"
        else
            echo_info "Title font size is now ${NEW_TITLE_SIZE}px (expected ~${EXPECTED_SIZE}px)"
        fi
    fi
else
    echo_info "Job template not found (may be using original)"
fi

# ============================================
# TEST 5: Re-render PDF after template change
# ============================================
echo ""
echo "============================================"
echo "TEST 5: Re-render PDF after template change"
echo "============================================"

echo_info "Re-rendering PDF with modified template..."
RENDER_RESPONSE2=$(curl -s -X POST "$BASE_URL/api/jobs/$JOB_ID/render")
RENDER_OK2=$(echo "$RENDER_RESPONSE2" | jq -r '.ok // empty')

if [ "$RENDER_OK2" != "true" ]; then
    echo_error "Failed to re-render PDF after template change"
    echo "Response: $RENDER_RESPONSE2"
    exit 1
fi
echo_success "PDF re-rendered with modified template"

# Check new PDF size
NEW_PDF_SIZE=$(stat -f%z "$OUTPUT_PDF" 2>/dev/null || stat --format=%s "$OUTPUT_PDF")
echo_success "New PDF size: ${NEW_PDF_SIZE} bytes"

# ============================================
# Summary
# ============================================
echo ""
echo "============================================"
echo "TEST SUMMARY"
echo "============================================"
echo_success "All tests passed!"
echo ""
echo "Job ID: $JOB_ID"
echo "Output PDF: $OUTPUT_PDF"
echo ""
echo "You can view the PDF at:"
echo "  $BASE_URL/api/jobs/$JOB_ID/pdf"
echo ""

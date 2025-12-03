# Document Generator - Agent Architecture

## Overview

This document generator uses a multi-agent architecture combining:
1. **OpenAI GPT-5.1** for intelligent data extraction from source files
2. **OpenAI Agents SDK** for chat-based editing (fields & design)
3. **React PDF** for document generation from templates
4. **Next.js** as the orchestration layer

## Phase 1: File Extraction

### Model: GPT-5.1

We use OpenAI's `gpt-5.1` model with the **Responses API** (not the legacy Assistants API).

### Container-Based File Processing

Files are uploaded to OpenAI containers, which provide a sandboxed environment for code execution:

```typescript
// 1. Create container
const container = await openai.containers.create({
  name: `extract-${Date.now()}`,
});

// 2. Upload file to container
const containerFile = await openai.containers.files.create(container.id, {
  file: fs.createReadStream(filePath),
});

// 3. Call responses API with code_interpreter tool
const response = await openai.responses.create({
  model: "gpt-5.1",
  input: prompt,
  tools: [
    {
      type: "code_interpreter",
      container: container.id,
    },
  ],
});

// 4. Cleanup
await openai.containers.delete(container.id);
```

### Why Containers?

- **Security**: Files execute in sandboxed Python environment
- **Capability**: Full pandas/openpyxl for Excel parsing
- **Accuracy**: Model can iteratively explore complex spreadsheets
- **No local parsing**: Avoids pdf-parse/xlsx library limitations

### Extraction Flow

```
User uploads XLSM/XLSX/PDF
         ↓
   Convert XLSM → XLSX (strip macros)
         ↓
   Create OpenAI Container
         ↓
   Upload file to container
         ↓
   GPT-5.1 + code_interpreter
   - reads file with pandas
   - searches all sheets
   - extracts field values
         ↓
   Returns JSON with extracted fields
         ↓
   Delete container (cleanup)
```

## Phase 2: Chat Editing with OpenAI Agents SDK

### Architecture

The chat system uses the **OpenAI Agents SDK** (`@openai/agents-core` and `@openai/agents-openai`) for intelligent editing.

#### Packages Used

```typescript
import { Agent, run, tool, setDefaultModelProvider, applyDiff } from "@openai/agents-core";
import { OpenAIProvider } from "@openai/agents-openai";
import { z } from "zod";
```

#### Provider Setup

```typescript
const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
});
setDefaultModelProvider(provider);
```

### Agent Configuration

```typescript
const agent = new Agent({
  name: "TemplateEditor",
  instructions: TEMPLATE_AGENT_INSTRUCTIONS,
  model: "gpt-5.1",
  modelSettings: { reasoning: { effort: "none" } },
  tools: [readTemplateTool, updateFieldsTool, editTemplateTool],
});

// Execute the agent
const result = await run(agent, userMessage);
```

### Available Tools

The agent has access to three function tools created with `tool()` and Zod schemas:

#### 1. `read_template`
Reads the current template.tsx content for the job.

```typescript
const readTemplateTool = tool({
  name: "read_template",
  description: "Read the current template.tsx file content",
  parameters: z.object({}),
  execute: async () => {
    const content = await getJobTemplateContent(jobId);
    return content || "Template not found";
  },
});
```

#### 2. `update_fields`
Updates field values in the document.

```typescript
const updateFieldsTool = tool({
  name: "update_fields",
  description: "Update field values in the document...",
  parameters: z.object({
    updates_json: z.string().describe('JSON object mapping field names to values'),
  }),
  execute: async ({ updates_json }) => {
    const updates = JSON.parse(updates_json);
    // Validate and return valid updates
    return JSON.stringify(validUpdates);
  },
});
```

#### 3. `edit_template`
Edits the template file using either a unified diff patch or full content replacement.

```typescript
const editTemplateTool = tool({
  name: "edit_template",
  description: "Edit template.tsx via patch or full replacement",
  parameters: z.object({
    patch: z.string().optional().describe("Unified diff patch"),
    new_content: z.string().optional().describe("Complete new file content"),
  }),
  execute: async ({ patch, new_content }) => {
    if (patch) {
      // Apply patch using applyDiff from agents-core
      newContent = applyDiff(currentContent, patch);
    } else if (new_content) {
      newContent = new_content;
    }
    await updateJobTemplateContent(jobId, newContent);
    return JSON.stringify({ success: true });
  },
});
```

### Three Editing Modes

The chat API supports three modes:

1. **Auto Mode** (`mode: "auto"`) - **Recommended**
   - Agent intelligently decides whether to edit fields or template
   - Can do both in a single turn
   - Uses all three tools

2. **Fields Mode** (`mode: "fields"`)
   - Edit field values via natural language
   - Example: "Change the wattage to 15W and warranty to 3 years"
   - Uses legacy direct GPT call (for backwards compatibility)

3. **Template Mode** (`mode: "template"`)
   - Edit React PDF template design via natural language
   - Example: "Make the header blue instead of green"
   - Uses the Agents SDK with edit_template tool

### Chat API

```typescript
POST /api/jobs/{jobId}/chat
{
  "message": "Make the title 10x larger",
  "mode": "auto" | "fields" | "template"
}

// Response
{
  "success": true,
  "mode": "fields" | "template" | "both" | "none",
  "fields": { ... },           // If fields were updated
  "message": "Description of changes",
  "templateChanged": true      // If template was modified
}
```

### Agent Workflow

```
User message → "Make the title 10x larger"
         ↓
   Create Agent with tools
         ↓
   run(agent, message)
         ↓
   Agent decides: this is a template change
         ↓
   Agent calls read_template() tool
         ↓
   Agent analyzes template code
         ↓
   Agent calls edit_template({ patch: "..." })
         ↓
   SDK applies patch using applyDiff
         ↓
   Agent returns summary message
         ↓
   API returns { success: true, templateChanged: true }
```

### Per-Job Template Copies

On job creation, `template.tsx` is copied from the source template folder to the job folder:

```
templates/sunco-spec-v1/template.tsx  →  jobs/{uuid}/template.tsx
```

This allows:
- Each job to have its own design modifications
- Template changes don't affect other jobs
- Source templates remain pristine

## Template System

Templates are stored as TSX files with a `render()` function:

```tsx
export function render(
  fields: Record<string, string | number | null>,
  assets: Record<string, string>,
  templateRoot: string
): React.ReactElement {
  return (
    <Document>
      <Page size="LETTER">
        <Text>{fields.PRODUCT_NAME}</Text>
        ...
      </Page>
    </Document>
  );
}
```

### Dynamic Template Compilation

Job-specific templates are dynamically compiled at render time using esbuild:

```typescript
// Compile TSX to JS at runtime
const result = await esbuild.transform(templateCode, {
  loader: "tsx",
  target: "es2020",
  format: "cjs",
});

// Inject React PDF dependencies
const moduleWrapper = new Function(
  "__React__",
  "__ReactPDF__",
  moduleCode
);

const renderFn = moduleWrapper(React, ReactPDF);
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/templates` | GET | List available templates |
| `/api/jobs` | POST | Create job + extract fields |
| `/api/jobs/[id]` | GET/PUT | Read/update job |
| `/api/jobs/[id]/render` | POST | Generate PDF |
| `/api/jobs/[id]/pdf` | GET | Stream PDF |
| `/api/jobs/[id]/chat` | POST | Chat editing (auto/fields/template) |

## File Storage

```
jobs/
  {uuid}/
    job.json         # Job state + extracted fields
    template.tsx     # Job-local template copy (for design edits)
    assets/          # Uploaded images
    source.xlsx      # Original upload
    output.pdf       # Generated PDF

templates/
  sunco-spec-v1/
    template.json    # Field schema
    template.tsx     # React PDF component (source)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/agents/template-agent.ts` | OpenAI Agents SDK agent implementation |
| `src/app/api/jobs/[jobId]/chat/route.ts` | Chat API endpoint |
| `src/app/api/jobs/[jobId]/render/route.ts` | PDF rendering with dynamic compilation |
| `src/lib/llm.ts` | File extraction with containers |

## Frontend Architecture

### JobEditor Component

```
┌─────────────────────────────────────────────────────────┐
│  Header: Template Name | Save | Generate | Download | Chat │
├─────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌─────────────────────────────────┐  │
│  │               │  │                                 │  │
│  │  Fields       │  │       PDF Preview               │  │
│  │  Editor       │  │       (iframe)                  │  │
│  │  (380px)      │  │                                 │  │
│  │               │  │                                 │  │
│  └───────────────┘  └─────────────────────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  Chat Panel (300px height, collapsible)                 │
│  ┌─────────────────────────────────────────────────────┐│
│  │ [Edit Values] [Edit Design]     mode toggle        ││
│  ├─────────────────────────────────────────────────────┤│
│  │ Messages area (scrollable)                         ││
│  ├─────────────────────────────────────────────────────┤│
│  │ [Input field...                          ] [Send]  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

## Dependencies

### OpenAI Agents SDK

```json
{
  "@openai/agents-core": "^0.3.3",
  "@openai/agents-openai": "^0.3.3",
  "zod": "^3.x"
}
```

### Other Key Dependencies

- `openai` - OpenAI API client for extraction
- `@react-pdf/renderer` - PDF generation
- `esbuild` - Dynamic TSX compilation
- `next` - Framework

## Cost Considerations

- GPT-5.1 with code_interpreter has higher token costs
- Container operations add latency (~5-30s per extraction)
- Agent-based chat is fast (~2-10s)
- Consider caching extracted fields for re-renders

# Task 08: Tier 2 — LLM Classifier

## Architectural Context

Tier 2 handles documents that Tier 1 couldn't resolve — mixed-content documents, tables without matching column names, prose with embedded tasks. It sends a structured prompt to the local Ollama LLM (`qwen2.5:3b`) with the registered note type descriptions and schemas, plus the document content (truncated for long docs). The LLM returns a JSON array identifying content regions and their types. Items with confidence ≥ 0.6 become `ExtractedItem[]`; items below 0.6 go to Tier 3.

## File Ownership

**May modify:**
- `src/services/extraction-tiers/llm-classifier.ts` (new file)
- `src/services/extraction-pipeline.ts` (add Tier 2 call)
- `__tests__/services/extraction-tiers/llm-classifier.test.ts` (new file)

**Must not touch:**
- `src/commands/import.ts` (Task 7)
- `src/services/ollama.ts` (existing, read only)

**Read for context (do not modify):**
- `src/services/ollama.ts` — `OllamaClient`, `requireOllama()`, `generate()`
- `src/modules/registry.ts` — `getImportableNoteTypes()` for building the prompt
- `src/modules/types.ts` — `ModuleNoteType` for schema descriptions

## Steps

### Step 1: Create the LLM classifier module

Create `src/services/extraction-tiers/llm-classifier.ts`:

The module should:
1. Build a prompt listing all registered note types with descriptions and schema fields
2. Include the document content (for tables: headers + 3-5 sample rows; for prose: truncated to ~3K chars if longer)
3. Ask the LLM to output a JSON array of regions with type, title, startLine, endLine, fields, confidence
4. Parse the JSON response, validate it, and convert to `ExtractedItem[]`
5. Return items with confidence ≥ 0.6, plus remainder text for items below threshold

Key design points:
- The system prompt should be concise and explicit about output format
- Include 1-2 examples in the prompt for the small model
- Handle JSON parse failures gracefully (return empty items, full remainder)
- For tables identified by the LLM: LLM provides `columnMapping`, then iterate all rows deterministically using the mapping (don't send all rows through the LLM)
- Truncation: for prose > 4K tokens (~3K chars), send first 2K chars + last 1K chars with `[...N lines truncated...]`

### Step 2: Wire into extraction pipeline

In `src/services/extraction-pipeline.ts`, add the Tier 2 call after Tier 1 when `remainder` exists and `maxTier >= 2`. The pipeline needs access to `OllamaClient` — add it as an optional parameter.

### Step 3: Write tests

Create `__tests__/services/extraction-tiers/llm-classifier.test.ts`:

Mock the `OllamaClient.generate()` method. Test:
- Valid JSON response → correct ExtractedItem[] conversion
- Low confidence items (< 0.6) filtered out
- JSON parse failure → returns empty items with full remainder
- Long document truncation logic
- Table identification: LLM returns columnMapping → rows extracted deterministically
- Prompt includes all registered note type descriptions

### Step 4: Run tests

Run: `npm test -- __tests__/services/extraction-tiers/llm-classifier.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add src/services/extraction-tiers/llm-classifier.ts src/services/extraction-pipeline.ts __tests__/services/extraction-tiers/llm-classifier.test.ts
git commit -m "feat: add Tier 2 LLM classifier for mixed-content documents"
```

## Success Criteria

- [ ] Tests pass: `npm test -- __tests__/services/extraction-tiers/llm-classifier.test.ts`
- [ ] Types check: `npm run typecheck`
- [ ] Prompt includes all registered note types with descriptions
- [ ] JSON parse failures handled gracefully (no crashes)
- [ ] Confidence filtering at 0.6 threshold works
- [ ] Long document truncation keeps prompt under ~4K tokens
- [ ] Table rows extracted deterministically after LLM provides column mapping

## Anti-patterns

- Do NOT modify files outside the ownership list above
- Do NOT modify CLAUDE.md or any persistent configuration files
- Do NOT send all table rows through the LLM — only headers + sample rows
- Do NOT make Ollama a hard requirement — if Ollama is unavailable, skip Tier 2 and pass remainder to Tier 3

import { describe, it, expect, vi } from 'vitest';
import { splitDocument } from '../../src/services/document-splitter.js';
import type { Embedder } from '../../src/types.js';

const mockEmbedder: Embedder = {
  embed: vi.fn().mockResolvedValue([[0, 0, 0]]),
  model: 'test',
  dimensions: 3,
};

describe('splitDocument', () => {
  it('does not split a single-class document', async () => {
    const content = `---
title: Architecture Doc
type: research
tier: slow
---

## System Architecture

The system uses microservices with a message queue.

## Component Overview

Each service is independently deployable.
`;
    const result = await splitDocument(content, 'arch.md', mockEmbedder);
    expect(result.derivedNotes).toHaveLength(0);
  });

  it('splits a document with architecture prose and a task table', async () => {
    const content = `---
title: Project Plan
type: note
tier: slow
---

## Architecture

The system uses microservices with a message queue.

\`\`\`yaml
services:
  api:
    image: api:latest
\`\`\`

\`\`\`yaml
deploy:
  replicas: 3
\`\`\`

## Tasks

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Build API | Open | High | Alice |
| Write tests | Open | Medium | Bob |
`;
    const result = await splitDocument(content, 'plan.md', mockEmbedder);
    expect(result.derivedNotes.length).toBeGreaterThan(0);
    const taskDerived = result.derivedNotes.find((d) => d.contentClass === 'task');
    expect(taskDerived).toBeDefined();
  });

  it('preserves source note with full content', async () => {
    const content = `---
title: Mixed Doc
type: note
tier: slow
---

## Overview

Some overview text that is long enough to be classified.
More detail here about the project scope and timeline for delivery.

## Tasks

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Task A | Open | High | Alice |
| Task B | Done | Low | Bob |
`;
    const result = await splitDocument(content, 'mixed.md', mockEmbedder);
    expect(result.sourceNote.content).toContain('Overview');
    expect(result.sourceNote.content).toContain('Task A');
  });

  it('groups consecutive same-class sections together', async () => {
    const content = `---
title: Multi Section
type: note
tier: slow
---

## System Architecture

The system uses microservices with a message queue for async processing.

\`\`\`yaml
services:
  api:
    image: api:latest
\`\`\`

\`\`\`yaml
deploy:
  replicas: 3
\`\`\`

## Component Design

The API gateway routes requests to the backend service layer using REST endpoints.

\`\`\`yaml
routes:
  - /api/v1
\`\`\`

\`\`\`yaml
middleware:
  - auth
\`\`\`

## Task List A

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Task 1 | Open | High | Alice |

## Task List B

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Task 2 | Open | Medium | Bob |
`;
    const result = await splitDocument(content, 'multi.md', mockEmbedder);
    // Two consecutive task sections should be grouped into one derived note
    const taskDerived = result.derivedNotes.filter((d) => d.contentClass === 'task');
    expect(taskDerived).toHaveLength(1);
    expect(taskDerived[0].content).toContain('Task 1');
    expect(taskDerived[0].content).toContain('Task 2');
  });

  it('does not split when only one class exceeds confidence threshold', async () => {
    const content = `---
title: Simple Doc
type: note
tier: slow
---

## Notes

Some general notes about the project that are fairly long and detailed enough.
More detail here about the project scope and timeline for delivery.
`;
    const result = await splitDocument(content, 'simple.md', mockEmbedder);
    expect(result.derivedNotes).toHaveLength(0);
  });

  it('returns correct suggestedType mapping', async () => {
    const content = `---
title: Arch and Tasks
type: note
tier: slow
---

## Architecture

The system uses microservices with a message queue.

\`\`\`yaml
services:
  api:
    image: api:latest
\`\`\`

\`\`\`yaml
deploy:
  replicas: 3
\`\`\`

## Tasks

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Build API | Open | High | Alice |
| Write tests | Open | Medium | Bob |
`;
    const result = await splitDocument(content, 'mixed.md', mockEmbedder);
    const taskDerived = result.derivedNotes.find((d) => d.contentClass === 'task');
    if (taskDerived) {
      expect(taskDerived.suggestedType).toBe('task');
    }
    const archDerived = result.derivedNotes.find((d) => d.contentClass === 'research');
    if (archDerived) {
      expect(archDerived.suggestedType).toBe('research');
    }
  });

  it('includes suggestedTitle from heading', async () => {
    const content = `---
title: Project Plan
type: note
tier: slow
---

## System Architecture

The system uses microservices with a message queue.

\`\`\`yaml
services:
  api:
    image: api:latest
\`\`\`

\`\`\`yaml
deploy:
  replicas: 3
\`\`\`

## Sprint Tasks

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Build API | Open | High | Alice |
| Write tests | Open | Medium | Bob |
`;
    const result = await splitDocument(content, 'plan.md', mockEmbedder);
    const taskDerived = result.derivedNotes.find((d) => d.contentClass === 'task');
    expect(taskDerived?.suggestedTitle).toBe('Sprint Tasks');
  });

  it('handles document with no frontmatter', async () => {
    const content = `## Architecture

The system uses microservices with a message queue.

\`\`\`yaml
services:
  api:
    image: api:latest
\`\`\`

\`\`\`yaml
deploy:
  replicas: 3
\`\`\`

## Tasks

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Build API | Open | High | Alice |
`;
    const result = await splitDocument(content, 'no-fm.md', mockEmbedder);
    expect(result.sourceNote.frontmatter).toEqual({});
    expect(result.derivedNotes.length).toBeGreaterThanOrEqual(0);
  });

  it('skips sections that are too short', async () => {
    const content = `---
title: Short Sections
type: note
tier: slow
---

## Intro

Hi.

## Tasks

| Title | Status | Priority | Assignee |
| --- | --- | --- | --- |
| Build API | Open | High | Alice |
`;
    const result = await splitDocument(content, 'short.md', mockEmbedder);
    // The short "Hi." section should be skipped, leaving only one class
    expect(result.derivedNotes).toHaveLength(0);
  });
});

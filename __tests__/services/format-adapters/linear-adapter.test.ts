import { describe, it, expect } from 'vitest';
import {
  isLinearCsv,
  linearCsvToTaskNotes,
  mapLinearPriority,
  mapLinearStatus,
} from '../../../src/services/format-adapters/linear-adapter.js';

describe('isLinearCsv', () => {
  it('detects Linear CSV by column names', () => {
    expect(isLinearCsv(['Title', 'Status', 'Priority', 'Assignee', 'Project'])).toBe(true);
  });

  it('detects with minimal required columns', () => {
    expect(isLinearCsv(['Title', 'Status', 'Priority'])).toBe(true);
  });

  it('returns false for generic CSV', () => {
    expect(isLinearCsv(['Name', 'Email', 'Phone'])).toBe(false);
  });

  it('returns false when title is missing', () => {
    expect(isLinearCsv(['Status', 'Priority', 'Assignee'])).toBe(false);
  });

  it('returns false when status is missing', () => {
    expect(isLinearCsv(['Title', 'Priority', 'Assignee'])).toBe(false);
  });
});

describe('mapLinearPriority', () => {
  it('maps Urgent to critical', () => expect(mapLinearPriority('Urgent')).toBe('critical'));
  it('maps High to high', () => expect(mapLinearPriority('High')).toBe('high'));
  it('maps Medium to medium', () => expect(mapLinearPriority('Medium')).toBe('medium'));
  it('maps Low to low', () => expect(mapLinearPriority('Low')).toBe('low'));
  it('maps No priority to medium', () => expect(mapLinearPriority('No priority')).toBe('medium'));
  it('maps unknown values to medium', () => expect(mapLinearPriority('unknown')).toBe('medium'));
});

describe('mapLinearStatus', () => {
  it('maps Todo to pending', () => expect(mapLinearStatus('Todo')).toBe('pending'));
  it('maps Backlog to pending', () => expect(mapLinearStatus('Backlog')).toBe('pending'));
  it('maps Triage to pending', () => expect(mapLinearStatus('Triage')).toBe('pending'));
  it('maps In Progress to in-progress', () =>
    expect(mapLinearStatus('In Progress')).toBe('in-progress'));
  it('maps Done to done', () => expect(mapLinearStatus('Done')).toBe('done'));
  it('maps Completed to done', () => expect(mapLinearStatus('Completed')).toBe('done'));
  it('maps Cancelled to cancelled', () => expect(mapLinearStatus('Cancelled')).toBe('cancelled'));
  it('maps Canceled to cancelled', () => expect(mapLinearStatus('Canceled')).toBe('cancelled'));
});

describe('linearCsvToTaskNotes', () => {
  it('converts rows to structured task records', () => {
    const parsed = {
      headers: ['Title', 'Status', 'Priority', 'Assignee', 'Description'],
      rows: [
        ['Fix login bug', 'In Progress', 'High', 'Alice', 'Login fails on mobile'],
        ['Add dark mode', 'Todo', 'Medium', 'Bob', 'Support dark theme'],
      ],
    };

    const tasks = linearCsvToTaskNotes(parsed);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual({
      title: 'Fix login bug',
      description: 'Login fails on mobile',
      priority: 'high',
      status: 'in-progress',
      assignee: 'Alice',
    });
    expect(tasks[1]).toEqual({
      title: 'Add dark mode',
      description: 'Support dark theme',
      priority: 'medium',
      status: 'pending',
      assignee: 'Bob',
    });
  });

  it('handles missing description column', () => {
    const parsed = {
      headers: ['Title', 'Status', 'Priority'],
      rows: [['Task 1', 'Done', 'Low']],
    };

    const tasks = linearCsvToTaskNotes(parsed);
    expect(tasks[0].description).toBe('');
    expect(tasks[0].assignee).toBe('');
  });
});

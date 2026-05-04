import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SkillInventory } from '@puffer/core';
import { SkillInventoryService } from '@puffer/daemon';

// We stub scanSkills and diffInventories at the module level
vi.mock('@puffer/skills', () => ({
  scanSkills: vi.fn(),
  diffInventories: vi.fn(),
}));

import { scanSkills, diffInventories } from '@puffer/skills';

const inventory1: SkillInventory = {
  scannedAt: '2024-01-01T00:00:00.000Z',
  skills: [
    {
      id: 'claude-code-global/foo',
      name: 'foo',
      source: 'claude-code-global',
      rootPath: '/home/user/.claude/skills/foo',
      manifestPath: null,
      description: '',
      contentHash: 'aabbcc',
      lastModified: '2024-01-01T00:00:00.000Z',
      sizeBytes: 100,
      fileCount: 1,
    },
  ],
  roots: [],
};

const inventory2: SkillInventory = {
  scannedAt: '2024-01-02T00:00:00.000Z',
  skills: [
    {
      id: 'claude-code-global/foo',
      name: 'foo',
      source: 'claude-code-global',
      rootPath: '/home/user/.claude/skills/foo',
      manifestPath: null,
      description: '',
      contentHash: 'ddeeff', // changed
      lastModified: '2024-01-02T00:00:00.000Z',
      sizeBytes: 120,
      fileCount: 1,
    },
    {
      id: 'claude-code-global/bar',
      name: 'bar',
      source: 'claude-code-global',
      rootPath: '/home/user/.claude/skills/bar',
      manifestPath: null,
      description: '',
      contentHash: 'ff0011',
      lastModified: '2024-01-02T00:00:00.000Z',
      sizeBytes: 50,
      fileCount: 1,
    },
  ],
  roots: [],
};

describe('SkillInventoryService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call scanSkills on start and cache the result', async () => {
    const mockScan = vi.mocked(scanSkills);
    mockScan.mockResolvedValue(inventory1);

    const emitFn = vi.fn();
    const service = new SkillInventoryService({ emitEvent: emitFn, scanIntervalMs: 30000 });

    await service.start();

    expect(mockScan).toHaveBeenCalledOnce();
    expect(service.getInventory()).toEqual(inventory1);
  });

  it('should emit skill_added event when a new skill appears on re-scan', async () => {
    const mockScan = vi.mocked(scanSkills);
    const mockDiff = vi.mocked(diffInventories);

    mockScan.mockResolvedValueOnce(inventory1).mockResolvedValueOnce(inventory2);
    mockDiff.mockReturnValue([{ type: 'skill_added', skill: inventory2.skills[1]! }]);

    const emitFn = vi.fn();
    const service = new SkillInventoryService({ emitEvent: emitFn, scanIntervalMs: 1000 });

    await service.start();

    // Trigger the interval
    await vi.runOnlyPendingTimersAsync();

    expect(emitFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'skill_added',
        skill: inventory2.skills[1],
      }),
    );
  });

  it('should emit skill_modified when contentHash changes', async () => {
    const mockScan = vi.mocked(scanSkills);
    const mockDiff = vi.mocked(diffInventories);

    mockScan.mockResolvedValueOnce(inventory1).mockResolvedValueOnce(inventory2);
    mockDiff.mockReturnValue([
      { type: 'skill_modified', skill: inventory2.skills[0]!, previousHash: 'aabbcc' },
    ]);

    const emitFn = vi.fn();
    const service = new SkillInventoryService({ emitEvent: emitFn, scanIntervalMs: 1000 });

    await service.start();
    await vi.runOnlyPendingTimersAsync();

    expect(emitFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'skill_modified',
        previousHash: 'aabbcc',
      }),
    );
  });

  it('should emit skill_removed when a skill disappears', async () => {
    const mockScan = vi.mocked(scanSkills);
    const mockDiff = vi.mocked(diffInventories);

    mockScan.mockResolvedValueOnce(inventory2).mockResolvedValueOnce(inventory1);
    mockDiff.mockReturnValue([{ type: 'skill_removed', skill: inventory2.skills[1]! }]);

    const emitFn = vi.fn();
    const service = new SkillInventoryService({ emitEvent: emitFn, scanIntervalMs: 1000 });

    await service.start();
    await vi.runOnlyPendingTimersAsync();

    expect(emitFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'skill_removed',
      }),
    );
  });

  it('should stop the timer on stop()', async () => {
    const mockScan = vi.mocked(scanSkills);
    mockScan.mockResolvedValue(inventory1);

    const emitFn = vi.fn();
    const service = new SkillInventoryService({ emitEvent: emitFn, scanIntervalMs: 1000 });

    await service.start();
    service.stop();

    // Timer is cleared — no more scans after stop
    const callCountBeforeStop = mockScan.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(mockScan.mock.calls.length).toBe(callCountBeforeStop);
  });

  it('should expose current inventory via getInventory() getter', async () => {
    const mockScan = vi.mocked(scanSkills);
    mockScan.mockResolvedValue(inventory1);

    const emitFn = vi.fn();
    const service = new SkillInventoryService({ emitEvent: emitFn, scanIntervalMs: 30000 });

    expect(service.getInventory()).toBeNull();
    await service.start();
    expect(service.getInventory()).toEqual(inventory1);
  });
});

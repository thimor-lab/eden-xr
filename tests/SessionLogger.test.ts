import { describe, expect, it } from 'vitest';
import { SessionLogger } from '../src/core/SessionLogger';

describe('SessionLogger', () => {
  it('records events, telemetry, and errors with capped ring buffer', () => {
    const logger = new SessionLogger(5);
    logger.info('xr', 'init');
    logger.event('nav', 'pull');
    logger.telemetry('hands', { leftJoints: 25, rightJoints: 25 });
    logger.recordHandCounts(25, 25);
    logger.error('loop', new Error('test failure'));
    logger.info('xr', 'entry5');
    logger.info('xr', 'entry6');

    const exported = logger.exportObject();
    expect(exported.entries.length).toBe(5); // Capped at maxEntries
    expect(exported.summary.errorCount).toBe(1);
    expect(exported.summary.maxLeftJoints).toBe(25);
    expect(exported.summary.maxRightJoints).toBe(25);

    const json = logger.toJSON(false);
    expect(json).toContain('test failure');
  });

  it('clears entries and resets counters', () => {
    const logger = new SessionLogger(10);
    logger.error('test', 'boom');
    logger.recordHandCounts(20, 18);
    logger.clear();

    expect(logger.getEntries().length).toBe(0);
    expect(logger.errorCount).toBe(0);
    expect(logger.maxLeftJoints).toBe(0);
  });
});

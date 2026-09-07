import { describe, expect, it } from 'vitest';
import { formatBytes, formatEncoding } from './format';

describe('formatBytes', () => {
  it('formats bytes into human-readable values', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toContain('KB');
  });
});

it('uses readable encoding names without discarding unknown wire formats', () => {
  expect(formatEncoding('application/protobuf')).toBe('Protobuf');
  expect(formatEncoding('application/x-protobuf;schema=robot.Pose')).toBe('Protobuf');
  expect(formatEncoding('application/json; charset=utf-8')).toBe('JSON');
  expect(formatEncoding('application/problem+json')).toBe('JSON');
  expect(formatEncoding('text/plain')).toBe('Text');
  expect(formatEncoding('application/octet-stream')).toBe('Binary');
  expect(formatEncoding('application/vnd.robot.telemetry')).toBe('application/vnd.robot.telemetry');
});

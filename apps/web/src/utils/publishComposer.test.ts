import { describe, expect, it } from 'vitest';
import { clampEditorHeight, validatePublishDraft, type PublishDraft } from './publishComposer';
const draft: PublishDraft = {
  keyexpr: 'robot/command',
  encoding: 'json',
  payload: '{"enabled":true}'
};
describe('publish validation', () => {
  it('accepts JSON and empty text while rejecting malformed JSON and keys', () => {
    expect(validatePublishDraft(draft, []).valid).toBe(true);
    expect(validatePublishDraft({ ...draft, payload: '{' }, []).valid).toBe(false);
    expect(validatePublishDraft({ ...draft, keyexpr: '' }, []).valid).toBe(false);
    expect(validatePublishDraft({ ...draft, encoding: 'text', payload: '' }, []).valid).toBe(true);
  });
  it('checks Base64 groups and padding, with whitespace and empty payloads supported', () => {
    for (const payload of ['', 'YQ==', 'YWI=', 'YWJj', 'Y W J j\n'])
      expect(validatePublishDraft({ ...draft, encoding: 'base64', payload }, []).valid).toBe(true);
    for (const payload of ['a', 'YQ=', '====', 'YQ==junk', 'not-base64!'])
      expect(validatePublishDraft({ ...draft, encoding: 'base64', payload }, []).valid).toBe(false);
  });
  it('requires an available protobuf type and reports schema verification errors', () => {
    const proto: PublishDraft = { ...draft, encoding: 'protobuf', protoTypeId: 'reading' };
    expect(validatePublishDraft(proto, []).payloadError).toContain('schema');
    expect(
      validatePublishDraft(proto, ['reading'], () => 'value: integer expected').payloadError
    ).toBe('value: integer expected');
    expect(validatePublishDraft(proto, ['reading'], () => null).valid).toBe(true);
  });
  it('bounds persisted editor sizes and recovers from corrupt values', () => {
    expect(clampEditorHeight(20)).toBe(160);
    expect(clampEditorHeight(2000)).toBe(1200);
    expect(clampEditorHeight(NaN)).toBe(280);
    expect(clampEditorHeight(540)).toBe(540);
  });
});

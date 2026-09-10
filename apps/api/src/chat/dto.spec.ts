import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChatRequestDto } from './dto';

describe('ChatRequestDto', () => {
  const baseInput = {
    conversationId: 'conversation-1',
    turnId: 'turn-1',
    messages: [{ id: 'message-1', role: 'user', content: '问题' }],
  };

  it('applies standard mode when mode is omitted', async () => {
    const input = plainToInstance(ChatRequestDto, baseInput);

    expect(input.mode).toBe('standard');
    await expect(validate(input)).resolves.toHaveLength(0);
  });

  it('rejects null mode because the public contract only permits omission', async () => {
    const input = plainToInstance(ChatRequestDto, { ...baseInput, mode: null });
    const errors = await validate(input);

    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ property: 'mode' }),
    ]));
  });

  it('rejects client-supplied tenant identity and model routing fields', async () => {
    const input = plainToInstance(ChatRequestDto, {
      ...baseInput,
      tenantId: 'forged-tenant',
      provider: 'forged-provider',
      model: 'forged-model',
      instructions: 'forged-system-instructions',
    });
    const errors = await validate(input, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining([
      'tenantId',
      'provider',
      'model',
      'instructions',
    ]));
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function freshAppPasswordGate() {
  vi.resetModules();
  const mod = await import('../src/authGate.js');
  return mod.appPasswordGate;
}

function mockRes() {
  const res: any = {};
  res.set = vi.fn().mockReturnValue(res);
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

describe('appPasswordGate', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('passes through when APP_PASSWORD is not set', async () => {
    delete process.env.APP_PASSWORD;
    const gate = await freshAppPasswordGate();
    const next = vi.fn();
    gate({ headers: {} } as any, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects requests without credentials when APP_PASSWORD is set', async () => {
    process.env.APP_PASSWORD = 'secret';
    const gate = await freshAppPasswordGate();
    const next = vi.fn();
    const res = mockRes();
    gate({ headers: {} } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects the wrong password', async () => {
    process.env.APP_PASSWORD = 'secret';
    const gate = await freshAppPasswordGate();
    const next = vi.fn();
    const res = mockRes();
    const auth = `Basic ${Buffer.from('anyuser:wrong').toString('base64')}`;
    gate({ headers: { authorization: auth } } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts the right password regardless of username', async () => {
    process.env.APP_PASSWORD = 'secret';
    const gate = await freshAppPasswordGate();
    const next = vi.fn();
    const res = mockRes();
    const auth = `Basic ${Buffer.from('anyuser:secret').toString('base64')}`;
    gate({ headers: { authorization: auth } } as any, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

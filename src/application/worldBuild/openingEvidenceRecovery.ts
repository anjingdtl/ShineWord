/** Whether a failed bootstrap publication is specifically missing opening evidence. */
export function shouldExtendOpeningBootstrap(error: unknown): boolean {
  if (error && typeof error === 'object' && 'errorCodes' in error) {
    const codes = (error as { errorCodes?: unknown }).errorCodes;
    if (Array.isArray(codes) && codes.some(code => typeof code === 'string'
      && /^opening_entity_unproven(?::|$)/.test(code))) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /事实不足|开局缺少|来源闭包|引用实体缺失/.test(message);
}

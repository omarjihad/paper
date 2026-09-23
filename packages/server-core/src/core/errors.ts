/** خطأ يحمل رمز حالة HTTP ورسالة عربية صالحة للعرض. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const unauthorized = (code: string, message: string) => new AppError(401, code, message);
export const notFound = (code: string, message: string) => new AppError(404, code, message);

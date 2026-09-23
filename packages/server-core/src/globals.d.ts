/**
 * الواجهات العالمية التي تعتمد عليها هذه الحزمة — وهي كلّها قياسية وموجودة
 * في Node 18+ وفي Cloudflare Workers معًا.
 *
 * نصرّح بها يدويًا بدل تضمين lib "DOM" كي تبقى القائمة صريحة: أي إضافة هنا
 * قرارٌ واعٍ بربط الحزمة بواجهة جديدة، لا انزلاق صامت إلى واجهات المتصفّح.
 */
declare function btoa(data: string): string;
declare function atob(data: string): string;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}

declare const crypto: {
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView>(array: T): T;
};

declare function setInterval(handler: () => void, timeout?: number): unknown;
declare function clearInterval(handle: unknown): void;
declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle: unknown): void;

/**
 * عقد الطور الشبكي — معرَّف الآن، وغير مُفعَّل في هذه المرحلة.
 *
 * الغرض منه أن تكون إضافة WebSocket لاحقًا عملية توصيل لا إعادة بناء:
 * الواجهة اليوم تُغذّي المحرك من وحدة تحكم محلية، وغدًا من هذا العقد نفسه.
 * لا تضف هنا أي تنفيذ قبل مرحلة الشبكة.
 */
export interface RealtimeMessage {
  type: string;
  matchId: string;
  tick: number;
  payload: unknown;
}

export interface RealtimeGateway {
  /** يُستدعى عند انضمام لاعب إلى جولة شبكية. */
  join(matchId: string, playerId: string): Promise<void>;
  /** إرسال إدخال اللاعب إلى الخادم الموثوق. */
  send(message: RealtimeMessage): void;
  /** استقبال لقطات الحالة من الخادم. */
  onMessage(handler: (message: RealtimeMessage) => void): void;
  close(): void;
}

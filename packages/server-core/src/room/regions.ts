import { DEFAULT_REGION, REGIONS, isRegionId, type RegionId, type RegionInfo } from '@riqaa/shared';

/**
 * تجريد المناطق.
 *
 * الخدمة اليوم تعمل من موقع واحد، فمنطقة واحدة فقط «مستضافة» والبقية خيارات
 * معروضة بلا خادم خاص بها. نعلن ذلك صراحةً بدل اختراع أرقام زمن استجابة:
 * الواجهة تقيس الزمن الحقيقي للخادم الذي تتصل به فعلًا، ولا تعرض رقمًا لغيره.
 * إضافة نشر حقيقي في منطقة أخرى لاحقًا لا تحتاج أكثر من ضبط SERVER_REGION هناك.
 */
export function resolveServerRegion(raw: string): RegionId {
  return isRegionId(raw) ? raw : DEFAULT_REGION;
}

export function regionCatalog(server: RegionId): RegionInfo[] {
  return REGIONS.map((region) => ({ ...region, hosted: region.id === server }));
}

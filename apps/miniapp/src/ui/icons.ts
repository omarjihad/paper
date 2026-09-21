/** أيقونات SVG مضمّنة — لا مكتبة أيقونات ولا إيموجي يتغيّر شكله بين الأجهزة. */
function svg(path: string, size = 22): SVGSVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  element.setAttribute('viewBox', '0 0 24 24');
  element.setAttribute('width', String(size));
  element.setAttribute('height', String(size));
  element.setAttribute('fill', 'none');
  element.setAttribute('stroke', 'currentColor');
  element.setAttribute('stroke-width', '1.9');
  element.setAttribute('stroke-linecap', 'round');
  element.setAttribute('stroke-linejoin', 'round');
  element.setAttribute('aria-hidden', 'true');

  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  element.append(shape);
  return element;
}

export const icons = {
  home: (size?: number) => svg('M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z', size),
  user: (size?: number) => svg('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0', size),
  /** سهم يشير لليسار — اتجاه «التالي» في واجهة عربية. */
  chevron: (size?: number) => svg('M14 6l-6 6 6 6', size),
};

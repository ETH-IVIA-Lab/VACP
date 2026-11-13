import css from 'virtual:vacp-presence-sheet';

const sheets = new WeakMap<Document, CSSStyleSheet>();

/** The overlay's compiled StyleX rules, as one constructable sheet per document shared by its overlays. */
export function presenceStyleSheet(doc: Document): CSSStyleSheet {
  let sheet = sheets.get(doc);
  if (!sheet) {
    sheet = new doc.defaultView!.CSSStyleSheet();
    sheet.replaceSync(css);
    sheets.set(doc, sheet);
  }
  return sheet;
}

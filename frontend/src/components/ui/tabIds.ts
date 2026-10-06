/** Ids that tie a tab to its panel. */
export function tabId(idBase: string, id: string): string {
  return `${idBase}-tab-${id}`
}

export function panelId(idBase: string, id: string): string {
  return `${idBase}-panel-${id}`
}

/**
 * Utilities for exporting Trader Location and Route data to JSON and CSV.
 */

/**
 * Wraps a value in a CSV-safe string, quoting when necessary.
 * @param {*} val
 * @returns {string}
 */
function csvCell(val) {
  const s = val == null ? '' : String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/**
 * Serialises locations and routes to a JSON string suitable for re-import.
 *
 * @param {object[]} locations  - TraderLocation records from IndexedDB
 * @param {object[]} routes     - Route records from IndexedDB
 * @param {string}   scenarioName
 * @returns {string}
 */
export function buildLocationsRoutesJson(locations, routes, scenarioName) {
  return JSON.stringify(
    {
      version:    1,
      exportedAt: new Date().toISOString(),
      scenarioName,
      locations,
      routes,
    },
    null,
    2
  );
}

/**
 * Serialises locations and routes to a human-readable CSV string.
 *
 * Layout:
 *   # header comment lines
 *   (blank)
 *   ## LOCATIONS
 *   column row
 *   one data row per location
 *   (blank)
 *   ## ROUTES
 *   column row
 *   one data row per stop (route name repeated), blank line between routes
 *
 * @param {object[]} locations
 * @param {object[]} routes
 * @param {string}   scenarioName
 * @returns {string}
 */
export function buildLocationsRoutesCsv(locations, routes, scenarioName) {
  const lines = [];

  lines.push(`# Empyrion Codex Export - ${scenarioName}`);
  lines.push(`# Exported: ${new Date().toISOString()}`);
  lines.push('');

  // ── Locations ──────────────────────────────────────────────
  lines.push('## LOCATIONS');
  lines.push(csvRow(['Trader', 'Playfield', 'POI', 'Restock (min)', 'Last Visited', 'Notes', 'Key Items']));

  for (const loc of locations) {
    const keyItemsStr = loc.keyItems?.length
      ? loc.keyItems
          .map(ki => {
            const tag = ki.intent === 'sell' ? 'SELL' : ki.intent === 'buy' ? 'BUY' : '—';
            return `${ki.displayName} [${tag}]`;
          })
          .join(', ')
      : '';

    lines.push(
      csvRow([
        loc.traderName      ?? '',
        loc.playfield       ?? '',
        loc.poi             ?? '',
        loc.restockMinutes  ?? '',
        loc.lastVisitedAt   ? loc.lastVisitedAt.slice(0, 10) : '',
        loc.notes           ?? '',
        keyItemsStr,
      ])
    );
  }

  lines.push('');

  // ── Routes ─────────────────────────────────────────────────
  const locById = new Map(locations.map(l => [l.id, l]));

  lines.push('## ROUTES');
  lines.push(csvRow(['Route Name', 'Created', 'Stop #', 'Trader', 'Playfield', 'POI']));

  let firstRoute = true;
  for (const route of routes) {
    if (!firstRoute) lines.push('');
    firstRoute = false;

    const stops = [...(route.stops ?? [])].sort((a, b) => a.order - b.order);
    for (const stop of stops) {
      const loc = locById.get(stop.locationId);
      lines.push(
        csvRow([
          route.name    ?? '',
          route.createdAt ? route.createdAt.slice(0, 10) : '',
          stop.order,
          loc?.traderName ?? '(unknown)',
          loc?.playfield  ?? '',
          loc?.poi        ?? '',
        ])
      );
    }
  }

  return lines.join('\n');
}

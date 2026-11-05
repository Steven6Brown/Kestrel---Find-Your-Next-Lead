// iCalendar (.ics) export so meetings can be imported into Google Calendar or any calendar app.
// Every text value is escaped per RFC 5545 and lines are folded at 75 bytes, so a meeting title
// can never inject extra calendar fields or events.

const CRLF = "\r\n";

export function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** Fold a content line so no line is longer than 75 bytes (continuations start with one space). */
export function foldLine(line) {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--; // do not split a multi-byte character
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74; // continuation lines lose one byte to the leading space
  }
  return parts.join(CRLF + " ");
}

const stamp = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

/**
 * events: [{ uid, startIso, durationMinutes, summary, location, description, status }]
 * Times are written in UTC, so they land correctly in any time zone.
 */
export function buildIcs(events, { productName = "Kestrel", now = new Date() } = {}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${productName.replace(/[^A-Za-z0-9 ]/g, "")}//Meetings//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(productName + " meetings")}`,
  ];
  for (const e of events) {
    const start = new Date(e.startIso);
    if (Number.isNaN(start.getTime())) continue;
    const end = new Date(start.getTime() + (e.durationMinutes || 30) * 60000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${String(e.uid).replace(/[^A-Za-z0-9@._-]/g, "")}`,
      `DTSTAMP:${stamp(now.toISOString())}`,
      `DTSTART:${stamp(start.toISOString())}`,
      `DTEND:${stamp(end.toISOString())}`,
      `SUMMARY:${escapeText(e.summary)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      `STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join(CRLF) + CRLF;
}

// Google Calendar connector: planned, not available yet. Signing in to Google needs a public
// https address to return to, which a locally run Kestrel does not have. Until then the booking
// link connector covers scheduling.
const connector = {
  id: "google_calendar",
  name: "Google Calendar and Meet",
  description: "Show your free times on a booking page inside Kestrel, and create the calendar event and Meet link when someone books.",
  mode: "unavailable",
  unavailableReason: "Needs Kestrel to be hosted at a public https address first. Use the booking link above until then.",
  async check() {
    return { ok: false, message: "Not available until Kestrel is hosted." };
  },
};

export default connector;

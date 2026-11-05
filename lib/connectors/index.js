// Connector registry. Every connector has the same shape so providers can be added or swapped
// without touching the rest of the app:
//   id, name, description, mode ("setting" | "env" | "unavailable")
//   check({ env, connection, fetchImpl })  -> { ok, message }   (never throws, never leaks secrets)
//   mode "setting": validate(input) -> { ok, value } | { ok: false, error }
//   mode "env":     envVars (names only) and configured(env)
import bookingLink from "./bookinglink.js";
import paypal from "./paypal.js";
import resend from "./resend.js";
import googleCalendar from "./google.js";

export const CONNECTORS = [bookingLink, paypal, resend, googleCalendar];
export const connectorIds = () => CONNECTORS.map((c) => c.id);
export const getConnector = (id) => CONNECTORS.find((c) => c.id === id) || null;

/**
 * What to show for one connector: a state (connected, not_connected, error, unavailable), a short
 * detail line, and the last check time. `connection` is the saved row (or null).
 */
export function describeConnector(connector, connection, env = process.env) {
  if (connector.mode === "unavailable") return { state: "unavailable", detail: connector.unavailableReason };
  if (connector.mode === "setting") {
    if (!connection || connection.status === "disconnected") return { state: "not_connected", detail: "Not set up yet." };
    if (connection.status === "error") return { state: "error", detail: connection.last_error || "Needs attention." };
    return { state: "connected", detail: JSON.parse(connection.config || "{}").url || "Saved." };
  }
  if (!connector.configured(env)) return { state: "not_connected", detail: `Needs ${(connector.requiredVars || connector.envVars).join(" and ")} in .env.local.` };
  if (connection?.status === "error") return { state: "error", detail: connection.last_error || "Needs attention." };
  if (connection?.status === "connected") return { state: "connected", detail: connection.last_error ? connection.last_error : "Credentials checked." };
  return { state: "not_connected", detail: "Settings found. Press Test connection to check them." };
}

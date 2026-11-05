// Narrow read helper for public pages, so they never load more of a user than they show.
import { query } from "./db.js";

export async function getInvitedUser(id) {
  const [u] = await query("SELECT id, email, name, status FROM users WHERE id = ?", [id]);
  return u && u.status === "invited" ? u : null;
}

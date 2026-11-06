import { BRAND } from "@/lib/auth";
import { tagCounts, tagsForLead } from "@/lib/store";
import { addTagsAction, removeTagAction } from "@/app/(admin)/tags-actions";

/** Tags on one contact: see them, remove one, add new ones by typing or picking a tag already in use. */
export default async function TagsPanel({ lead }) {
  const [mine, all] = await Promise.all([tagsForLead(BRAND, lead.id), tagCounts(BRAND, 20)]);
  const suggestions = all.map((t) => t.tag).filter((t) => !mine.includes(t)).slice(0, 8);
  return (
    <section aria-labelledby="tags-h" className="card mt-8 p-5">
      <h2 id="tags-h" className="text-2xl font-semibold">Tags</h2>
      <p className="mt-1 text-sm text-muted">Short labels of your own, like &quot;coffee&quot; or &quot;met at expo&quot;. You can filter the Prospects list by any tag.</p>
      {mine.length === 0 ? <p className="mt-3 text-muted">No tags yet.</p> : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {mine.map((t) => (
            <li key={t}>
              <form action={removeTagAction} className="flex items-center rounded-lg border border-edge bg-paper">
                <input type="hidden" name="leadId" value={lead.id} />
                <input type="hidden" name="tag" value={t} />
                <span className="px-3 py-2 text-ink">{t}</span>
                <button type="submit" className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center border-l border-edge px-2 text-muted hover:text-bad" aria-label={`Remove the tag ${t}`}>Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={addTagsAction} className="mt-4">
        <input type="hidden" name="leadId" value={lead.id} />
        {suggestions.length > 0 && (
          <div className="mb-3">
            <p className="text-sm font-semibold text-ink">Tags already in use</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((t) => <button key={t} type="submit" name="pick" value={t} className="btn">{t}</button>)}
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="tags" className="block text-sm font-semibold text-ink">Or add new tags (separate with commas)</label>
            <input id="tags" name="tags" maxLength={200} autoComplete="off" className="field mt-1 w-72" />
          </div>
          <button type="submit" className="btn btn-primary">Add tags</button>
        </div>
      </form>
    </section>
  );
}

import { ChipRadio } from "@/components/Chips";
import { MEETING_LOCATIONS, MEETING_TITLES } from "@/lib/crm";
import { logMeetingAction } from "@/app/(admin)/clients-actions";

/** Log a meeting for a contact (leadId) or a client (clientId). Kinds and places are buttons. */
export default function MeetingForm({ leadId, clientId }) {
  return (
    <form action={logMeetingAction} className="mt-4 space-y-4">
      {leadId ? <input type="hidden" name="leadId" value={leadId} /> : null}
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
      <fieldset>
        <legend className="font-semibold text-ink">Kind of meeting</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {MEETING_TITLES.map((t, i) => <ChipRadio key={t} name="title" value={t} label={t} defaultChecked={i === 0} />)}
        </div>
      </fieldset>
      <fieldset>
        <legend className="font-semibold text-ink">Where</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {MEETING_LOCATIONS.map(([k, l], i) => <ChipRadio key={k} name="location" value={k} label={l} defaultChecked={i === 0} />)}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`mt-${leadId || clientId}`} className="block font-semibold text-ink">Date and time</label>
        <input id={`mt-${leadId || clientId}`} name="startsAt" type="datetime-local" required className="field mt-1 max-w-xs" />
      </div>
      <div>
        <label htmlFor={`mn-${leadId || clientId}`} className="block font-semibold text-ink">Notes (optional)</label>
        <textarea id={`mn-${leadId || clientId}`} name="notes" rows={2} maxLength={2000} className="field mt-1" />
      </div>
      <button type="submit" className="btn btn-primary">Save meeting</button>
    </form>
  );
}

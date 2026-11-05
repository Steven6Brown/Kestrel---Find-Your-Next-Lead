// Pick-from-a-list controls. Native checkboxes and radios (keyboard and screen reader
// friendly, no JavaScript), drawn as large buttons. A check mark shows the selected
// state so color is never the only signal.
// `form` ties the input to a form by id even if the browser places it outside the form element
// (streamed Suspense content can land outside it), so the value is always submitted.
export function ChipCheckbox({ name, value, label, defaultChecked = false, form }) {
  return (
    <label className="chip">
      <input type="checkbox" name={name} value={value} defaultChecked={defaultChecked} form={form} />
      <span>{label}</span>
    </label>
  );
}

export function ChipRadio({ name, value, label, defaultChecked = false }) {
  return (
    <label className="chip">
      <input type="radio" name={name} value={value} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}

export function ChipGroup({ legend, hint, children }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-lg font-semibold text-ink">{legend}</legend>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

export function StatusPill({ status }) {
  const map = {
    done: ["Done", "ok"], partial: ["Partly done", "warn"], error: ["Failed", "bad"],
    running: ["Running", "warn"], interrupted: ["Interrupted", "bad"],
  };
  const [label, tone] = map[status] || [status, "warn"];
  const cls = { ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad" }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>;
}

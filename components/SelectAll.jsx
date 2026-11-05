"use client";

/** Select all / clear for a group of checkboxes that share a name and belong to a form. */
export default function SelectAll({ name, form, label = "cities" }) {
  const set = (checked) => {
    for (const el of document.querySelectorAll(`input[type=checkbox][name="${name}"]`)) {
      if (el.form?.id === form || el.getAttribute("form") === form) el.checked = checked;
    }
  };
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      <button type="button" className="btn" onClick={() => set(true)}>Select all {label}</button>
      <button type="button" className="btn" onClick={() => set(false)}>Clear</button>
    </div>
  );
}

"use client";

import { useActionState, useId, useState } from "react";

// One accessible form for every account screen. Server actions return { error } or { ok };
// text values (never passwords) are echoed back so a failed attempt does not clear the form.
function PasswordInput({ id, name, autoComplete, describedBy, required }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id} name={name} type={shown ? "text" : "password"} autoComplete={autoComplete}
        required={required} aria-describedby={describedBy} className="field" maxLength={256}
        autoCapitalize="none" spellCheck={false}
      />
      <button
        type="button" className="btn !px-3" aria-pressed={shown} aria-controls={id}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}

export default function AuthForm({ action, fields, submitLabel, hidden = {}, initial = {}, children }) {
  const [state, formAction, pending] = useActionState(action, { values: initial });
  const base = useId();
  const errId = `${base}-err`;
  return (
    <form action={formAction} className="space-y-5" noValidate={false}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div id={errId} aria-live="polite">
        {state?.error ? <p role="alert" className="border border-bad bg-bad-bg p-3 text-bad">{state.error}</p> : null}
        {state?.ok ? <p role="status" className="border border-ok bg-ok-bg p-3 text-ok">{state.ok}</p> : null}
      </div>
      {fields.map((f) => {
        const id = `${base}-${f.name}`;
        const hintId = f.hint ? `${id}-hint` : undefined;
        return (
          <div key={f.name}>
            <label htmlFor={id} className="block font-semibold text-ink">{f.label}</label>
            {f.type === "password" ? (
              <div className="mt-1"><PasswordInput id={id} name={f.name} autoComplete={f.autoComplete} describedBy={hintId} required={f.required !== false} /></div>
            ) : (
              <input
                id={id} name={f.name} type={f.type || "text"} autoComplete={f.autoComplete} inputMode={f.inputMode}
                required={f.required !== false} aria-describedby={hintId} className="field mt-1"
                defaultValue={state?.values?.[f.name] ?? ""} maxLength={f.maxLength || 254}
                autoCapitalize="none" spellCheck={false} autoFocus={f.autoFocus}
              />
            )}
            {f.hint ? <p id={hintId} className="mt-1 text-sm text-muted">{f.hint}</p> : null}
          </div>
        );
      })}
      {children}
      {state?.codes ? <RecoveryCodes codes={state.codes} /> : null}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Working..." : submitLabel}
      </button>
    </form>
  );
}

/** Shows recovery codes exactly once, with a plain download so they can be stored safely. */
export function RecoveryCodes({ codes }) {
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(`SiteScout recovery codes\nEach code works once.\n\n${codes.join("\n")}\n`)}`;
  return (
    <div className="border border-warn bg-warn-bg p-4 text-warn">
      <p className="font-semibold">Save these recovery codes now. They are shown only once.</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-ink">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <a className="btn mt-4" href={href} download="sitescout-recovery-codes.txt">Download as a text file</a>
    </div>
  );
}

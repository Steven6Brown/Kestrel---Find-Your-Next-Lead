export default function Flash({ sp }) {
  if (!sp?.msg) return null;
  const bad = sp.type === "bad";
  return (
    <div
      role={bad ? "alert" : "status"}
      aria-live="polite"
      className={`mb-6 border-2 px-4 py-3 font-medium ${bad ? "border-bad bg-bad-bg text-bad" : "border-ok bg-ok-bg text-ok"}`}
    >
      {bad ? "Problem: " : "Done: "}
      {sp.msg}
    </div>
  );
}

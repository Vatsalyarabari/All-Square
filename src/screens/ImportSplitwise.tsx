// Bring a group over from Splitwise, checked against Splitwise's own totals.

import { useMemo, useState } from "react";
import { newId, actions } from "../lib/store.ts";
import { buildGroup, checkAgainstSplitwise, parseSplitwise, type ParsedSplitwise } from "../lib/splitwiseImport.ts";
import { formatCents } from "../lib/money.ts";
import { Chips, Icon, Sheet, useNav, useSheetClose } from "../ui/kit.tsx";

export function ImportSplitwise() {
  return <Sheet surface><Body /></Sheet>;
}

function Body() {
  const nav = useNav();
  const close = useSheetClose();
  const [parsed, setParsed] = useState<ParsedSplitwise | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [me, setMe] = useState("0");
  const [rates, setRates] = useState<Record<string, string>>({});

  async function load(file?: File) {
    if (!file) return;
    setError("");
    try {
      const p = parseSplitwise(await file.text());
      setParsed(p);
      setName(file.name.replace(/\.csv$/i, "").replace(/[_ -]*\d{4}-\d{2}-\d{2}.*$/, "").replace(/[_ -]*export.*$/i, "").replace(/[_-]+/g, " ").trim() || "Imported group");
    } catch (e) {
      setParsed(null);
      setError((e as Error).message);
    }
  }

  const rateNums = Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, Number(v)]));
  const missingRate = parsed?.otherCurrencies.find((c) => !(rateNums[c] > 0));
  const preview = useMemo(() => {
    if (!parsed || missingRate) return null;
    try {
      const group = buildGroup(parsed, { name: name || "Imported group", meIndex: Number(me), rates: rateNums, makeId: newId });
      return { group, mismatches: checkAgainstSplitwise(group, parsed) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [parsed, name, me, missingRate, JSON.stringify(rateNums)]); // eslint-disable-line react-hooks/exhaustive-deps

  const payments = parsed?.rows.filter((r) => r.isPayment).length ?? 0;
  return (
    <div className="sheet-body">
      <div className="sheet-top"><button type="button" className="round surface2" aria-label="Close" onClick={close}><Icon name="x" size={20} /></button></div>
      <h2 className="title">Import from Splitwise</h2>
      <ol className="steps muted">
        <li>On splitwise.com, open the group.</li>
        <li>Open the group's settings (gear), choose <b>Export as spreadsheet</b>.</li>
        <li>Pick the downloaded .csv file here. Repeat for each group.</li>
      </ol>
      <label className="source">
        <span className="source-icon"><Icon name="copy" size={24} /></span>
        <span className="grow"><b>{parsed ? "Choose a different file" : "Choose the .csv file"}</b><small className="muted">Nothing leaves your phone.</small></span>
        <input type="file" accept=".csv,text/csv" onChange={(e) => load(e.target.files?.[0])} />
      </label>
      {error && <p className="warn-text pad-s">{error}</p>}

      {parsed && (
        <>
          <h3 className="section-title">Group name</h3>
          <input className="desc" value={name} onChange={(e) => setName(e.target.value)} aria-label="Group name" />
          <h3 className="section-title">Which one is you?</h3>
          <Chips small options={parsed.people.map((p, i) => ({ id: String(i), label: p }))} selected={[me]} onToggle={setMe} />
          <p className="muted pad-s">
            {parsed.rows.length - payments} expense{parsed.rows.length - payments === 1 ? "" : "s"} and {payments} payment{payments === 1 ? "" : "s"} found
            {parsed.skipped ? `. ${parsed.skipped} rows changed nobody's balance and were left out.` : "."}
          </p>
          {parsed.otherCurrencies.map((c) => (
            <label className="row rate-row" key={c}>
              <span className="row-label">1 {c} =</span>
              <input inputMode="decimal" value={rates[c] ?? ""} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} placeholder="rate" aria-label={`${c} rate`} />
              <span className="muted">{parsed.currency}</span>
            </label>
          ))}
          {parsed.problems.map((p) => <div className="issue" key={p}><p>{p}</p></div>)}
          {preview && "error" in preview && <div className="issue error"><p>{preview.error}</p></div>}
          {preview && "group" in preview && preview.group && (
            preview.mismatches.length === 0 ? (
              <div className="issue ok"><p>{parsed.totals ? "✓ Every balance matches Splitwise exactly." : "Imported. This file had no Total balance row to check against."}</p></div>
            ) : (
              <div className="issue error">{preview.mismatches.map((m) => <p key={m}>{m}</p>)}</div>
            )
          )}
          <button type="button" className="primary" disabled={!preview || !("group" in preview) || !preview.group}
            onClick={() => {
              if (!preview || !("group" in preview) || !preview.group) return;
              actions.importGroup(preview.group);
              nav.closeAll();
              nav.toast(`Imported ${preview.group.expenses.length} expenses`);
            }}>
            {missingRate ? `Enter the ${missingRate} rate to continue` : `Import ${name || "group"}`}
          </button>
          {parsed.totals && preview && "group" in preview && preview.group && (
            <p className="muted small-text center">
              Your balance after import: {formatCents(parsed.totals[Number(me)] ?? 0, parsed.currency)}
            </p>
          )}
        </>
      )}
    </div>
  );
}

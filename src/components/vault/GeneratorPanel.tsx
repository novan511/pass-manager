"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Sliders,
  Check,
} from "lucide-react";
import {
  generatePassword,
  generatePassphrase,
  type GeneratorOptions,
  type PassphraseOptions,
} from "@/lib/password";
import { passwordStrength } from "@/lib/crypto";

const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function GeneratorPanel({ onCopied }: { onCopied: (msg: string) => void }) {
  const [mode, setMode] = useState<"password" | "passphrase">("password");
  const [show, setShow] = useState(true);
  const [value, setValue] = useState("");
  const [pwOpts, setPwOpts] = useState<GeneratorOptions>({
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: true,
  });
  const [ppOpts, setPpOpts] = useState<PassphraseOptions>({
    words: 5,
    separator: "-",
    capitalize: false,
    includeNumber: true,
  });

  const generate = useMemo(() => {
    return mode === "password"
      ? () => generatePassword(pwOpts)
      : () => generatePassphrase(ppOpts);
  }, [mode, pwOpts, ppOpts]);

  useEffect(() => {
    setValue(generate());
  }, [generate]);

  async function copy() {
    await navigator.clipboard.writeText(value);
    onCopied("Copied to clipboard");
  }

  const score = mode === "password" ? passwordStrength(value) : Math.min(4, Math.max(2, Math.floor(value.length / 12)));

  return (
    <div className="space-y-5">
      <div className="card p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck size={16} style={{ color: "var(--accent)" }} />
          <h2 className="font-semibold text-sm">Generated secret</h2>
        </div>
        <div className="field-row">
          <span
            className="value mono"
            style={{ fontSize: show ? "0.95rem" : "1rem", letterSpacing: show ? "0.02em" : "0.2em" }}
          >
            {show ? value : "•".repeat(Math.min(value.length, 28))}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide" : "Reveal"}>
            {show ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setValue(generate())} aria-label="Regenerate">
            <RefreshCw size={15} />
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            <Copy size={14} /> Copy
          </button>
        </div>
        <div className="strength" data-score={score} aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {STRENGTH_LABEL[score]} · {value.length} characters
        </p>
      </div>

      <div className="card p-4 space-y-4">
        <div className="flex gap-2">
          {(["password", "passphrase"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`btn btn-sm ${mode === m ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setMode(m)}
            >
              {m === "password" ? "Password" : "Passphrase"}
            </button>
          ))}
        </div>

        {mode === "password" ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="label mb-0">Length</label>
                <span className="mono text-sm">{pwOpts.length}</span>
              </div>
              <input
                type="range"
                min={8}
                max={64}
                value={pwOpts.length}
                onChange={(e) => setPwOpts({ ...pwOpts, length: Number(e.target.value) })}
                className="w-full mt-2"
                style={{ accentColor: "var(--accent)" }}
              />
            </div>
            {(
              [
                ["upper", "Uppercase (A–Z)"],
                ["lower", "Lowercase (a–z)"],
                ["digits", "Numbers (2–9)"],
                ["symbols", "Symbols (!@#$…)"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between text-sm cursor-pointer">
                <span style={{ color: "var(--ink)" }}>{label}</span>
                <input
                  type="checkbox"
                  checked={pwOpts[key]}
                  onChange={(e) => setPwOpts({ ...pwOpts, [key]: e.target.checked })}
                  style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
                />
              </label>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between">
                <label className="label mb-0">Words</label>
                <span className="mono text-sm">{ppOpts.words}</span>
              </div>
              <input
                type="range"
                min={3}
                max={10}
                value={ppOpts.words}
                onChange={(e) => setPpOpts({ ...ppOpts, words: Number(e.target.value) })}
                className="w-full mt-2"
                style={{ accentColor: "var(--accent)" }}
              />
            </div>
            <div>
              <label className="label">Separator</label>
              <div className="flex gap-2">
                {["-", ".", "_", " "].map((sep) => (
                  <button
                    key={sep || "space"}
                    type="button"
                    className={`btn btn-sm ${ppOpts.separator === sep ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setPpOpts({ ...ppOpts, separator: sep })}
                  >
                    {sep === " " ? "space" : sep}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between text-sm cursor-pointer">
              <span>Capitalize words</span>
              <input
                type="checkbox"
                checked={ppOpts.capitalize}
                onChange={(e) => setPpOpts({ ...ppOpts, capitalize: e.target.checked })}
                style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
              />
            </label>
            <label className="flex items-center justify-between text-sm cursor-pointer">
              <span>Append number</span>
              <input
                type="checkbox"
                checked={ppOpts.includeNumber}
                onChange={(e) => setPpOpts({ ...ppOpts, includeNumber: e.target.checked })}
                style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
              />
            </label>
          </div>
        )}

        <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--faint)" }}>
          <Check size={13} className="mt-0.5 shrink-0" style={{ color: "var(--ok)" }} />
          Generated with your browser&rsquo;s CSPRNG (crypto.getRandomValues). Nothing is sent to the server.
        </p>
        <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--faint)" }}>
          <Sliders size={13} className="mt-0.5 shrink-0" />
          Tip: paste the result into a new Login item to save it encrypted.
        </p>
      </div>
    </div>
  );
}

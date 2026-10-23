import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { MinusIcon, PlusIcon } from "./icons";

// Briques de la page Réglages : un groupe de lignes « titre + description à gauche, contrôle à droite ».

export function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="group" aria-labelledby={id}>
      <h2 id={id} className="group-title">
        {title}
      </h2>
      <div className="rows">{children}</div>
    </section>
  );
}

export function Row({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="row">
      <div className="row-text">
        <div className="row-title">{title}</div>
        {description && <p className="row-desc">{description}</p>}
      </div>
      {children && <div className="row-control">{children}</div>}
    </div>
  );
}

/** Interrupteur : la ligne entière se touche. Affiche tout de suite le choix, le temps que le serveur confirme. */
export function ToggleRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  /** Renvoie true si le changement a été enregistré. */
  onChange: (next: boolean) => Promise<boolean>;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  // Le serveur a rattrapé le choix affiché.
  useEffect(() => setPending(null), [checked]);

  const change = async (next: boolean) => {
    if (pending !== null) return;
    setPending(next);
    if (!(await onChange(next))) setPending(null);
  };

  return (
    <label className="row row-toggle">
      <span className="row-text">
        <span className="row-title">{title}</span>
        <span className="row-desc">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={pending ?? checked}
        disabled={disabled}
        aria-busy={pending !== null}
        onChange={(e) => void change(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

const COMMIT_DELAY_MS = 500;

/** Nombre réglable par − / +, ou saisi. Enregistré peu après la dernière modification, sans bouton. */
export function StepperRow({
  title,
  description,
  value,
  min,
  max,
  step = 1,
  unit,
  onCommit,
}: {
  title: string;
  description: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** Renvoie true si la valeur a été enregistrée ; sinon l'affichage revient à la valeur du serveur. */
  onCommit: (next: number) => Promise<boolean>;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setDraft(String(value)), [value]);

  const current = draft.trim() !== "" && Number.isFinite(Number(draft)) ? Number(draft) : value;

  const commit = (raw: number) => {
    const next = Math.min(max, Math.max(min, Math.round(raw)));
    setDraft(String(next));
    window.clearTimeout(timer.current);
    if (next === value) return;
    timer.current = window.setTimeout(async () => {
      if (!(await onCommit(next))) setDraft(String(value));
    }, COMMIT_DELAY_MS);
  };

  return (
    <div className="row">
      <div className="row-text">
        <label className="row-title" htmlFor={id}>
          {title}
        </label>
        <p className="row-desc">{description}</p>
      </div>
      <div className="row-control stepper">
        <button type="button" aria-label={`Diminuer : ${title}`} disabled={current <= min} onClick={() => commit(current - step)}>
          <MinusIcon />
        </button>
        <span className={`stepper-value ${unit ? "has-unit" : ""}`}>
          <input
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commit(current)}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          {unit && <span aria-hidden="true">{unit}</span>}
        </span>
        <button type="button" aria-label={`Augmenter : ${title}`} disabled={current >= max} onClick={() => commit(current + step)}>
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

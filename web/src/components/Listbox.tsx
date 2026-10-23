import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "./icons";

export type ListboxOption = { value: string; label: string };

/**
 * Liste déroulante accessible, à la place du <select> natif :
 * bouton déclencheur, liste `role="listbox"`, flèches, Début/Fin, Entrée/Espace, Échap et saisie de la première lettre.
 */
export function Listbox({
  label,
  value,
  options,
  placeholder = "Choisir",
  disabled,
  onChange,
  onOpen,
  className,
}: {
  label: string;
  value: string | null;
  options: ListboxOption[];
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onOpen?: () => void;
  className?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const typed = useRef({ text: "", timer: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const current = selectedIndex >= 0 ? options[selectedIndex] : null;

  const openList = () => {
    if (disabled) return;
    onOpen?.();
    setActive(Math.max(selectedIndex, 0));
    setOpen(true);
  };

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close(true);
  };

  // Le focus passe sur la liste à l'ouverture, pour que le clavier la pilote.
  useEffect(() => {
    if (open) list.current?.focus();
  }, [open]);

  // Garde l'option active visible.
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openList();
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, last));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          window.clearTimeout(typed.current.timer);
          typed.current.text += e.key.toLowerCase();
          typed.current.timer = window.setTimeout(() => (typed.current.text = ""), 600);
          const from = typed.current.text.length === 1 ? active + 1 : active;
          const ordered = options.map((_, n) => (from + n) % options.length);
          const hit = ordered.find((i) => options[i]?.label.toLowerCase().startsWith(typed.current.text));
          if (hit !== undefined) setActive(hit);
        }
    }
  };

  return (
    <div className={`field ${className ?? ""}`} ref={root}>
      <span id={`${id}-label`}>{label}</span>
      <div className="listbox">
        <button
          ref={trigger}
          type="button"
          className="listbox-trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label ${id}-value`}
          disabled={disabled}
          onClick={() => (open ? close(false) : openList())}
          onKeyDown={onTriggerKey}
        >
          <span id={`${id}-value`} className={current ? "listbox-value" : "listbox-value muted"}>
            {current?.label ?? placeholder}
          </span>
          <ChevronDownIcon />
        </button>
        {open && (
          <ul
            ref={list}
            className="listbox-list"
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            aria-activedescendant={options[active] ? `${id}-opt-${active}` : undefined}
            onKeyDown={onListKey}
          >
            {options.length === 0 && <li className="listbox-empty muted">Aucun choix</li>}
            {options.map((o, i) => (
              <li
                key={o.value}
                id={`${id}-opt-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === selectedIndex}
                className={`listbox-option ${i === active ? "is-active" : ""}`}
                onPointerMove={() => setActive(i)}
                onClick={() => choose(i)}
              >
                <span>{o.label}</span>
                {i === selectedIndex && <CheckIcon size={16} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

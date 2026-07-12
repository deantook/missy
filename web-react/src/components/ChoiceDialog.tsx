import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  buildFormChoiceMessage,
  buildSelectionChoiceMessage,
  type ChoiceFormValues,
} from "../lib/choice-dialog-message.ts";
import type { ChoiceField, ChoicePrompt } from "../lib/choice-prompt.ts";
import styles from "./ChoiceDialog.module.css";

type ChoiceDialogProps = {
  prompt: ChoicePrompt;
  onSubmit: (message: string) => void;
  onDismiss: () => void;
};

function toggleSet(source: Set<number>, index: number): Set<number> {
  const next = new Set(source);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

function formValueComplete(field: ChoiceField, value: string | string[] | undefined): boolean {
  if (!field.required) return true;
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

export function ChoiceDialog({ prompt, onSubmit, onDismiss }: ChoiceDialogProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [other, setOther] = useState("");
  const [formValues, setFormValues] = useState<ChoiceFormValues>({});
  const formRef = useRef<HTMLFormElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    setSelected(new Set());
    setOther("");
    setFormValues({});
  }, [prompt]);

  const selectedLabels = useMemo(
    () => Array.from(selected).map((index) => prompt.options[index]?.label).filter(Boolean),
    [prompt.options, selected],
  );
  const formComplete = prompt.fields.every((field) => formValueComplete(field, formValues[field.id]));
  const selectionComplete = selectedLabels.length > 0 || Boolean(other.trim());
  const submitDisabled = prompt.mode === "form" ? !formComplete : !selectionComplete;

  const setFieldValue = (field: ChoiceField, value: string | string[]) => {
    setFormValues((items) => ({ ...items, [field.id]: value }));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled) return;
    if (prompt.mode === "form") {
      if (!formRef.current?.reportValidity()) return;
      onSubmit(buildFormChoiceMessage(prompt.fields, formValues));
      return;
    }
    onSubmit(buildSelectionChoiceMessage(selectedLabels, other));
  };

  return (
    <div className={styles.backdrop}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="choice-dialog-title">
        <div className={styles.header}>
          <div>
            <span>帮我确认一下</span>
            <h3 id="choice-dialog-title">{prompt.question}</h3>
          </div>
          <button ref={closeRef} type="button" className={styles.close} aria-label="关闭，改为手动输入" onClick={onDismiss}>
            x
          </button>
        </div>
        <form ref={formRef} onSubmit={submit}>
          {prompt.mode === "form" ? (
            <div className={styles.fields}>
              {prompt.fields.map((field) => (
                <ChoiceFieldInput
                  key={field.id}
                  field={field}
                  value={formValues[field.id]}
                  onChange={(value) => setFieldValue(field, value)}
                />
              ))}
            </div>
          ) : (
            <div className={styles.options}>
              {prompt.options.map((option, index) => (
                <label key={option.label} className={styles.option}>
                  <input
                    type={prompt.mode === "single" ? "radio" : "checkbox"}
                    checked={selected.has(index)}
                    onChange={() => {
                      setSelected((items) => (prompt.mode === "single" ? new Set([index]) : toggleSet(items, index)));
                    }}
                  />
                  <span className={styles.control} aria-hidden="true" />
                  <span>
                    <strong>{option.label}</strong>
                    {option.description ? <small>{option.description}</small> : null}
                  </span>
                </label>
              ))}
            </div>
          )}
          {prompt.allowOther ? (
            <label className={styles.other}>
              <span>其他（可选）</span>
              <input value={other} maxLength={240} placeholder="补充你的情况..." onChange={(event) => setOther(event.target.value)} />
            </label>
          ) : null}
          <div className={styles.actions}>
            <button type="button" className={styles.skip} onClick={onDismiss}>
              我自己输入
            </button>
            <button type="submit" className={styles.primary} disabled={submitDisabled}>
              {prompt.submitLabel}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ChoiceFieldInput({
  field,
  value,
  onChange,
}: {
  field: ChoiceField;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  if (field.type === "single" || field.type === "multiple") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className={styles.field}>
        <legend>
          {field.label}
          {field.required ? " *" : ""}
        </legend>
        <div className={styles.fieldOptions}>
          {field.options?.map((option) => (
            <label key={option.label}>
              <input
                type={field.type === "single" ? "radio" : "checkbox"}
                checked={selected.includes(option.label)}
                onChange={() => {
                  onChange(field.type === "single" ? [option.label] : selected.includes(option.label) ? selected.filter((item) => item !== option.label) : [...selected, option.label]);
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <label className={`${styles.field} ${styles.inputField}`}>
      <span>
        {field.label}
        {field.required ? " *" : ""}
      </span>
      <span className={styles.inputWrap}>
        <input
          type={field.type}
          required={field.required}
          min={field.min}
          max={field.max}
          value={typeof value === "string" ? value : ""}
          maxLength={240}
          placeholder={field.placeholder ?? "请输入"}
          onChange={(event) => onChange(event.target.value)}
        />
        {field.unit ? <b>{field.unit}</b> : null}
      </span>
    </label>
  );
}

import { Input } from "antd";
import type { AnswerItem, OptionItem } from "../types";
import {
  answersHaveContent,
  buildAnswerLayout,
  compactAnswers,
  slotToText,
  textToSlot,
  type AnswerSlotKind,
} from "../utils/answerSlots";

interface Props {
  value?: AnswerItem[];
  onChange?: (value: AnswerItem[]) => void;
  typeName?: string | null;
  stem?: string | null;
  options?: OptionItem[] | null;
}

function writeSlot(list: AnswerItem[], index: number, text: string, kind: AnswerSlotKind): AnswerItem[] {
  const next = list.slice();
  while (next.length <= index) next.push(null);
  next[index] = textToSlot(text, kind);
  return next;
}

export default function AnswerSlotsInput({ value, onChange, typeName, stem, options }: Props) {
  const answers = Array.isArray(value) ? value : [];
  const baseline = buildAnswerLayout({ typeName, stem, options, answers: [] });
  const layout = buildAnswerLayout({ typeName, stem, options, answers });
  const minCount = Math.max(baseline.slots.length, 1);
  const count = Math.max(layout.slots.length, answers.length, minCount);

  function slotAt(index: number) {
    return layout.slots[index] || layout.slots[layout.slots.length - 1] || {
      kind: "short" as const,
      label: `第 ${index + 1} 格`,
      rows: 2,
      placeholder: "正确答案",
    };
  }

  return (
    <div className="entry-answer-slots">
      {Array.from({ length: count }, (_, index) => {
        const spec = slotAt(index);
        const writing = spec.kind === "writing";
        return (
          <label key={`answer-slot-${index}`} className={`entry-answer-slot${writing ? " is-write" : ""}`}>
            <span className="entry-answer-slot-head">
              <span>{spec.label}</span>
              {count > minCount && index === count - 1 ? (
                <button
                  type="button"
                  className="list-action is-danger"
                  onClick={() => {
                    const next = answers.slice(0, index);
                    onChange?.(compactAnswers(next));
                  }}
                >
                  删除
                </button>
              ) : null}
            </span>
            {spec.rows <= 1 ? (
              <Input
                placeholder={spec.placeholder}
                value={slotToText(answers[index])}
                onChange={(event) => onChange?.(writeSlot(answers, index, event.target.value, spec.kind))}
                autoComplete="off"
              />
            ) : (
              <Input.TextArea
                rows={spec.rows}
                placeholder={spec.placeholder}
                value={slotToText(answers[index])}
                onChange={(event) => onChange?.(writeSlot(answers, index, event.target.value, spec.kind))}
              />
            )}
          </label>
        );
      })}
      {layout.allowAdd ? (
        <button
          type="button"
          className="list-action"
          onClick={() => {
            const next = answers.slice();
            while (next.length < count) next.push(null);
            next.push(null);
            onChange?.(next);
          }}
        >
          {layout.addLabel}
        </button>
      ) : null}
    </div>
  );
}

export function answerSlotsRequired(_: unknown, value: AnswerItem[] | undefined) {
  if (answersHaveContent(value)) return Promise.resolve();
  return Promise.reject(new Error("请填写正确答案"));
}

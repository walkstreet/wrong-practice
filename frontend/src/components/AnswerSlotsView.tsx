import type { AnswerItem, OptionItem } from "../types";
import { buildAnswerLayout, formatAnswerSlot, hasAnswerContent } from "../utils/answerSlots";

interface Props {
  answers?: AnswerItem[] | null;
  typeName?: string | null;
  stem?: string | null;
  options?: OptionItem[] | null;
}

export default function AnswerSlotsView({ answers, typeName, stem, options }: Props) {
  const list = answers || [];
  const layout = buildAnswerLayout({ typeName, stem, options, answers: list });
  const count = Math.max(layout.slots.length, list.length);
  if (!count || !list.some(hasAnswerContent)) {
    return <span className="entry-view-muted">未填</span>;
  }

  if (count === 1 && layout.slots[0]?.kind !== "writing") {
    return <div className="entry-view-answer-text">{formatAnswerSlot(list[0], options, 0)}</div>;
  }

  return (
    <div className="entry-view-answers">
      {Array.from({ length: count }, (_, index) => {
        const spec = layout.slots[index] || layout.slots[layout.slots.length - 1];
        const writing = spec?.kind === "writing";
        const text = formatAnswerSlot(list[index], options, index);
        return (
          <div key={`view-answer-${index}`} className={`entry-view-answer${writing ? " is-write" : ""}`}>
            <div className="entry-view-answer-kicker">{spec?.label || `第 ${index + 1} 格`}</div>
            <div className="entry-view-answer-text">{text}</div>
          </div>
        );
      })}
    </div>
  );
}

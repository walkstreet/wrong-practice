import { QuestionCircleOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { useNavigate } from "react-router-dom";
import { DIFFICULTY_HELP_PATH, DIFFICULTY_TOOLTIP } from "../utils/difficulty";

export default function DifficultyHint() {
  const navigate = useNavigate();
  return (
    <Tooltip title={DIFFICULTY_TOOLTIP}>
      <button
        type="button"
        className="help-hint"
        aria-label="查看难度等级说明"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          navigate(DIFFICULTY_HELP_PATH);
        }}
      >
        <QuestionCircleOutlined />
      </button>
    </Tooltip>
  );
}

export function DifficultyFieldLabel({ text = "难度" }: { text?: string }) {
  return (
    <span className="help-field-label">
      {text}
      <DifficultyHint />
    </span>
  );
}

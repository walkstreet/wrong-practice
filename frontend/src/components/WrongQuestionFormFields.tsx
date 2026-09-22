import { useState } from "react";
import { Col, Form, Input, Row, Select } from "antd";
import AnswerSlotsInput, { answerSlotsRequired } from "./AnswerSlotsInput";
import { DifficultyFieldLabel } from "./DifficultyHint";
import type { KnowledgeTag, QuestionType } from "../types";
import { DIFFICULTY_SELECT_OPTIONS } from "../utils/difficulty";
import { buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { linesToOptions } from "../utils/optionLines";
import { buildQuestionTypeSelectOptions, isTaskReadingType } from "../utils/questionTypes";
import { buildAnswerLayout, hidesOptionsField } from "../utils/answerSlots";

export default function WrongQuestionFormFields({
  questionTypes,
  knowledgeTags,
  suggestingTags,
  onSuggest,
}: {
  questionTypes: QuestionType[];
  knowledgeTags: KnowledgeTag[];
  suggestingTags: boolean;
  onSuggest: () => void;
}) {
  const [showMore, setShowMore] = useState(true);
  const questionTypeId = Form.useWatch("question_type_id");
  const stem = Form.useWatch("stem") as string | undefined;
  const optionsLines = Form.useWatch("options_lines") as string | undefined;
  const questionTypeName = questionTypes.find((item) => item.id === questionTypeId)?.name;
  const taskReading = isTaskReadingType(questionTypeName);
  const hideOptions = hidesOptionsField(questionTypeName);
  const options = linesToOptions(optionsLines);
  const answerLayout = buildAnswerLayout({ typeName: questionTypeName, stem, options });

  return (
    <>
      <p className="entry-hint">
        {taskReading
          ? "任务型阅读保存为一题：题干含短文 + Task 1 全部问题 + Task 2 续写要求。答案按问分格填写，最后一格写续写范文或要点。"
          : hideOptions
            ? "本题无选项。答案按空或按句分格填写，同一空多种说法用 | 分隔。"
            : "选项每行一组，组内用 | 分隔。答案按小题分格填写。"}
      </p>
      <Form.Item name="stem" label="题干" rules={[{ required: true, message: "请填写题干" }]}>
        <Input.TextArea
          rows={taskReading ? 10 : 6}
          placeholder={
            taskReading
              ? "短文全文\n\nTask 1: Answer the questions.\n1. ...\n2. ...\n\nTask 2:\n6. Write a short continuation (30-50 words)..."
              : "题干全文"
          }
        />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} md={8}>
          <Form.Item name="question_type_id" label="题型" rules={[{ required: true, message: "请选择题型" }]}>
            <Select
              placeholder="按大类选择题型"
              showSearch
              optionFilterProp="label"
              options={buildQuestionTypeSelectOptions(questionTypes)}
            />
          </Form.Item>
        </Col>
        <Col xs={24} md={16}>
          <Form.Item
            name="knowledge_tag_ids"
            label={
              <span>
                知识点{" "}
                <button
                  type="button"
                  className="list-action"
                  disabled={suggestingTags}
                  onClick={(event) => {
                    event.preventDefault();
                    onSuggest();
                  }}
                >
                  {suggestingTags ? "推荐中…" : "AI 推荐"}
                </button>
              </span>
            }
            rules={[{ required: true, message: "请至少选择一个知识点" }]}
            validateTrigger="onSubmit"
          >
            <Select
              mode="multiple"
              placeholder="可点 AI 推荐或手动选择"
              showSearch
              optionFilterProp="label"
              maxTagCount="responsive"
              allowClear
              options={buildKnowledgeTagSelectOptions(knowledgeTags)}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item
        name="options_lines"
        label="选项"
        extra={hideOptions ? "本题无选项，请留空" : "每行一组；多组用 | 分隔，可选"}
        hidden={hideOptions}
      >
        <Input.TextArea
          rows={5}
          placeholder={"单组：\nA. xxx\nB. xxx\n\n多组：\nA. yes | B. no | C. maybe"}
        />
      </Form.Item>
      <Form.Item
        name="correct_answer"
        label="正确答案"
        rules={[{ validator: answerSlotsRequired }]}
        extra={answerLayout.extra}
      >
        <AnswerSlotsInput typeName={questionTypeName} stem={stem} options={options} />
      </Form.Item>
      <button type="button" className="entry-more" onClick={() => setShowMore((open) => !open)}>
        {showMore ? "收起更多信息" : "更多信息"}
      </button>
      <div hidden={!showMore}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item name="review_status" label="复习状态" rules={[{ required: true, message: "请选择状态" }]}>
              <Select
                options={[
                  { label: "未复习", value: "not_reviewed" },
                  { label: "已复习", value: "reviewed" },
                  { label: "已掌握", value: "mastered" },
                ]}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="difficulty" label={<DifficultyFieldLabel text="难度（1–5）" />}>
              <Select allowClear placeholder="未评级" options={DIFFICULTY_SELECT_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="source" label="题目来源">
          <Input placeholder="如：期中试卷·2024" />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={3} placeholder="解析、错因记录等（可选）" />
        </Form.Item>
      </div>
    </>
  );
}

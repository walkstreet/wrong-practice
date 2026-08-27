import { useState } from "react";
import { Col, DatePicker, Form, Input, Row, Select } from "antd";
import { DifficultyFieldLabel } from "./DifficultyHint";
import type { KnowledgeTag, QuestionType } from "../types";
import { DIFFICULTY_SELECT_OPTIONS } from "../utils/difficulty";
import { buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

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

  return (
    <>
      <p className="entry-hint">选项每行一组，组内用 | 分隔。答案每行对应一个空位；无选项题型可留空选项。</p>
      <Form.Item name="stem" label="题干" rules={[{ required: true, message: "请填写题干" }]}>
        <Input.TextArea rows={6} placeholder="题干全文" />
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
      <Form.Item name="options_lines" label="选项" extra="每行一组；多组用 | 分隔，可选">
        <Input.TextArea
          rows={5}
          placeholder={"单组：\nA. xxx\nB. xxx\n\n多组：\nA. yes | B. no | C. maybe"}
        />
      </Form.Item>
      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Form.Item
            name="correct_answer_lines"
            label="正确答案"
            rules={[{ required: true, message: "请填写正确答案" }]}
          >
            <Input.TextArea rows={3} placeholder="每行一项，如 A 或完整选项文字" />
          </Form.Item>
        </Col>
        <Col xs={24} md={12}>
          <Form.Item
            name="wrong_answer_lines"
            label="学生错答"
            rules={[{ required: true, message: "请填写学生错答" }]}
          >
            <Input.TextArea rows={3} placeholder="须与正确答案不同" />
          </Form.Item>
        </Col>
      </Row>
      <button type="button" className="entry-more" onClick={() => setShowMore((open) => !open)}>
        {showMore ? "收起更多信息" : "更多信息"}
      </button>
      <div hidden={!showMore}>
        <Row gutter={16}>
          <Col xs={24} md={8}>
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
          <Col xs={24} md={8}>
            <Form.Item name="difficulty" label={<DifficultyFieldLabel text="难度（1–5）" />}>
              <Select allowClear placeholder="未评级" options={DIFFICULTY_SELECT_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="wrong_at" label="做错时间">
              <DatePicker showTime style={{ width: "100%" }} format="YYYY-MM-DD HH:mm" placeholder="选择时间" />
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

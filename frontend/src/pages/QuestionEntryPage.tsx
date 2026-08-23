import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  DatePicker,
  Form,
  Image,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Tabs,
  Typography,
  Upload,
  message,
} from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { Dayjs } from "dayjs";
import axios from "axios";
import {
  aiExtractWrongQuestions,
  confirmAiExtract,
  createWrongQuestion,
  listKnowledgeTags,
  listQuestionTypes,
  resolveMediaUrl,
  suggestKnowledgeTags,
  type AiExtractDraftItem,
} from "../api";
import type { KnowledgeTag, QuestionType, ReviewStatus } from "../types";
import { buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { linesToAnswers, linesToOptions, listToLines } from "../utils/optionLines";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

function joinWarnings(warnings?: string[] | string | null): string {
  if (!warnings) return "";
  if (typeof warnings === "string") return warnings.trim();
  return warnings.filter((w) => typeof w === "string" && w.trim()).join("；");
}

function getApiErrorMessage(error: unknown): string | null {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return "登录已失效，请重新登录后再导入";
    if (error.response?.status === 403) return "权限不足";
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    if (Array.isArray(detail) && detail.length) {
      try {
        return JSON.stringify(detail);
      } catch {
        return "请求校验失败";
      }
    }
  }
  return null;
}

interface FormValues {
  stem: string;
  options_lines: string;
  correct_answer_lines: string;
  wrong_answer_lines: string;
  question_type_id: number;
  knowledge_tag_ids: number[];
  difficulty?: number | null;
  source?: string;
  note?: string;
  review_status: ReviewStatus;
  wrong_at?: Dayjs | null;
}

function ManualEntryForm({
  questionTypes,
  knowledgeTags,
}: {
  questionTypes: QuestionType[];
  knowledgeTags: KnowledgeTag[];
}) {
  const [form] = Form.useForm<FormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [suggestingTags, setSuggestingTags] = useState(false);

  async function onSuggestKnowledgeTags() {
    const stem = String(form.getFieldValue("stem") || "").trim();
    if (!stem) {
      message.warning("请先填写题干，再让 AI 推荐知识点");
      return;
    }
    const questionTypeId = form.getFieldValue("question_type_id") as number | undefined;
    const questionTypeName = questionTypes.find((t) => t.id === questionTypeId)?.name || null;
    setSuggestingTags(true);
    try {
      const result = await suggestKnowledgeTags({
        stem,
        options: linesToOptions(form.getFieldValue("options_lines")),
        correct_answer: linesToAnswers(form.getFieldValue("correct_answer_lines")),
        wrong_answer: linesToAnswers(form.getFieldValue("wrong_answer_lines")),
        question_type_name: questionTypeName,
        note: form.getFieldValue("note") || null,
      });
      if (!result.knowledge_tag_ids.length) {
        message.warning(joinWarnings(result.warnings) || "未能推荐知识点，请手动选择");
        return;
      }
      form.setFieldsValue({ knowledge_tag_ids: result.knowledge_tag_ids });
      const names = result.items.map((item) => item.name).join("、");
      message.success(`已推荐：${names}`);
      if (result.warnings?.length) {
        message.info(joinWarnings(result.warnings));
      }
    } catch (error) {
      message.error(getApiErrorMessage(error) || "知识点推荐失败");
    } finally {
      setSuggestingTags(false);
    }
  }

  async function onFinish(values: FormValues) {
    const options = linesToOptions(values.options_lines);
    const correct_answer = linesToAnswers(values.correct_answer_lines);
    const wrong_answer = linesToAnswers(values.wrong_answer_lines);

    setSubmitting(true);
    try {
      const created = await createWrongQuestion({
        stem: values.stem.trim(),
        options,
        correct_answer,
        wrong_answer,
        question_type_id: values.question_type_id,
        knowledge_tag_ids: values.knowledge_tag_ids,
        difficulty: values.difficulty ?? null,
        source: values.source?.trim() || null,
        note: values.note?.trim() || null,
        review_status: values.review_status,
        wrong_at: values.wrong_at ? values.wrong_at.toISOString() : null,
      });
      message.success(`保存成功，题目 ID ${created.id}`);
      form.resetFields();
      form.setFieldsValue({ review_status: "not_reviewed", knowledge_tag_ids: [] });
    } catch (error) {
      message.error(getApiErrorMessage(error) || "提交失败，请检查必填项");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Typography.Paragraph type="secondary">
        选项支持多组：每行一组，组内用 | 分隔。答案每行对应一个空位/小题；无选项题型可留空选项区。
      </Typography.Paragraph>
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={{
          review_status: "not_reviewed" as ReviewStatus,
          knowledge_tag_ids: [],
        }}
        onFinish={onFinish}
      >
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
                <Space size={8}>
                  <span>知识点</span>
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto" }}
                    loading={suggestingTags}
                    onClick={(e) => {
                      e.preventDefault();
                      onSuggestKnowledgeTags();
                    }}
                  >
                    AI 推荐
                  </Button>
                </Space>
              }
              rules={[{ required: true, message: "请至少选择一个知识点" }]}
              validateTrigger="onSubmit"
            >
              <Select
                mode="multiple"
                placeholder="留空，可点 AI 推荐或手动选择"
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
          label="选项（每行一组；多组用 | 分隔，可选）"
        >
          <Input.TextArea
            rows={5}
            placeholder={"单组：\nA. xxx\nB. xxx\n\n多组：\nA. yes | B. no | C. maybe\nA. is | B. are | C. was"}
          />
        </Form.Item>
        <Form.Item
          name="correct_answer_lines"
          label="正确答案（每行一项）"
          rules={[{ required: true, message: "请填写正确答案" }]}
        >
          <Input.TextArea rows={3} placeholder="单项可只填一行，如 A 或完整选项文字" />
        </Form.Item>
        <Form.Item
          name="wrong_answer_lines"
          label="学生错答（每行一项）"
          rules={[{ required: true, message: "请填写学生错答" }]}
        >
          <Input.TextArea rows={3} placeholder="须与正确答案不同（如错选项 D）" />
        </Form.Item>
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
            <Form.Item name="difficulty" label="难度（1–5）">
              <InputNumber min={1} max={5} placeholder="可选" style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="wrong_at" label="做错时间">
              <DatePicker showTime style={{ width: "100%" }} format="YYYY-MM-DD HH:mm" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="source" label="题目来源">
          <Input placeholder="如：期中试卷·2024" />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={3} placeholder="解析、错因记录等（可选）" />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={submitting}>
              提交保存
            </Button>
            <Button
              htmlType="button"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({ review_status: "not_reviewed", knowledge_tag_ids: [] });
              }}
            >
              清空表单
            </Button>
          </Space>
        </Form.Item>
      </Form>
    </>
  );
}

function AiImportPanel({
  questionTypes,
  knowledgeTags,
}: {
  questionTypes: QuestionType[];
  knowledgeTags: KnowledgeTag[];
}) {
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [items, setItems] = useState<AiExtractDraftItem[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [rawText, setRawText] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [suggestingLocalId, setSuggestingLocalId] = useState<string | null>(null);

  useEffect(() => {
    // 清掉历史 session 草稿，刷新后不再恢复
    sessionStorage.removeItem("wq_ai_import_draft");
  }, []);

  function clearDraftState() {
    setDraftId(null);
    setItems([]);
    setImageUrls([]);
    setRawText(null);
    setModel(null);
    setFileList([]);
  }

  function updateItem(localId: string, patch: Partial<AiExtractDraftItem>) {
    setItems((prev) => prev.map((item) => (item.local_id === localId ? { ...item, ...patch } : item)));
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((item) => item.local_id !== localId));
  }

  async function onSuggestItemTags(item: AiExtractDraftItem) {
    if (!item.stem.trim()) {
      message.warning("请先填写题干");
      return;
    }
    setSuggestingLocalId(item.local_id);
    try {
      const questionTypeName =
        questionTypes.find((t) => t.id === item.question_type_id)?.name || item.question_type_name || null;
      const result = await suggestKnowledgeTags({
        stem: item.stem,
        options: item.options,
        correct_answer: item.correct_answer,
        wrong_answer: item.wrong_answer,
        question_type_name: questionTypeName,
        note: item.note || null,
      });
      if (!result.knowledge_tag_ids.length) {
        message.warning(joinWarnings(result.warnings) || "未能推荐知识点，请手动选择");
        return;
      }
      updateItem(item.local_id, { knowledge_tag_ids: result.knowledge_tag_ids });
      message.success(`已推荐：${result.items.map((x) => x.name).join("、")}`);
      if (result.warnings?.length) {
        message.info(joinWarnings(result.warnings));
      }
    } catch (error) {
      message.error(getApiErrorMessage(error) || "知识点推荐失败");
    } finally {
      setSuggestingLocalId(null);
    }
  }

  async function onExtract() {
    const files = fileList
      .map((f) => f.originFileObj)
      .filter((f): f is NonNullable<typeof f> => f instanceof File);
    if (!files.length) {
      message.warning("请先选择图片");
      return;
    }
    setExtracting(true);
    try {
      const result = await aiExtractWrongQuestions(files);
      setDraftId(result.draft_id);
      setItems(result.items.map((item) => ({ ...item, selected: item.selected !== false, knowledge_tag_ids: [] })));
      setImageUrls(result.image_urls || []);
      setRawText(result.raw_text || null);
      setModel(result.model || null);
      message.success(`识别完成，共 ${result.items.length} 题，请人工核对后确认导入`);
    } catch (error) {
      message.error(getApiErrorMessage(error) || "AI 识别失败");
    } finally {
      setExtracting(false);
    }
  }

  async function onConfirm() {
    if (!draftId) {
      message.warning("请先完成识别");
      return;
    }
    const selected = items.filter((item) => item.selected !== false);
    if (!selected.length) {
      message.warning("请至少勾选一道题");
      return;
    }
    setConfirming(true);
    try {
      const result = await confirmAiExtract(draftId, items);
      message.success(`已导入 ${result.imported_count} 题：${result.ids.join(", ")}`);
      clearDraftState();
    } catch (error) {
      message.error(getApiErrorMessage(error) || "确认导入失败");
    } finally {
      setConfirming(false);
    }
  }

  const selectedCount = items.filter((item) => item.selected !== false).length;

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Upload
        listType="picture-card"
        fileList={fileList}
        beforeUpload={() => false}
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        maxCount={5}
        onChange={({ fileList: next }) => setFileList(next)}
      >
        {fileList.length >= 5 ? null : "上传图片"}
      </Upload>

      <Space>
        <Button type="primary" loading={extracting} onClick={onExtract} disabled={!fileList.length}>
          开始识别
        </Button>
        {draftId ? (
          <Typography.Text type="secondary">
            草稿 {draftId.slice(0, 8)}…{model ? ` · ${model}` : ""}
          </Typography.Text>
        ) : null}
      </Space>

      {imageUrls.length > 0 ? (
        <Card size="small" title="原图对照">
          <Image.PreviewGroup>
            <Space wrap>
              {imageUrls.map((url) => (
                <Image key={url} src={resolveMediaUrl(url)} width={120} style={{ objectFit: "cover" }} />
              ))}
            </Space>
          </Image.PreviewGroup>
        </Card>
      ) : null}

      {rawText ? (
        <Collapse
          items={[
            {
              key: "raw",
              label: "OCR 原文（可展开对照）",
              children: (
                <Typography.Paragraph style={{ whiteSpace: "pre-wrap", marginBottom: 0 }}>
                  {rawText}
                </Typography.Paragraph>
              ),
            },
          ]}
        />
      ) : null}

      {items.length > 0 ? (
        <>
          <Alert
            type="info"
            showIcon
            message={`识别出 ${items.length} 题，已勾选 ${selectedCount} 题。请核对题干、答案、题型与知识点后再导入。`}
          />
          {items.map((item, index) => {
            const needsAttention =
              !item.question_type_id || (item.warnings && item.warnings.length > 0);
            return (
              <Card
                key={item.local_id}
                size="small"
                title={
                  <Space>
                    <Checkbox
                      checked={item.selected !== false}
                      onChange={(e) => updateItem(item.local_id, { selected: e.target.checked })}
                    />
                    <span>第 {index + 1} 题</span>
                    {item.confidence != null ? (
                      <Typography.Text type="secondary">
                        置信度 {(item.confidence * 100).toFixed(0)}%
                      </Typography.Text>
                    ) : null}
                  </Space>
                }
                extra={
                  <Button type="link" danger onClick={() => removeItem(item.local_id)}>
                    删除
                  </Button>
                }
                style={needsAttention ? { borderColor: "#faad14" } : undefined}
              >
                {item.warnings && item.warnings.length > 0 ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={joinWarnings(item.warnings)}
                  />
                ) : null}
                <Form layout="vertical" size="small">
                  <Form.Item label="题干" required>
                    <Input.TextArea
                      rows={4}
                      value={item.stem}
                      onChange={(e) => updateItem(item.local_id, { stem: e.target.value })}
                    />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item label="题型" required>
                        <Select
                          placeholder="按大类选择题型"
                          showSearch
                          optionFilterProp="label"
                          value={item.question_type_id ?? undefined}
                          options={buildQuestionTypeSelectOptions(questionTypes)}
                          onChange={(value) => updateItem(item.local_id, { question_type_id: value })}
                          status={!item.question_type_id ? "warning" : undefined}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={16}>
                      <Form.Item
                        label={
                          <Space size={8}>
                            <span>知识点</span>
                            <Button
                              type="link"
                              size="small"
                              style={{ padding: 0, height: "auto" }}
                              loading={suggestingLocalId === item.local_id}
                              onClick={() => onSuggestItemTags(item)}
                            >
                              AI 推荐
                            </Button>
                          </Space>
                        }
                        required
                      >
                        <Select
                          mode="multiple"
                          placeholder="留空，可点 AI 推荐或手动选择"
                          showSearch
                          optionFilterProp="label"
                          maxTagCount="responsive"
                          value={item.knowledge_tag_ids || []}
                          options={buildKnowledgeTagSelectOptions(knowledgeTags)}
                          onChange={(value) => updateItem(item.local_id, { knowledge_tag_ids: value })}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item label="选项（每行一组；多组可用 | 分隔）">
                    <Input.TextArea
                      rows={4}
                      value={listToLines(item.options)}
                      onChange={(e) =>
                        updateItem(item.local_id, {
                          options: linesToOptions(e.target.value),
                        })
                      }
                    />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col xs={24} md={12}>
                      <Form.Item label="正确答案（每行一项）" required>
                        <Input.TextArea
                          rows={3}
                          value={listToLines(item.correct_answer)}
                          onChange={(e) =>
                            updateItem(item.local_id, { correct_answer: linesToAnswers(e.target.value) })
                          }
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="学生错答（每行一项）" required>
                        <Input.TextArea
                          rows={3}
                          value={listToLines(item.wrong_answer)}
                          onChange={(e) =>
                            updateItem(item.local_id, { wrong_answer: linesToAnswers(e.target.value) })
                          }
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col xs={24} md={8}>
                      <Form.Item label="难度">
                        <InputNumber
                          min={1}
                          max={5}
                          style={{ width: "100%" }}
                          value={item.difficulty ?? undefined}
                          onChange={(value) => updateItem(item.local_id, { difficulty: value })}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={16}>
                      <Form.Item label="来源">
                        <Input
                          value={item.source ?? ""}
                          onChange={(e) => updateItem(item.local_id, { source: e.target.value || null })}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item label="备注">
                    <Input.TextArea
                      rows={2}
                      value={item.note ?? ""}
                      onChange={(e) => updateItem(item.local_id, { note: e.target.value || null })}
                    />
                  </Form.Item>
                </Form>
              </Card>
            );
          })}
          <Button type="primary" loading={confirming} onClick={onConfirm} disabled={selectedCount === 0}>
            确认导入已选 {selectedCount} 题
          </Button>
        </>
      ) : null}
    </Space>
  );
}

export default function QuestionEntryPage() {
  const [questionTypes, setQuestionTypes] = useState<QuestionType[]>([]);
  const [knowledgeTags, setKnowledgeTags] = useState<KnowledgeTag[]>([]);

  useEffect(() => {
    Promise.all([listQuestionTypes(), listKnowledgeTags()])
      .then(([types, tags]) => {
        setQuestionTypes(types);
        setKnowledgeTags(tags);
      })
      .catch(() => message.error("加载题型与知识点失败"));
  }, []);

  return (
    <Card>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        录入题目
      </Typography.Title>
      <Tabs
        defaultActiveKey="ai"
        items={[
          {
            key: "ai",
            label: "AI 导入",
            children: <AiImportPanel questionTypes={questionTypes} knowledgeTags={knowledgeTags} />,
          },
          {
            key: "manual",
            label: "手动录入",
            children: <ManualEntryForm questionTypes={questionTypes} knowledgeTags={knowledgeTags} />,
          },
        ]}
      />
    </Card>
  );
}

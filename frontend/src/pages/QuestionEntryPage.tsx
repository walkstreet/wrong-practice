import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CloudUploadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Checkbox,
  Col,
  ConfigProvider,
  Form,
  Image,
  Input,
  Popconfirm,
  Row,
  Select,
  message,
} from "antd";
import type { Dayjs } from "dayjs";
import axios from "axios";
import { useNavigate } from "react-router-dom";
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
import { DifficultyFieldLabel } from "../components/DifficultyHint";
import WrongQuestionFormFields from "../components/WrongQuestionFormFields";
import { INGEST_SOURCE_LABELS } from "../utils/labels";
import { DIFFICULTY_SELECT_OPTIONS, difficultyLabel } from "../utils/difficulty";
import { buildKnowledgeTagSelectOptions } from "../utils/knowledgeTags";
import { linesToAnswers, linesToOptions, listToLines } from "../utils/optionLines";
import { buildQuestionTypeSelectOptions } from "../utils/questionTypes";

const ENTRY_THEME = {
  token: {
    colorPrimary: "#7c5cfc",
    colorBorder: "#e4dcf4",
    colorPrimaryHover: "#6b4ef0",
    borderRadius: 10,
    controlHeight: 36,
  },
};

const MAX_IMAGES = 5;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";
const CONFIDENCE_REVIEW_BELOW = 0.75;

type EntryMode = "ocr" | "manual";

type PickedImage = { id: string; file: File };

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

function isImageFile(file: File) {
  return file.type.startsWith("image/");
}

function previewLines(value: unknown, empty = "未填") {
  const text = listToLines(value).replace(/\n/g, " · ").trim();
  return text || empty;
}

function itemNeedsAttention(item: AiExtractDraftItem) {
  const lowConfidence = item.confidence != null && item.confidence < CONFIDENCE_REVIEW_BELOW;
  return (
    !item.question_type_id ||
    !item.knowledge_tag_ids?.length ||
    Boolean(item.warnings?.length) ||
    lowConfidence
  );
}

function makeImageId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(16).slice(2)}`;
}

function SavedToast({ text, to }: { text: string; to: string }) {
  const navigate = useNavigate();
  return (
    <span className="entry-toast">
      {text}
      <button type="button" className="list-action" onClick={() => navigate(to)}>
        去查看
      </button>
    </span>
  );
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
      message.success({
        content: <SavedToast text={`保存成功，题目 #${created.id}`} to={`/wrong-questions?id=${created.id}`} />,
        duration: 6,
      });
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
      <div className="entry-body">
        <Form<FormValues>
          form={form}
          layout="vertical"
          initialValues={{
            review_status: "not_reviewed" as ReviewStatus,
            knowledge_tag_ids: [],
          }}
          onFinish={onFinish}
        >
          <WrongQuestionFormFields
            questionTypes={questionTypes}
            knowledgeTags={knowledgeTags}
            suggestingTags={suggestingTags}
            onSuggest={() => {
              onSuggestKnowledgeTags().catch(() => undefined);
            }}
          />
        </Form>
      </div>
      <div className="entry-bar">
        <div className="entry-bar-meta">新题默认未复习，可在更多信息里改。</div>
        <div className="entry-bar-actions">
          <Button
            onClick={() => {
              form.resetFields();
              form.setFieldsValue({ review_status: "not_reviewed", knowledge_tag_ids: [] });
            }}
          >
            清空表单
          </Button>
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            提交保存
          </Button>
        </div>
      </div>
    </>
  );
}

function AiImportPanel({
  active,
  questionTypes,
  knowledgeTags,
}: {
  active: boolean;
  questionTypes: QuestionType[];
  knowledgeTags: KnowledgeTag[];
}) {
  const [files, setFiles] = useState<PickedImage[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [items, setItems] = useState<AiExtractDraftItem[]>([]);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [rawText, setRawText] = useState<string | null>(null);
  const [suggestingLocalId, setSuggestingLocalId] = useState<string | null>(null);
  const [suggestingAll, setSuggestingAll] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const tagMap = useMemo(() => new Map(knowledgeTags.map((tag) => [tag.id, tag.name])), [knowledgeTags]);
  const typeMap = useMemo(() => new Map(questionTypes.map((item) => [item.id, item.name])), [questionTypes]);

  const previews = useMemo(
    () => files.map((item) => ({ id: item.id, url: URL.createObjectURL(item.file) })),
    [files],
  );

  useEffect(() => {
    return () => {
      previews.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [previews]);

  useEffect(() => {
    sessionStorage.removeItem("wq_ai_import_draft");
  }, []);

  const addFiles = useCallback((incoming: File[]) => {
    const images = incoming.filter(isImageFile);
    if (!images.length) {
      message.warning("请选择图片（JPG / PNG / WebP / GIF）");
      return;
    }
    const room = MAX_IMAGES - filesRef.current.length;
    if (room <= 0) {
      message.warning(`最多上传 ${MAX_IMAGES} 张`);
      return;
    }
    if (images.length > room) {
      message.warning(`最多 ${MAX_IMAGES} 张，已加入 ${room} 张`);
    }
    setFiles((prev) => [
      ...prev,
      ...images.slice(0, MAX_IMAGES - prev.length).map((file) => ({ id: makeImageId(file), file })),
    ]);
  }, []);

  useEffect(() => {
    if (!active || items.length > 0) return;
    function onPaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) {
        return;
      }
      const pasted = event.clipboardData?.files;
      if (!pasted?.length) return;
      const images = Array.from(pasted).filter(isImageFile);
      if (!images.length) return;
      event.preventDefault();
      addFiles(images);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [active, items.length, addFiles]);

  function clearDraftState() {
    setDraftId(null);
    setItems([]);
    setImageUrls([]);
    setRawText(null);
    setExpandedIds(new Set());
    setShowRaw(false);
  }

  function resetAll() {
    clearDraftState();
    setFiles([]);
  }

  function updateItem(localId: string, patch: Partial<AiExtractDraftItem>) {
    setItems((prev) => prev.map((item) => (item.local_id === localId ? { ...item, ...patch } : item)));
  }

  function removeItem(localId: string) {
    setItems((prev) => prev.filter((item) => item.local_id !== localId));
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.delete(localId);
      return next;
    });
  }

  function toggleExpanded(localId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(localId)) next.delete(localId);
      else next.add(localId);
      return next;
    });
  }

  async function suggestForItem(item: AiExtractDraftItem, silent = false) {
    if (!item.stem.trim()) {
      if (!silent) message.warning("请先填写题干");
      return null;
    }
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
    return result;
  }

  async function onSuggestItemTags(item: AiExtractDraftItem) {
    setSuggestingLocalId(item.local_id);
    try {
      const result = await suggestForItem(item);
      if (!result) return;
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

  async function applySuggestions(targets: AiExtractDraftItem[], overwrite: boolean, quiet = false) {
    const pending = targets.filter((item) => item.stem.trim() && (overwrite || !item.knowledge_tag_ids?.length));
    if (!pending.length) {
      if (!quiet) message.info("没有需要推荐的题目");
      return;
    }
    setSuggestingAll(true);
    try {
      const results = await Promise.allSettled(
        pending.map(async (item) => {
          const result = await suggestForItem(item, true);
          return { localId: item.local_id, result };
        }),
      );
      const byId = new Map<string, number[]>();
      let filled = 0;
      for (const entry of results) {
        if (entry.status !== "fulfilled" || !entry.value.result?.knowledge_tag_ids.length) continue;
        byId.set(entry.value.localId, entry.value.result.knowledge_tag_ids);
        filled += 1;
      }
      if (!filled) {
        if (!quiet) message.warning("未能推荐知识点，请手动选择");
        return;
      }
      setItems((prev) =>
        prev.map((item) => {
          const ids = byId.get(item.local_id);
          if (!ids) return item;
          if (!overwrite && item.knowledge_tag_ids?.length) return item;
          return { ...item, knowledge_tag_ids: ids };
        }),
      );
      message.success(`已为 ${filled} 题填入知识点`);
    } finally {
      setSuggestingAll(false);
    }
  }

  async function onExtract() {
    if (!files.length) {
      message.warning("请先选择图片");
      return;
    }
    setExtracting(true);
    try {
      const result = await aiExtractWrongQuestions(files.map((item) => item.file));
      const nextItems = result.items.map((item) => ({
        ...item,
        selected: item.selected !== false,
        knowledge_tag_ids: item.knowledge_tag_ids || [],
      }));
      setDraftId(result.draft_id);
      setItems(nextItems);
      setImageUrls(result.image_urls || []);
      setRawText(result.raw_text || null);
      setExpandedIds(new Set(nextItems.filter(itemNeedsAttention).map((item) => item.local_id)));
      if (!nextItems.length) {
        message.warning("没有识别到题目，请换一张更清晰的图");
        return;
      }
      message.success(`识别完成，共 ${nextItems.length} 题，请核对后导入`);
      void applySuggestions(nextItems, false, true);
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
    const incomplete = selected.filter((item) => !item.question_type_id || !item.knowledge_tag_ids?.length);
    if (incomplete.length) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        incomplete.forEach((item) => next.add(item.local_id));
        return next;
      });
      message.warning(`还有 ${incomplete.length} 题缺少题型或知识点`);
      return;
    }
    setConfirming(true);
    try {
      const result = await confirmAiExtract(draftId, items);
      const to = result.ids.length === 1 ? `/wrong-questions?id=${result.ids[0]}` : "/wrong-questions";
      message.success({
        content: <SavedToast text={`已导入 ${result.imported_count} 题`} to={to} />,
        duration: 6,
      });
      resetAll();
    } catch (error) {
      message.error(getApiErrorMessage(error) || "确认导入失败");
    } finally {
      setConfirming(false);
    }
  }

  const selectedCount = items.filter((item) => item.selected !== false).length;
  const reviewing = items.length > 0;
  const mediaUrls = imageUrls.length ? imageUrls.map(resolveMediaUrl) : previews.map((item) => item.url);

  function renderItemForm(item: AiExtractDraftItem) {
    return (
      <Form layout="vertical" size="small" className="entry-qcard-form">
        <Form.Item label="题干" required>
          <Input.TextArea rows={4} value={item.stem} onChange={(e) => updateItem(item.local_id, { stem: e.target.value })} />
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
                <span>
                  知识点{" "}
                  <button
                    type="button"
                    className="list-action"
                    disabled={suggestingLocalId === item.local_id || suggestingAll}
                    onClick={() => {
                      onSuggestItemTags(item).catch(() => undefined);
                    }}
                  >
                    {suggestingLocalId === item.local_id ? "推荐中…" : "AI 推荐"}
                  </button>
                </span>
              }
              required
            >
              <Select
                mode="multiple"
                placeholder="可点 AI 推荐或手动选择"
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
        <Form.Item label="选项" extra="每行一组；多组可用 | 分隔">
          <Input.TextArea
            rows={4}
            value={listToLines(item.options)}
            onChange={(e) => updateItem(item.local_id, { options: linesToOptions(e.target.value) })}
          />
        </Form.Item>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="正确答案" required>
              <Input.TextArea
                rows={3}
                value={listToLines(item.correct_answer)}
                onChange={(e) => updateItem(item.local_id, { correct_answer: linesToAnswers(e.target.value) })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="学生错答" required>
              <Input.TextArea
                rows={3}
                value={listToLines(item.wrong_answer)}
                onChange={(e) => updateItem(item.local_id, { wrong_answer: linesToAnswers(e.target.value) })}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item label={<DifficultyFieldLabel />}>
              <Select
                allowClear
                placeholder="未评级"
                options={DIFFICULTY_SELECT_OPTIONS}
                value={item.difficulty ?? undefined}
                onChange={(value) => updateItem(item.local_id, { difficulty: value ?? null })}
              />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item label="来源">
              <Input value={item.source ?? ""} onChange={(e) => updateItem(item.local_id, { source: e.target.value || null })} />
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
    );
  }

  if (!reviewing) {
    return (
      <div className="entry-body">
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            addFiles(Array.from(event.target.files || []));
            event.target.value = "";
          }}
        />
        <div
          className={`entry-drop${dragOver ? " is-over" : ""}${extracting ? " is-busy" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <span className="entry-drop-icon">
            <CloudUploadOutlined />
          </span>
          <div className="entry-drop-title">{extracting ? "正在识别题目…" : "拖入、点选或粘贴题目截图"}</div>
          <div className="entry-drop-sub">支持 JPG / PNG / WebP / GIF，最多 {MAX_IMAGES} 张</div>
        </div>
        {previews.length ? (
          <div className="entry-thumbs">
            {previews.map((item) => (
              <div key={item.id} className="entry-thumb">
                <img src={item.url} alt="" />
                <button
                  type="button"
                  className="entry-thumb-remove"
                  aria-label="移除图片"
                  onClick={() => setFiles((prev) => prev.filter((file) => file.id !== item.id))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="entry-upload-actions">
          <Button type="primary" loading={extracting} onClick={() => onExtract().catch(() => undefined)} disabled={!files.length}>
            开始识别
          </Button>
          {files.length ? (
            <button type="button" className="list-action" onClick={() => setFiles([])}>
              清空图片
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="entry-body">
        <div className="entry-review">
          <aside className="entry-review-media">
            <div className="entry-review-kicker">原图对照</div>
            {mediaUrls.length ? (
              <Image.PreviewGroup>
                <div className="entry-review-images">
                  {mediaUrls.map((url) => (
                    <Image key={url} src={url} alt="题目原图" />
                  ))}
                </div>
              </Image.PreviewGroup>
            ) : (
              <div className="entry-empty">无原图</div>
            )}
            {rawText ? (
              <div className="entry-raw">
                <button type="button" className="list-action" onClick={() => setShowRaw((open) => !open)}>
                  {showRaw ? "收起识别原文" : "查看识别原文"}
                </button>
                {showRaw ? <pre>{rawText}</pre> : null}
              </div>
            ) : null}
          </aside>

          <div className="entry-review-list">
            {suggestingAll ? <Alert type="info" showIcon message="正在为题目推荐知识点…" /> : null}
            {items.map((item, index) => {
              const warn = itemNeedsAttention(item);
              const expanded = expandedIds.has(item.local_id);
              const typeName = (item.question_type_id && typeMap.get(item.question_type_id)) || item.question_type_name || "未分题型";
              const tags = (item.knowledge_tag_ids || []).map((id) => tagMap.get(id)).filter(Boolean) as string[];
              return (
                <article key={item.local_id} className={`entry-qcard${warn ? " is-warn" : ""}`}>
                  <div className="entry-qcard-head">
                    <Checkbox
                      checked={item.selected !== false}
                      onChange={(event) => updateItem(item.local_id, { selected: event.target.checked })}
                    />
                    <span className="entry-qcard-title">第 {index + 1} 题</span>
                    {warn ? <span className="list-status is-not_reviewed">建议核对</span> : null}
                    <div className="entry-qcard-tools">
                      <button type="button" className="list-action" onClick={() => toggleExpanded(item.local_id)}>
                        {expanded ? "收起" : "展开编辑"}
                      </button>
                      <Popconfirm title="从本次识别中移除这道题？" okText="移除" cancelText="取消" onConfirm={() => removeItem(item.local_id)}>
                        <button type="button" className="list-action is-danger">
                          移除
                        </button>
                      </Popconfirm>
                    </div>
                  </div>
                  {item.warnings?.length ? <div className="entry-qcard-warn">{joinWarnings(item.warnings)}</div> : null}
                  {expanded ? (
                    renderItemForm(item)
                  ) : (
                    <div
                      className="entry-qcard-summary"
                      onClick={() => toggleExpanded(item.local_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleExpanded(item.local_id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="entry-qcard-stem">{item.stem || "（无题干）"}</div>
                      <div className="entry-qcard-pair">
                        <span>
                          正确 <strong>{previewLines(item.correct_answer)}</strong>
                        </span>
                        <span>
                          错答 <strong>{previewLines(item.wrong_answer)}</strong>
                        </span>
                      </div>
                      <div className="entry-qcard-meta">
                        <span className="list-chip is-muted">{typeName}</span>
                        {item.difficulty != null ? (
                          <span className="list-chip is-muted">{difficultyLabel(item.difficulty)}</span>
                        ) : null}
                        {tags.length ? (
                          tags.slice(0, 3).map((name) => (
                            <span key={name} className="list-chip">
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="list-chip is-muted">未选知识点</span>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
      <div className="entry-bar">
        <div className="entry-bar-meta">
          <Checkbox
            checked={selectedCount === items.length && items.length > 0}
            indeterminate={selectedCount > 0 && selectedCount < items.length}
            onChange={(event) =>
              setItems((prev) => prev.map((item) => ({ ...item, selected: event.target.checked })))
            }
          >
            已选 <strong>{selectedCount}</strong> / {items.length} 题
          </Checkbox>
        </div>
        <div className="entry-bar-actions">
          <button type="button" className="list-action" onClick={clearDraftState}>
            重新识别
          </button>
          <Button
            loading={suggestingAll}
            onClick={() => applySuggestions(items, true).catch(() => undefined)}
            disabled={!items.length}
          >
            全部推荐知识点
          </Button>
          <Button type="primary" loading={confirming} onClick={() => onConfirm().catch(() => undefined)} disabled={selectedCount === 0}>
            确认导入已选 {selectedCount} 题
          </Button>
        </div>
      </div>
    </>
  );
}

export default function QuestionEntryPage() {
  const [mode, setMode] = useState<EntryMode>("ocr");
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
    <ConfigProvider theme={ENTRY_THEME}>
      <div className="entry-panel">
        <div className="entry-head">
          <div className="list-filter-pills" role="radiogroup" aria-label="录入方式">
            {(["ocr", "manual"] as const).map((key) => {
              const active = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`list-filter-pill${active ? " is-active" : ""}`}
                  onClick={() => setMode(key)}
                >
                  {INGEST_SOURCE_LABELS[key]}
                </button>
              );
            })}
          </div>
        </div>
        <div hidden={mode !== "ocr"}>
          <AiImportPanel active={mode === "ocr"} questionTypes={questionTypes} knowledgeTags={knowledgeTags} />
        </div>
        <div hidden={mode !== "manual"}>
          <ManualEntryForm questionTypes={questionTypes} knowledgeTags={knowledgeTags} />
        </div>
      </div>
    </ConfigProvider>
  );
}

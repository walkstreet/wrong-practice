import { useEffect, useState } from "react";
import { Typography } from "antd";
import type { SentenceAnalysis, SentenceComponent, SentenceSegment, SentenceToken } from "../types";

const { Paragraph, Text } = Typography;

const ROLE_COLORS: Record<string, string> = {
  subject: "#4A90D9",
  predicate: "#E85D4C",
  object: "#50B86A",
  attributive: "#9B6FD4",
  adverbial: "#F5A623",
  complement: "#2EC4B6",
};

const POS_SHORT: Record<string, string> = {
  noun: "名",
  verb: "动",
  adjective: "形",
  adverb: "副",
  pronoun: "代",
  preposition: "介",
  conjunction: "连",
  determiner: "限",
  article: "冠",
  numeral: "数",
};

function roleColor(role: string): string | null {
  if (role === "neutral" || !role) return null;
  return ROLE_COLORS[role] || "#8c8c8c";
}

function posShort(token: SentenceToken): string | null {
  const label = token.pos_label?.trim();
  if (label) {
    if (label.length <= 2) return label;
    if (label.includes("形")) return "形";
    if (label.includes("副")) return "副";
    if (label.includes("名")) return "名";
    if (label.includes("动")) return "动";
    if (label.includes("代")) return "代";
    if (label.includes("介")) return "介";
    if (label.includes("连")) return "连";
    if (label.includes("限") || label.includes("冠")) return "限";
    return label.slice(0, 1);
  }
  const pos = token.pos?.trim();
  if (!pos) return null;
  return POS_SHORT[pos] || pos.slice(0, 1).toUpperCase();
}

function flattenHighlights(analysis: SentenceAnalysis): SentenceSegment[] {
  if (analysis.highlights?.length) return analysis.highlights;
  if (!analysis.clauses?.length) return [];
  const items: SentenceSegment[] = [];
  for (const clause of analysis.clauses) {
    clause.segments.forEach((segment, idx) => {
      if (idx > 0 && items.length > 0) {
        const prev = items[items.length - 1].text;
        const next = segment.text;
        if (prev && next && !/\s$/.test(prev) && !/^\s/.test(next)) {
          items.push({ text: " ", role: "neutral", role_label: "" });
        }
      }
      items.push(segment);
    });
  }
  return items;
}

function isClauseComponent(component: SentenceComponent): boolean {
  if (component.is_clause) return true;
  return (component.role_label || "").includes("从句");
}

function mergeClauseComponents(components: SentenceComponent[]): SentenceComponent[] {
  const merged: SentenceComponent[] = [];
  let buffer: SentenceComponent | null = null;

  const flush = () => {
    if (!buffer) return;
    buffer.is_clause = true;
    if (buffer.role_label && !buffer.role_label.includes("从句")) {
      buffer.role_label = `${buffer.role_label}从句`;
    } else if (!buffer.role_label) {
      buffer.role_label = "从句";
    }
    merged.push(buffer);
    buffer = null;
  };

  for (const comp of components) {
    if (buffer) {
      if (comp.role === "neutral" || isClauseComponent(comp)) {
        buffer.tokens.push(...comp.tokens);
        if (isClauseComponent(comp)) {
          buffer.is_clause = true;
          if (comp.role_label?.includes("从句")) buffer.role_label = comp.role_label;
        }
        continue;
      }
      flush();
    }

    if (isClauseComponent(comp)) {
      buffer = {
        ...comp,
        is_clause: true,
        tokens: [...comp.tokens],
      };
      continue;
    }

    merged.push(comp);
  }

  flush();
  return merged;
}

function highlightsToComponents(highlights: SentenceSegment[]): SentenceComponent[] {
  const components: SentenceComponent[] = [];
  let index = 0;

  while (index < highlights.length) {
    const current = highlights[index];
    if (current.role === "neutral") {
      components.push({ role: "neutral", role_label: "", tokens: [{ text: current.text }] });
      index += 1;
      continue;
    }

    if (current.is_clause) {
      const clauseItems: SentenceSegment[] = [];
      while (index < highlights.length) {
        const item = highlights[index];
        if (item.is_clause) {
          clauseItems.push(item);
          index += 1;
          continue;
        }
        if (item.role === "neutral") {
          let nextIdx = index + 1;
          while (nextIdx < highlights.length && highlights[nextIdx].role === "neutral") nextIdx += 1;
          if (nextIdx < highlights.length && highlights[nextIdx].is_clause) {
            clauseItems.push(item);
            index += 1;
            continue;
          }
          break;
        }
        break;
      }
      const roleLabel =
        clauseItems.find((item) => item.role_label?.includes("从句"))?.role_label ||
        (clauseItems.some((item) => item.role === "adverbial") ? "状语从句" : "定语从句");
      components.push({
        role: clauseItems.find((item) => item.role === "adverbial") ? "adverbial" : "attributive",
        role_label: roleLabel,
        is_clause: true,
        tokens: clauseItems.map((item) => ({
          text: item.text,
          pos: item.pos,
          pos_label: item.pos_label,
          inner_role: item.role === "attributive" || item.role === "adverbial" ? item.role : undefined,
          inner_role_label: item.role === "attributive" || item.role === "adverbial" ? item.role_label : undefined,
          is_head: item.is_head,
        })),
      });
      continue;
    }

    const groupId = current.group_id;
    const groupItems: SentenceSegment[] = [];
    while (index < highlights.length && highlights[index].role !== "neutral") {
      const item = highlights[index];
      if (groupId) {
        if (item.group_id !== groupId) break;
      } else if (groupItems.length > 0 && item.role !== current.role && !item.group_id) {
        break;
      } else if (groupItems.length > 0 && item.group_id) {
        break;
      }
      groupItems.push(item);
      index += 1;
    }

    if (groupId && groupItems.length > 1) {
      const head = groupItems.find((item) => item.is_head) || groupItems.find((item) => item.role !== "attributive" && item.role !== "adverbial") || groupItems[0];
      components.push({
        role: head.role,
        role_label: head.role_label,
        is_clause: groupItems.some((item) => item.is_clause),
        tokens: groupItems.map((item) => ({
          text: item.text,
          pos: item.pos,
          pos_label: item.pos_label,
          inner_role: item.role !== head.role && (item.role === "attributive" || item.role === "adverbial") ? item.role : undefined,
          inner_role_label: item.role !== head.role ? item.role_label : undefined,
          is_head: item.is_head,
        })),
      });
      continue;
    }

    for (const item of groupItems) {
      components.push({
        role: item.role,
        role_label: item.role_label,
        is_clause: item.is_clause,
        tokens: [
          {
            text: item.text,
            pos: item.pos,
            pos_label: item.pos_label,
            is_head: item.is_head,
          },
        ],
      });
    }
  }

  return mergeClauseComponents(components);
}

function resolveComponents(analysis: SentenceAnalysis): SentenceComponent[] {
  if (analysis.components?.length) return mergeClauseComponents(analysis.components);
  const highlights = flattenHighlights(analysis);
  return highlightsToComponents(highlights);
}

function InnerToken({ token, parentColor }: { token: SentenceToken; parentColor: string }) {
  const [hovered, setHovered] = useState(false);
  const pos = posShort(token);
  const innerColor = token.inner_role ? roleColor(token.inner_role) : null;
  const isPlain = !pos && !token.inner_role_label;

  if (isPlain) {
    return <span style={{ whiteSpace: "pre" }}>{token.text}</span>;
  }

  const tooltipParts: string[] = [];
  if (token.inner_role_label) tooltipParts.push(token.inner_role_label);
  if (token.pos_label) tooltipParts.push(token.pos_label);
  if (token.is_head) tooltipParts.push("中心词");

  return (
    <span
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        verticalAlign: "bottom",
        margin: "0 1px",
        position: "relative",
        cursor: tooltipParts.length ? "help" : "default",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && tooltipParts.length ? (
        <span
          style={{
            position: "absolute",
            bottom: "100%",
            left: "50%",
            transform: "translateX(-50%)",
            marginBottom: 4,
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 11,
            color: "#fff",
            background: innerColor || parentColor,
            whiteSpace: "nowrap",
            zIndex: 2,
          }}
        >
          {tooltipParts.join(" ｜ ")}
        </span>
      ) : null}
      <span
        style={{
          fontSize: 22,
          fontWeight: token.is_head ? 600 : 500,
          lineHeight: 1.3,
          padding: "0 2px",
          borderRadius: 3,
          background: innerColor ? `${innerColor}35` : `${parentColor}25`,
        }}
      >
        {token.text}
      </span>
      {pos ? (
        <span style={{ fontSize: 10, lineHeight: 1.2, color: "#666", marginTop: 2 }}>{pos}</span>
      ) : (
        <span style={{ height: 12 }} />
      )}
    </span>
  );
}

function ComponentBlock({ component }: { component: SentenceComponent }) {
  const isClause = isClauseComponent(component);
  const color = roleColor(component.role);

  if (!color) {
    return (
      <span style={{ fontSize: 22, whiteSpace: "pre" }}>
        {component.tokens.map((token, idx) => (
          <span key={`${idx}-${token.text}`}>{token.text}</span>
        ))}
      </span>
    );
  }

  return (
    <div
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        border: `2px ${isClause ? "dashed" : "solid"} ${color}`,
        borderRadius: 10,
        background: isClause ? `${color}22` : `${color}12`,
        boxShadow: isClause ? `0 0 0 2px ${color}18` : undefined,
        padding: isClause ? "8px 12px 10px" : "6px 10px 8px",
        margin: "0 2px",
      }}
    >
      <span
        style={{
          fontSize: isClause ? 12 : 11,
          fontWeight: 700,
          color,
          marginBottom: 4,
          whiteSpace: "nowrap",
          padding: isClause ? "2px 8px" : undefined,
          borderRadius: isClause ? 6 : undefined,
          background: isClause ? `${color}20` : undefined,
        }}
      >
        {component.role_label}
        {isClause && !component.role_label.includes("从句") ? " · 从句" : ""}
      </span>
      <div style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "center" }}>
        {component.tokens.map((token, idx) => (
          <InnerToken key={`${idx}-${token.text}`} token={token} parentColor={color} />
        ))}
      </div>
    </div>
  );
}

interface Props {
  analysis: SentenceAnalysis;
  analyses?: SentenceAnalysis[];
}

export default function SentenceAnalysisView({ analysis, analyses }: Props) {
  const list =
    analyses && analyses.length > 0 ? analyses : analysis ? [analysis] : [];
  const listKey = list.map((item) => item.target_sentence).join("\u0001");
  const [active, setActive] = useState(0);
  useEffect(() => {
    setActive(0);
  }, [listKey]);
  const current = list[Math.min(active, Math.max(list.length - 1, 0))] || analysis;
  const components = resolveComponents(current);
  const multi = list.length > 1;

  return (
    <div>
      {multi ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {list.map((item, index) => {
            const label = item.focus?.trim() || `第 ${index + 1} 句`;
            const selected = index === active;
            return (
              <button
                key={`${label}-${index}`}
                type="button"
                onClick={() => setActive(index)}
                style={{
                  border: selected ? "1px solid #1677ff" : "1px solid #d9d9d9",
                  background: selected ? "#e6f4ff" : "#fff",
                  color: selected ? "#1677ff" : "#595959",
                  borderRadius: 6,
                  padding: "4px 10px",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}

      <Paragraph type="secondary" style={{ marginBottom: 8 }}>
        {current.summary}
      </Paragraph>
      {multi ? (
        <Paragraph style={{ marginBottom: 12 }}>
          <Text type="secondary">分析句：</Text>
          {current.target_sentence}
        </Paragraph>
      ) : null}

      <div
        style={{
          padding: "18px 16px",
          borderRadius: 10,
          background: "#fafafa",
          border: "1px solid #f0f0f0",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "flex-end",
          gap: 4,
          lineHeight: 1.6,
        }}
      >
        {components.map((component, index) => (
          <ComponentBlock key={`${component.role}-${index}`} component={component} />
        ))}
      </div>

      <div style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 8 }}>
          外框 = 第一层句子成分；虚线框 = 从句整体；框内下方 = 词性
          {multi ? "。长文题仅标注含考查点的句子，非整段材料。" : ""}
        </Text>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          {Object.entries(ROLE_COLORS).map(([role, color]) => (
            <span key={role} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: `${color}30`,
                  border: `2px solid ${color}`,
                }}
              />
              {role === "subject" && "主语"}
              {role === "predicate" && "谓语"}
              {role === "object" && "宾语"}
              {role === "attributive" && "定语"}
              {role === "adverbial" && "状语"}
              {role === "complement" && "补语"}
            </span>
          ))}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.entries(POS_SHORT).map(([pos, short]) => (
            <span key={pos} style={{ fontSize: 12, color: "#595959" }}>
              <span style={{ fontWeight: 700, marginRight: 4 }}>{short}</span>
              {pos === "noun" && "名词"}
              {pos === "verb" && "动词"}
              {pos === "adjective" && "形容词"}
              {pos === "adverb" && "副词"}
              {pos === "pronoun" && "代词"}
              {pos === "preposition" && "介词"}
              {pos === "conjunction" && "连词"}
              {pos === "determiner" && "限定词"}
              {pos === "numeral" && "数词"}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

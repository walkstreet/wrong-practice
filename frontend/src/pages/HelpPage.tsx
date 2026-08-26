import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";
import { DIFFICULTY_LEVELS, DIFFICULTY_METHOD_STEPS } from "../utils/difficulty";

export default function HelpPage() {
  const { hash } = useLocation();

  useLayoutEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    const el = id ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ block: "start" });
      return;
    }
    window.scrollTo(0, 0);
  }, [hash]);

  return (
    <div className="help-page" id="difficulty">
      <div className="account-page-head">
        <h1>帮助中心</h1>
      </div>
      <div className="account-panel help-panel">
        <article className="help-article">
          <h2>难度等级 1–5</h2>
          <p className="help-lead">
            难度衡量的是<strong>题目本身</strong>对目标学段英语学习者的认知负担，不是这道题有没有被做错。识别录入会按同一套口径给出建议值，仍可人工改。
          </p>
          <h3>怎么评</h3>
          <ol className="help-steps">
            {DIFFICULTY_METHOD_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <h3>五个等级</h3>
          <div className="help-table-wrap">
            <table className="help-table">
              <thead>
                <tr>
                  <th>等级</th>
                  <th>判断依据</th>
                  <th>典型例子</th>
                </tr>
              </thead>
              <tbody>
                {DIFFICULTY_LEVELS.map((level) => (
                  <tr key={level.value}>
                    <td>
                      <strong>
                        {level.value} {level.name}
                      </strong>
                      <div className="help-muted">{level.summary}</div>
                    </td>
                    <td>{level.criteria}</td>
                    <td>{level.examples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>识别时怎么用</h3>
          <ul className="help-list">
            <li>AI 必须给出 1–5 的整数，拿不准时标 3，并在「建议核对」里说明是估计。</li>
            <li>卷面若已有星级、难易标记，先换算到本表，再按材料长度微调。</li>
            <li>核对页可以改档；改档时请对照上表，而不是按「我当时错了所以很难」。</li>
          </ul>
        </article>
      </div>
    </div>
  );
}

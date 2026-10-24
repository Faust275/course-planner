# OCR 课表识别基准

图片导入课表是这个项目里最脆弱的一环：识别错了，用户只能一格一格手改。这里放一组固定的
分例，用来守住「词 → 表格结构 → 课程列表」这一段的正确性，并在改动算法时立刻发现退化。

> 只测算法，不测模型。Tesseract 是外部依赖，改不动；能改、也最容易改坏的是后面这段——
> 表头剔除、按几何位置归格、连堂处理、词库纠偏、周次解析。

## 两种词表，两种用途

| 来源 | 命令 | 用途 | 会不会卡 CI |
|---|---|---|---|
| **理想词表** | `node tests/ocr-bench/run.mjs` | 假设「字都认对了」，专测结构还原。快（毫秒级）、结果稳定 | 会，和 `baseline.json` 比对 |
| **真机词表** | `node tests/ocr-bench/run.mjs --real` | 用真 Tesseract 录下来的结果，反映端到端真实水平 | 不会，只看趋势 |

分开的理由：真机分数会随模型版本、图片质量波动，拿来当门禁会天天误报；理想词表只受我们自己
的代码影响，掉分就一定是改坏了。

## 目录

```
tests/ocr-bench/
  layout.mjs            版面定义：case.json → 理想词表 / 期望课程列表（两者共用一套坐标）
  run.mjs               跑分，输出 P / R / F1，与 baseline.json 比对
  record.mjs            用真 Tesseract 录音，写 words.real.json
  baseline.json         理想分基线（门禁用）
  cases/<id>/
    case.json           课表内容（人类可读，手写即可）
    expected.json       可选的期望覆盖（默认取每格第一行当课程名）
    image.png           record.mjs 渲染出来的截图，方便肉眼比对
    words.real.json     record.mjs 录到的真实词表
```

## 常见操作

```bash
node tests/ocr-bench/run.mjs            # 跑分（理想词表，毫秒级）
node tests/ocr-bench/run.mjs -v         # 顺带打印漏了哪些、多了哪些
node tests/ocr-bench/run.mjs --real     # 用真机词表跑，看真实水平
node tests/ocr-bench/record.mjs         # 重新渲染 + 录音（需要联网下模型）
node tests/ocr-bench/record.mjs c01-clean-grid   # 只重录一个
```

### 加一个自己的真实截图

最想加的就是这个——合成图永远替代不了真实截图。三步：

1. 建目录 `cases/my-school/`，把截图存成 `image.png`。
2. 写 `case.json`，把图上真实的课表抄进去：

```json
{
  "id": "my-school",
  "title": "我学校的教务系统",
  "days": 7,
  "periods": 12,
  "cells": [
    { "day": 1, "period": 1, "lines": ["高等数学", "张伟", "教三201"] },
    { "day": 3, "period": 2, "lines": ["大学物理", "李娜", "教二105"] }
  ]
}
```

3. `node tests/ocr-bench/record.mjs my-school --from-image`

它会直接识别 `image.png`（不重新渲染），把词表写成 `words.real.json`。
之后 `run.mjs --real` 就会带上这个分例。

> 注意：`case.json` 里的 `lines` 第一行就是期望的课程名。如果图上班名和课程名写在同一行、
> 需要特殊处理，就在 `case.json` 里加 `expect` 数组显式指定：
> `"expect": [{ "day": 1, "period": 1, "name": "高等数学" }]`

## 指标怎么算

- 一条「课程」= `星期 + 第几节 + 课程名`，课程名归一化后（去空格标点）比对。
- `P`（精确率）= 认对的 / 认出来的；`R`（召回率）= 认对的 / 应该有的；`F1` 是两者的调和平均。
- 汇总用 micro-F1（把所有分例的命中数加起来再算），不按分例平均，避免小分例权重过大。

## 基线怎么维护

改了归格/纠偏这类算法后：

1. 先 `node tests/ocr-bench/run.mjs`，看有没有退化。
2. 如果分例的输出变化是**你想要的结果**，跑 `node tests/ocr-bench/run.mjs --update` 更新基线。
3. 如果分例本身写错了（期望值不对），改 `case.json`，再 `--update`。

`--real` 模式不允许 `--update`。真机分数只用来观察，不当门禁。

## 已知局限

- **c02（彩色块）和 c04（密集小字）的真机分数偏低**，主要是 Tesseract 对色块底、小字号中文
  识别本身不稳，不是结构还原的问题；理想词表下这几个分例都是满分。
- 真机词表只覆盖「Tesseract 认出来的那部分」。想看 OCR 整体水平，用 `--real` 的 F1，
  但别把它当成算法质量指标。
- 分例里的 `days`/`periods` 要和你写进 `case.json` 的格子对应，写错了会直接表现为整体偏移。

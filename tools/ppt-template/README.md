# ppt-template

文档生成工具集，支持 PPT、DOCX 等多种格式。

## 目录结构

```
ppt-template/
├── .agents/skills/           # AI Agent Skills
│   ├── docx/                # DOCX 文档生成技能
│   ├── slide/               # PPT 幻灯片技能
│   └── ...
├── src/                      # 源代码
├── dist/                     # 构建输出
├── requirements.txt          # Python 依赖
└── package.json              # Node.js 依赖
```

## 快速开始

### 安装依赖

```bash
# Python 依赖
pip install -r requirements.txt

# Node.js 依赖
npm install
```

### 系统依赖

| 依赖 | 用途 | 安装 (macOS) |
|------|------|--------------|
| LibreOffice | DOCX/PPT 转换 | `brew install libreoffice` |
| poppler | PDF 转图片 | `brew install poppler` |

## Skills

### DOCX Skill

位置: `.agents/skills/docx/`

功能：创建、编辑、渲染 DOCX 文档

```bash
# 渲染 DOCX 为 PNG
cd .agents/skills/docx
python render_docx.py input.docx --output_dir out
```

详细文档: [DOCX Skill README](.agents/skills/docx/README.md)

### Slide Skill

位置: `.agents/skills/slide/`

功能：PPT 幻灯片生成和模板

## 常见问题

### `pdfinfo not found`

```bash
brew unlink poppler && brew link poppler
```

详见: [DOCX Troubleshooting](.agents/skills/docx/troubleshooting/poppler_dependency.md)

### LibreOffice 转换失败

确保 LibreOffice 正确安装：

```bash
brew install libreoffice
soffice --version
```

## 开发

### 添加新的 Skill

在 `.agents/skills/` 下创建新目录，包含 `SKILL.md` 和相关脚本。

### 测试渲染

```bash
# 测试 DOCX 渲染
python .agents/skills/docx/render_docx.py test.docx --output_dir test_out
```

## 许可证

MIT

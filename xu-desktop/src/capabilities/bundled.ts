import type { CapabilityPackManifest } from "./types";

/** Demo packs shipped with the app — source copies live under capability-packs-src/ */
export const BUNDLED_CAPABILITY_PACKS: CapabilityPackManifest[] = [
  {
    id: "go-dev",
    name: "Go 开发",
    description: "Go module 布局、测试与常见工具链提示",
    version: "1.0.0",
    agentToolHints:
      "【Go 能力包】遵循标准 Go module 布局（cmd/、internal/、pkg/）。修改代码后优先 go test ./...；新增依赖用 go get；格式化用 gofmt/goimports。错误信息用中文解释根因。",
    fileExtensions: [".go", ".mod", ".sum"],
    officeTools: false,
    helpDoc: "capabilities/go-dev.md",
  },
  {
    id: "vue-dev",
    name: "Vue 开发",
    description: "Vue 3 + SFC + foucui 组件规范提示",
    version: "1.0.0",
    agentToolHints:
      "【Vue 能力包】使用 Vue 3 Composition API + <script setup>。UI 组件统一用 foucui（FouButton/FouDialog/FouInput 等）；所有按钮必须带 icon。样式用 scoped + CSS 变量，避免自研 fixed 遮罩弹窗。",
    fileExtensions: [".vue", ".ts", ".tsx"],
    officeTools: false,
    helpDoc: "capabilities/vue-dev.md",
  },
  {
    id: "office-plus",
    name: "Office 增强",
    description: "Word/Excel/PPT 写入工具说明与最佳实践",
    version: "1.0.0",
    agentToolHints:
      "【Office 能力包】写文档优先 office_write_* 工具：先规划结构再分段写入；表格用行列坐标；保留样式一致性。大文件分块写入，完成后提示用户在工作区查看。",
    fileExtensions: [".docx", ".xlsx", ".pptx"],
    officeTools: true,
    helpDoc: "capabilities/office-plus.md",
  },
];

export function getBundledPack(id: string): CapabilityPackManifest | undefined {
  return BUNDLED_CAPABILITY_PACKS.find((p) => p.id === id);
}

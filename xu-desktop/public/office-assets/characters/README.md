# 3D 真人员工资源说明

**不要用** `mixamo_xbot.glb` / `mixamo_soldier.glb` 当办公室员工：
它们是关节假人 / 装甲兵，看起来像「骨架」，不是真人。

## 正确做法（需你本机从 Mixamo 导出）

1. 打开 https://www.mixamo.com 登录（免费）
2. 选 **真人角色**（如 Remy、Michelle、Aj、James 等，带皮肤与衣服）
3. 下载角色（T-Pose，With Skin）
4. 再选动画 **Idle**、**Sitting** → Download（Without Skin）后合并进同一 GLB  
   或用 Blender / Mixamo2GLB 工具合并
5. 把 `.glb` 放到本目录，例如：
   - `remy.glb`
   - `michelle.glb`
6. 在 `src/office/assets/registry.ts` 的 `CHARACTER_ASSET_MAP` 登记路径
7. 再打开 `personMesh.ts` 里对 `tryMakeHumanCharacter` 的开关

许可：Adobe Mixamo 商用条款；勿用 NC / Editorial / BY-SA 资源。

当前办公室员工使用 **程序化小人**（可点、可坐），家具仍用 Poly Haven。

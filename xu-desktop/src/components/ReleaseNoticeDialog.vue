<script setup lang="ts">
/**
 * @file ReleaseNoticeDialog.vue 桌面端首发正式上线强制公告
 * @author qiuye <yjk150@qq.com>
 * @date 2026-09-04
 * @updated 2026-09-04
 * @version 1.1.0
 * @category UI
 * @algo none
 */
import { computed } from "vue";
import { FouButton, FouDialog } from "foucui";
import { RELEASE_NOTICE_STORAGE_KEY } from "../utils/releaseNotice";

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [boolean];
  acknowledged: [];
}>();

const visible = computed({
  get: () => props.modelValue,
  set: (v: boolean) => emit("update:modelValue", v),
});

function acknowledge() {
  try {
    localStorage.setItem(RELEASE_NOTICE_STORAGE_KEY, "1");
  } catch {
    /* 隐私模式等写失败仍关闭，避免卡死 */
  }
  visible.value = false;
  emit("acknowledged");
}
</script>

<template>
  <FouDialog
    v-model="visible"
    class="release-notice-dialog"
    title="虚募阁桌面端 · 发布说明"
    width="640px"
    append-to-body
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    :z-index="33000"
  >
    <div class="release-notice ui-font">
      <p class="greeting">亲爱的虚募阁用户：</p>
      <p>您好！</p>
      <p>
        非常荣幸能够与您相遇，感谢您选择虚募阁桌面端产品。历经打磨与筹备，我们终于完成产品首期版本的正式落地，每一次下载与打开，都是您给予我们的信任与支持，对此我们心怀赤诚、深表感恩。
      </p>
      <p>
        本次为产品首次全量上线，作为全新启航的首期版本，产品功能、页面展示、运行适配等各方面仍处于初步完善阶段。受限于开发周期与测试场景，当前版本不可避免会存在部分未知问题、页面展示错误、功能适配异常、内容疏漏等情况，无法做到尽善尽美，对此我们向您致以诚挚的歉意。
      </p>
      <p>
        产品的成长与完善，离不开每一位用户的陪伴与监督。若您在使用过程中，遇到卡顿闪退、功能失效、文字错误、样式错乱、适配异常等各类问题，恳请您通过侧栏<strong>问题反馈</strong>提交说明。
      </p>
      <p>
        为方便我们快速定位、高效修复问题，提升迭代效率，建议您在反馈时详细描述问题出现的场景、操作步骤，并附上对应的问题截图，我们的技术与运营团队会逐条查看、登记跟进，优先处理高频、核心问题，持续优化产品体验。
      </p>
      <p>
        虚募阁始终秉持用心打磨、真诚服务的初心，敬畏每一份用户信任。我们深知首期版本尚有诸多不足，但我们从未停止优化的脚步，后续会持续迭代更新、修复问题、完善功能、优化细节，全力为大家打造更稳定、更流畅、更优质的使用体验。
      </p>
      <p>
        再次感谢您的包容、理解与配合！您的每一次反馈，都是我们精进的最大动力。未来，虚募阁愿与各位用户并肩同行，稳步成长、不负期许！
      </p>
      <p class="sign">虚募阁运营团队<br />2026年09月04日</p>
    </div>
    <template #footer>
      <FouButton icon="checkbox-circle-line" type="primary" native-type="button" @click="acknowledge">
        我知道了
      </FouButton>
    </template>
  </FouDialog>
</template>

<style scoped>
.release-notice {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: min(58vh, 520px);
  overflow-y: auto;
  padding-right: 4px;
  line-height: 1.75;
  color: var(--fou-text-color-regular, #475467);
  font-size: 14px;
  text-align: justify;
}
.release-notice p {
  margin: 0;
}
.release-notice .greeting {
  color: var(--fou-text-color-primary, #101828);
  font-weight: 600;
}
.release-notice .sign {
  margin-top: 4px;
  text-align: right;
  color: var(--fou-text-color-secondary, #667085);
  line-height: 1.6;
}
</style>

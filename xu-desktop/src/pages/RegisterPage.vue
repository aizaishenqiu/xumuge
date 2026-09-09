<script setup lang="ts">
/**
 * @author qiuye <yjk150@qq.com>
 */
import { ref } from "vue";
import { useRouter } from "vue-router";
import { FouButton } from "foucui";
import { cloudRegister, getAccountServerUrl } from "../utils/auth";
import { BRAND_NAME_ZH, BRAND_LOGO_URL } from "../utils/brandSettings";
import { toUserError } from "../utils/userFacingError";

const router = useRouter();
const username = ref("");
const password = ref("");
const password2 = ref("");
const busy = ref(false);
const error = ref("");

async function submit() {
  if (password.value !== password2.value) {
    error.value = "两次密码不一致";
    return;
  }
  if (password.value.length < 6) {
    error.value = "密码至少 6 位";
    return;
  }
  const user = username.value.trim();
  if (user.length < 3) {
    error.value = "请输入用户名或手机号";
    return;
  }
  busy.value = true;
  error.value = "";
  try {
    await cloudRegister(user, password.value, getAccountServerUrl());
    await router.replace("/home");
  } catch (e) {
    error.value = toUserError(e).replace(/^Error:\s*/i, "");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="auth-mask" aria-hidden="true" />
    <div class="auth-card">
      <img class="auth-logo" :src="BRAND_LOGO_URL" :alt="BRAND_NAME_ZH" />
      <h1 class="ui-font">注册{{ BRAND_NAME_ZH }}账号</h1>

      <div class="field ui-font">
        <span class="field-icons" aria-hidden="true">
          <FouIcon icon="user-line" size="16" />
          <FouIcon icon="smartphone-line" size="16" />
        </span>
        <FouInput
          v-model="username"
          class="field-control"
          placeholder="用户名或手机号"
          autocomplete="username"
        />
      </div>
      <div class="field ui-font">
        <span class="field-icons" aria-hidden="true">
          <FouIcon icon="lock-password-line" size="16" />
        </span>
        <FouInput
          v-model="password"
          class="field-control"
          type="password"
          placeholder="请输入密码"
          autocomplete="new-password"
        />
      </div>
      <div class="field ui-font">
        <span class="field-icons" aria-hidden="true">
          <FouIcon icon="lock-password-line" size="16" />
        </span>
        <FouInput
          v-model="password2"
          class="field-control"
          type="password"
          placeholder="请再次输入密码"
          autocomplete="new-password"
          @keyup.enter="submit"
        />
      </div>
      <p v-if="error" class="err">{{ error }}</p>
      <div class="actions">
        <FouButton type="primary" icon="user-add-line" :disabled="busy" @click="submit">
          {{ busy ? "注册中…" : "注册" }}
        </FouButton>
        <FouButton icon="login-box-line" @click="router.push('/login')">登录</FouButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  position: relative;
  min-height: 100%;
  width: 100%;
  display: grid;
  place-items: center;
  padding: 24px;
  box-sizing: border-box;
  background: linear-gradient(160deg, #e8eef4, #f7f4ef 55%, #e6f0ea);
}
.auth-mask {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);
  z-index: 0;
}
.auth-card {
  position: relative;
  z-index: 1;
  width: min(400px, 92vw);
  padding: 32px 28px 28px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid rgba(20, 40, 60, 0.1);
  box-shadow: 0 22px 48px rgba(15, 23, 42, 0.22);
}

.auth-logo {
  display: block;
  height: 36px;
  width: auto;
  max-width: 200px;
  margin: 0 auto 16px;
  object-fit: contain;

h1 {
  margin: 0 0 24px;
  font-size: 22px;
  text-align: center;
}
.field {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 0 2px;
}
.field-icons {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  width: 40px;
  justify-content: flex-end;
  color: #64748b;
}
.field-control {
  flex: 1;
  min-width: 0;
}
.actions {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 20px;
  width: 100%;
}
.err {
  color: #b91c1c;
  font-size: 13px;
  margin: 0 0 4px;
  text-align: center;
}
</style>

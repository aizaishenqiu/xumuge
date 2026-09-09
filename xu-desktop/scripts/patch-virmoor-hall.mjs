import fs from "node:fs";

const p = new URL("../src/components/VirmoorOfficeHall.vue", import.meta.url);
let s = fs.readFileSync(p, "utf8");

s = s.replace(
  /@file HeroOffice3D\.vue[^\n]*\n/,
  "@file VirmoorOfficeHall.vue 办公室 3D 大厅（官网 Hero 风格）\n",
);
s = s.replace(/@version 2\.16\.0/, "@version 1.0.0");
s = s.replace(
  "defineOptions({ name: 'HeroOffice3D' })",
  "defineOptions({ name: 'VirmoorOfficeHall' })",
);
s = s.replace(/\s*<OfficeMeetingChat \/>\n/, "\n");
s = s.replace(
  "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'",
  "import { OrbitControls } from 'three/addons/controls/OrbitControls.js'",
);
s = s.replace(
  /import \{ drawDeskScreen[^}]+\} from '\/@\/officeScreens'/,
  "import { drawDeskScreen, drawFoldingScreenBanner, drawHallScreen, drawNightCityWall, loadHallLogo, SCREEN_KINDS } from '../office/virmoorHallScreens'",
);
s = s.replace(/import OfficeMeetingChat[^\n]+\n/, "");
s = s.replace(
  /import \{ useI18n \} from '\/@\/i18n'\n/,
  `import { hallStrings, idleBubbleFor, workingBubbleFor } from '../office/virmoorHallStrings'
import { HALL_LAYOUT, hallCssToken } from '../office/virmoorHallTheme'
import type { Employee } from '../utils/employees'
import { getLivePatch } from '../employee/events'
`,
);
s = s.replace(/import \{ useTheme, THEME_META \} from '\/@\/theme'\n/, "");
s = s.replace(
  "const props = withDefaults(defineProps<{ embed?: boolean }>(), { embed: false })",
  "const props = withDefaults(defineProps<{ embed?: boolean; employees?: Employee[]; deskCount?: number }>(), { embed: false, employees: () => [], deskCount: 16 })",
);
s = s.replace(
  "const { t } = useI18n()\nconst { theme } = useTheme()\n",
  'const emit = defineEmits<{ "edit-employee": [Employee] }>()\n',
);
s = s.replace(/\{\{ t\.home\.ask \}\}/g, "{{ hallStrings.ask }}");
s = s.replace(/\{\{ t\.home\.plan \}\}/g, "{{ hallStrings.plan }}");
s = s.replace(/\{\{ t\.home\.agent \}\}/g, "{{ hallStrings.agent }}");
s = s.replace(/\{\{ t\.home\.approve \}\}/g, "{{ hallStrings.approve }}");
s = s.replace(/t\.value\.home\.zoneMeeting/g, "hallStrings.zoneMeeting");
s = s.replace(/t\.value\.home\.zoneFront/g, "hallStrings.zoneFront");
s = s.replace(/t\.value\.home\.zoneTea/g, "hallStrings.zoneTea");
s = s.replace(/t\.value\.home\.zoneLounge/g, "hallStrings.zoneLounge");
s = s.replace(/THEME_META\[theme\.value\]\.layout/g, "HALL_LAYOUT");
s = s.replace(
  /function cssToken\(name: string, fallback: string\) \{[\s\S]*?return v \|\| fallback\n\}/,
  "function cssToken(name: string, fallback: string) {\n  return hallCssToken(name, fallback)\n}",
);
s = s.replace(/cssToken\('--xu-/g, "cssToken('--hall-");
s = s.replace(
  /watch\(theme, \(\) => \{\n  void bootScene\(\)\n\}\)/,
  "watch(() => props.employees, () => { syncEmployeeOverlay() }, { deep: true })",
);
s = s.replace(/console\.error\('\[HeroOffice3D\]'/, "console.error('[VirmoorOfficeHall]'");
s = s.replace(/console\.warn\('\[HeroOffice3D\]/g, "console.warn('[VirmoorOfficeHall]'");
s = s.replace(/--xu-/g, "--hall-");

// Fixed dark palette (no site theme switch)
s = s.replace(
  /const roomBg =[\s\S]*?: bg\n  scene\.background/,
  `const roomBg = '#07080c'
  scene.background`,
);
s = s.replace(
  /const floorHex =[\s\S]*?: 0x3d4d62\n  const wallHex =[\s\S]*?: 0x2a3548\n  const gridA =[\s\S]*?: 0x3a4252\n/,
  `const floorHex = 0x3d4d62
  const wallHex = 0x2a3548
  const gridA = 0x6a5a3a
  const gridB = 0x3a4252
`,
);

fs.writeFileSync(p, s);
console.log("patched", p.pathname);

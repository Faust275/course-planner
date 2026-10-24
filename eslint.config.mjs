// ESLint 扁平配置（ESLint v9）。
// 源码是「每文件一个 <script>」的传统脚本，跨文件靠全局变量（window.X / global.X）协作，
// 因此把应用级全局一并声明，让 no-undef 既能抓真正的拼写错误、又不会误报。
import js from '@eslint/js';

// 浏览器运行时全局
const browserGlobals = {
  window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly',
  history: 'readonly', localStorage: 'readonly', sessionStorage: 'readonly',
  indexedDB: 'readonly', IDBKeyRange: 'readonly', FileReader: 'readonly', Blob: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', fetch: 'readonly', XMLHttpRequest: 'readonly',
  atob: 'readonly', btoa: 'readonly', DOMParser: 'readonly',   Response: 'readonly', DecompressionStream: 'readonly', global: 'readonly', File: 'readonly',
  WritableStream: 'readonly', caches: 'readonly', Touch: 'readonly', TouchEvent: 'readonly',
  CompressionStream: 'readonly', ReadableStream: 'readonly', TransformStream: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly', console: 'readonly',
  Notification: 'readonly', Audio: 'readonly', Image: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', EventTarget: 'readonly', Node: 'readonly',
  HTMLElement: 'readonly', SVGElement: 'readonly', Element: 'readonly',
  getComputedStyle: 'readonly', matchMedia: 'readonly', devicePixelRatio: 'readonly',
  performance: 'readonly', crypto: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', Intl: 'readonly',
  JSON: 'readonly', Math: 'readonly', Date: 'readonly', Promise: 'readonly',
  Map: 'readonly', Set: 'readonly', WeakMap: 'readonly', WeakSet: 'readonly',
  Symbol: 'readonly', Proxy: 'readonly', Reflect: 'readonly',
  ArrayBuffer: 'readonly', DataView: 'readonly', Uint8Array: 'readonly', Uint16Array: 'readonly',
  Uint32Array: 'readonly', Float32Array: 'readonly', Float64Array: 'readonly',
  Int8Array: 'readonly', Int16Array: 'readonly', Int32Array: 'readonly', BigInt: 'readonly',
  queueMicrotask: 'readonly', structuredClone: 'readonly', AbortController: 'readonly',
  AbortSignal: 'readonly', MutationObserver: 'readonly', ResizeObserver: 'readonly',
  IntersectionObserver: 'readonly', WebSocket: 'readonly', BroadcastChannel: 'readonly',
  Worker: 'readonly', self: 'readonly', globalThis: 'readonly', BarcodeDetector: 'readonly',
};

// 应用级跨文件全局（window.X / global.X 声明处）
const appGlobals = {
  // window.*
  addEventListener: 'readonly', AK_OPS: 'writable', __cpLoadDaily: 'writable',
  __cpRelayTaskAt: 'writable', __cpRelayTaskId: 'writable', DragGesture: 'writable',
  FOOD_CATS: 'writable', FOOD_DB: 'writable', Pet: 'writable', SaveFile: 'writable', VIEWS: 'writable',
  // global.*
  ActivityDialog: 'writable', actType: 'writable', ACT_TYPES: 'writable', AgendaPane: 'writable',
  AnnivDialog: 'writable', App: 'writable', childIds: 'writable', childrenOf: 'writable',
  compareRange: 'writable', __CourseDialog: 'writable', CourseException: 'writable',
  Daily: 'writable', DailyCards: 'writable', DateUtil: 'writable', diariesSorted: 'writable',
  diaryDatePrompt: 'writable', diaryOn: 'writable', DiaryPane: 'writable', eachDate: 'writable',
  EventDetail: 'writable', EventDialog: 'writable', Gacha: 'writable', GoalsPane: 'writable',
  GradeDialog: 'writable', hasTag: 'writable', heatLevel: 'writable', ICS: 'writable',
  isChild: 'writable', ledgerCat: 'writable', LEDGER_CATS: 'writable', LEDGER_RANGES: 'writable',
  __LessonDialog: 'writable', Lunar: 'writable', MealDialog: 'writable', mealType: 'writable',
  MEAL_TYPES: 'writable', monthBounds: 'writable', MOOD_CROSS_MIN_DAYS: 'writable',
  MOOD_MIN_DAYS: 'writable', moodOf: 'writable', MOODS: 'writable', moodStats: 'writable',
  moodTone: 'writable', normalizeTags: 'writable', NotesPane: 'writable', Ocr: 'writable',
  OcrDialog: 'writable', Onboard: 'writable', openAnnivDialog: 'writable', openGoalDialog: 'writable',
  openPlanDialog: 'writable', openQuadrantAt: 'writable', Palette: 'writable', perDay: 'writable',
  PLAN_PERIODS: 'writable', PLAN_TYPES: 'writable', POMO: 'writable', QuadrantPane: 'writable',
  rangeDates: 'writable', RANGES: 'writable', Remind: 'writable', Router: 'writable',
  __SampleData: 'writable', ScheduleExport: 'writable', ScheduleLayout: 'writable', Search: 'writable',
  SettingsView: 'writable', sleepByNight: 'writable', SleepModel: 'writable', speciesOf: 'writable',
  Speech: 'writable', stageNeed: 'writable', StatsCalc: 'writable', StatsPane: 'writable',
  Store: 'writable', subOpts: 'writable', SUBTASK_DEFAULTS: 'writable', subtaskProgress: 'writable',
  tagFull: 'writable', tagMatch: 'writable', tagParts: 'writable', tagStyle: 'writable',
  TaskDialog: 'writable', TaskNLP: 'writable', TaskRow: 'writable', TaskShot: 'writable',
  Theme: 'writable', TimeUtil: 'writable', Transcript: 'writable', TreeArt: 'writable',
  TREE_SPECIES: 'writable', treeStage: 'writable', TREE_STAGES: 'writable', UI: 'writable',
  validateSchema: 'writable', weekBounds: 'writable', WhiteNoise: 'writable', WhitePaper: 'writable', QrSync: 'writable',
  renderSubtaskPage: 'writable', SettingsDialog: 'writable', drawCloud: 'writable',
};

// Node 运行时（e2e / 测试脚本）
const nodeGlobals = {
  process: 'readonly', console: 'readonly', Buffer: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  setImmediate: 'readonly', clearImmediate: 'readonly', queueMicrotask: 'readonly',
  globalThis: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
};

export default [
  // dist/ 与 android/ 是构建产物：dist 由 build.py 生成、android 是 Capacitor 原生工程，
  // 里面还拷贝了一份 sw.js（含 caches/fetch/Response 等 SW 全局），不能按源码规则检查。
  {
    ignores: [
      'index.html', 'node_modules/**', 'preview/**', 'course-planner-deploy/**',
      'dist/**', 'android/**'
    ]
  },
  js.configs.recommended,
  {
    files: ['assets/js/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...browserGlobals, ...appGlobals },
    },
    rules: {
      // 传统脚本风格，关掉会带来大量噪音、且与单文件产物无关的规则
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-cond-assign': ['error', 'except-parens'],
      'no-prototype-builtins': 'off',
      'no-case-declarations': 'off',
      'no-fallthrough': 'off',
      'no-return-assign': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-control-regex': 'off',
      'no-async-promise-executor': 'off',
      'no-unsafe-optional-chaining': 'off',
      // 传统脚本里 var 在嵌套循环中复用同名很常见，且合法；属风格偏好，不阻断
      'no-redeclare': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['**/*.mjs', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // e2e 脚本（verify_*.mjs）在 page.evaluate 回调里引用浏览器全局（Store/App/document），
      // 同时在脚本顶层用 node 全局（process/http/fs），两者都需要声明
      globals: { ...nodeGlobals, ...browserGlobals, ...appGlobals },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 测试脚本里故意用 `true && x` 验证条件分支、正则里写死两个空格匹配缩进，属正常写法
      'no-constant-binary-expression': 'off',
      'no-regex-spaces': 'off',
    },
  },
];
